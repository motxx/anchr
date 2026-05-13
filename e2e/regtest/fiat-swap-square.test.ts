/**
 * TLSN fiat swap regtest integration.
 *
 * Scope: run the Seller/Customer and Buyer/Provider flow over the
 * real Docker-backed Nostr relay and Cashu mint. Square/TLSNotary proof
 * production is represented by a fixture proof; the schema verifier checks
 * the fiat swap predicate and result shape locally. The simulated oracle mirrors
 * the current SDK regtest pattern: it releases the preimage when it observes
 * the provider's kind 6300 result.
 *
 * Prerequisites:
 *   docker compose up -d
 *   ./scripts/init-regtest.sh
 *
 * Run:
 *   ANCHR_E2E_REQUIRE_INFRA=1 deno test e2e/regtest/fiat-swap-square.test.ts --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys --allow-ffi
 */

import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { createCustomer } from "@anchr/customer-sdk/customer";
import { createProvider } from "@anchr/provider-sdk/provider";
import { createCashuClient } from "@anchr/customer-sdk/cashu";
import { createRelayClient } from "@anchr/customer-sdk/nostr";
import { generateKeypair } from "@anchr/protocol/nostr";
import {
  buildPreimageDeliveryEvent,
  parseQueryRequestEvent,
} from "@anchr/protocol/events";
import type { OracleClient } from "@anchr/oracle-sdk/oracle";
import {
  buildFiatSwapResultData,
  buildFiatSwapSpec,
  type BuyerConfig,
  FIAT_SWAP_SCHEMA,
  isFiatSwapPredicate,
  predicateMatchesBuyerConfig,
} from "../../example/tlsn-fiat-swap-square/fiat-swap.ts";

import {
  checkInfraReady,
  createWallet,
  throttledMintProofs,
} from "../helpers/regtest.ts";

const MINT_URL = Deno.env.get("CASHU_MINT_URL") ?? "http://localhost:3338";
const RELAY_URL = (Deno.env.get("NOSTR_RELAYS") ?? "ws://localhost:7777")
  .split(",")[0]!.trim();

const FIAT_SWAP_SATS = 16;
const FIXTURE_PROOF = "fiat-swap-fixture-tlsn-presentation";
const RELAY_CLOSE_GRACE_MS = 5_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const INFRA_READY = await checkInfraReady(MINT_URL);
const sharedWallet = INFRA_READY ? await createWallet(MINT_URL) : undefined;
const suite = INFRA_READY ? describe : describe.ignore;

suite(
  "e2e: TLSN fiat swap Customer ↔ Provider over regtest Cashu + Nostr",
  () => {
    test("seller/customer buys a Square-payment fixture proof and buyer/provider redeems the HTLC", async () => {
      const preimageBytes = new Uint8Array(32);
      crypto.getRandomValues(preimageBytes);
      const preimageHex = bytesToHex(preimageBytes);
      const hashHex = bytesToHex(sha256(preimageBytes));

      const customerProofs = await throttledMintProofs(
        sharedWallet!,
        FIAT_SWAP_SATS,
      );

      const oracleKey = generateKeypair();
      const providerKey = generateKeypair();

      const oracleRelay = createRelayClient([RELAY_URL]);
      const customerRelay = createRelayClient([RELAY_URL]);
      const providerRelay = createRelayClient([RELAY_URL]);

      const oracleClient: OracleClient = {
        requestHash: () =>
          Promise.resolve({
            hash: hashHex,
            oraclePubkey: oracleKey.publicKey,
          }),
      };

      const queryIdsByRequest = new Map<string, string>();
      const reqSub = oracleRelay.subscribe(
        { kinds: [5300] },
        (event) => {
          const payload = parseQueryRequestEvent(event);
          if (payload !== null) {
            queryIdsByRequest.set(event.id, payload.query_id);
          }
        },
      );
      const respSub = oracleRelay.subscribe(
        { kinds: [6300] },
        (event) => {
          const requestId = event.tags.find((t) => t[0] === "e")?.[1];
          if (requestId === undefined) return;
          const queryId = queryIdsByRequest.get(requestId);
          if (queryId === undefined) return;
          const dm = buildPreimageDeliveryEvent(oracleKey, event.pubkey, {
            query_id: queryId,
            request_event_id: requestId,
            preimage: preimageHex,
          });
          void oracleRelay.publish(dm);
        },
      );

      const buyerConfig: BuyerConfig = {
        relays: [RELAY_URL],
        mintUrl: MINT_URL,
        oraclePubkey: oracleKey.publicKey,
        providerPrivKey: bytesToHex(providerKey.secretKey),
        paymentId: "fiat_swap_regtest_payment_001",
        paymentLink: "https://square.link/u/fiat-swap-regtest",
        amountSats: FIAT_SWAP_SATS,
        fiatAmountMinor: 100,
        fiatCurrency: "JPY",
        squareLocationId: "FIAT_SWAP_REGTEST_LOC",
        maxAttestationAgeSeconds: 600,
        locktimeSeconds: 3600,
        selectionTimeoutMs: 30_000,
        preimageTimeoutMs: 30_000,
      };

      const provider = createProvider({
        oracles: [oracleKey.publicKey],
        relays: [RELAY_URL],
        mint: MINT_URL,
        privKey: buyerConfig.providerPrivKey,
        cashuClient: createCashuClient({ mintUrl: MINT_URL }),
        relayClient: providerRelay,
        selectionTimeoutMs: buyerConfig.selectionTimeoutMs,
        preimageTimeoutMs: buyerConfig.preimageTimeoutMs,
      });

      let matchedFiatSwapRequest = false;
      const servePromise = provider.serve((request) => {
        if (request.spec.schema !== FIAT_SWAP_SCHEMA) {
          return Promise.resolve(null);
        }
        if (!isFiatSwapPredicate(request.spec.predicate)) {
          return Promise.resolve(null);
        }
        if (!predicateMatchesBuyerConfig(request.spec.predicate, buyerConfig)) {
          return Promise.resolve(null);
        }
        matchedFiatSwapRequest = true;
        return Promise.resolve({
          amountSats: FIAT_SWAP_SATS,
          produce: () =>
            Promise.resolve({
              data: buildFiatSwapResultData(buyerConfig),
              proof: FIXTURE_PROOF,
            }),
        });
      });

      await delay(500);

      const expectedData = buildFiatSwapResultData(buyerConfig);
      const customer = createCustomer({
        oracles: [oracleKey.publicKey],
        relays: [RELAY_URL],
        mint: MINT_URL,
        oracleClient,
        cashuClient: createCashuClient({ mintUrl: MINT_URL }),
        relayClient: customerRelay,
        quoteWindowMs: 3_000,
        resultTimeoutMs: 30_000,
        verifierAdapters: [{
          canHandle: (schema) => schema === FIAT_SWAP_SCHEMA,
          verify: (proof, predicate, data) =>
            proof === FIXTURE_PROOF &&
            isFiatSwapPredicate(predicate) &&
            JSON.stringify(data) === JSON.stringify(expectedData),
        }],
      });

      try {
        const result = await customer.request({
          spec: buildFiatSwapSpec({
            relays: [RELAY_URL],
            mintUrl: MINT_URL,
            oraclePubkey: oracleKey.publicKey,
            paymentLink: buyerConfig.paymentLink,
            amountSats: FIAT_SWAP_SATS,
            fiatAmountMinor: buyerConfig.fiatAmountMinor,
            fiatCurrency: buyerConfig.fiatCurrency,
            squareLocationId: buyerConfig.squareLocationId,
            maxAttestationAgeSeconds: buyerConfig.maxAttestationAgeSeconds,
            locktimeSeconds: buyerConfig.locktimeSeconds,
          }),
          payment: {
            maxAmount: FIAT_SWAP_SATS,
            locktimeSeconds: buyerConfig.locktimeSeconds,
          },
          sourceProofs: customerProofs,
          provider: providerKey.publicKey,
        });

        expect(matchedFiatSwapRequest).toBe(true);
        expect(result.providerPubkey).toBe(providerKey.publicKey);
        expect(result.schema).toBe(FIAT_SWAP_SCHEMA);
        expect(result.data).toEqual(expectedData);
        expect(result.proof).toBe(FIXTURE_PROOF);

        await delay(2_000);
      } finally {
        await provider.stop();
        await servePromise;
        reqSub.close();
        respSub.close();
        oracleRelay.close();
        customerRelay.close();
        providerRelay.close();
        await delay(RELAY_CLOSE_GRACE_MS);
      }
    });
  },
);
