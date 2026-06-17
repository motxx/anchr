/**
 * Real e2e test for @anchr/sdk Customer + Provider against:
 *   - Real Cashu mint (regtest, http://localhost:3338)
 *   - Real Nostr relay (ws://localhost:7777)
 *   - In-process simulated oracle
 *
 * The customer's funding proofs are minted via regtest Lightning so the
 * Provider-bound Payment Lock swap and provider's HTLC redemption both
 * hit the real mint. This is the "no Mock" verification of the SDK wire
 * flow. **Scope:** HTLC + Nostr transport. The simulated oracle here
 * does not verify proofs (it always releases the preimage on a kind
 * 6300 result event); proof verification (TLSN attestation, C2PA, GPS,
 * etc.) is a schema-specific concern outside the SDK and is covered by
 * the per-schema test suites.
 *
 * Prerequisites:
 *   docker compose up -d
 *   ./scripts/init-regtest.sh
 *
 * Run:
 *   deno task test:e2e:regtest
 */

import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { createCustomer } from "@anchr/sdk/customer";
import { createProvider } from "@anchr/sdk/provider";
import { createCashuClient } from "@anchr/sdk/adapters/cashu";
import { createRelayClient } from "@anchr/sdk/adapters/nostr";
import { type Event, generateKeypair } from "@anchr/protocol/nostr";
import {
  buildPreimageDeliveryEvent,
  parseQueryRequestEvent,
} from "@anchr/protocol/events";
import type { OracleClient } from "@anchr/sdk/oracle";

import {
  checkInfraReady,
  createWallet,
  throttledMintProofs,
} from "../helpers/regtest.ts";

const MINT_URL = Deno.env.get("CASHU_MINT_URL") ?? "http://localhost:3338";
const RELAY_URL = (Deno.env.get("NOSTR_RELAYS") ?? "ws://localhost:7777")
  .split(",")[0]!.trim();
const PROVIDER_AMOUNT_SATS = 16;
const CUSTOMER_FUNDING_SATS = PROVIDER_AMOUNT_SATS * 2;

const INFRA_READY = await checkInfraReady(MINT_URL);
const sharedWallet = INFRA_READY ? await createWallet(MINT_URL) : undefined;

const suite = INFRA_READY ? describe : describe.ignore;

suite(
  "e2e: SDK Customer ↔ Provider via real Cashu mint + real Nostr relay",
  () => {
    test("end-to-end query: customer mints sats, provider redeems HTLC at the mint", async () => {
      // Generate a fresh preimage S and the matching hash H = sha256(S).
      const preimageBytes = new Uint8Array(32);
      crypto.getRandomValues(preimageBytes);
      const preimageHex = bytesToHex(preimageBytes);
      const hashHex = bytesToHex(sha256(preimageBytes));

      // Mint Cashu proofs into the customer's wallet via Lightning.
      const customerProofs = await throttledMintProofs(
        sharedWallet!,
        CUSTOMER_FUNDING_SATS,
      );

      // Generate keys for oracle and provider.
      const oracleKey = generateKeypair();
      const providerKey = generateKeypair();

      // Real relay clients (independent pools per actor).
      const oracleRelay = createRelayClient([RELAY_URL]);
      const customerRelay = createRelayClient([RELAY_URL]);
      const providerRelay = createRelayClient([RELAY_URL]);

      // The OracleClient that the customer uses for the pre-flight hash.
      const oracleClient: OracleClient = {
        requestHash: (_queryId) => Promise.resolve({ hash: hashHex }),
      };

      // The simulated oracle subscribes to kind 6300 result events. When
      // one arrives referencing a kind 5300 we've seen, it sends the
      // preimage to the provider via NIP-44 DM (kind 4). A real oracle
      // would verify the proof first — here we trust the provider for
      // the purposes of testing the Cashu HTLC swap path.
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

      // Real CashuClient against the regtest mint for both actors.
      const customerCashu = createCashuClient({ mintUrl: MINT_URL });
      const providerCashu = createCashuClient({ mintUrl: MINT_URL });

      const provider = createProvider({
        oracles: [oracleKey.publicKey],
        relays: [RELAY_URL],
        mint: MINT_URL,
        privKey: bytesToHex(providerKey.secretKey),
        cashuClient: providerCashu,
        relayClient: providerRelay,
        selectionTimeoutMs: 30_000,
        preimageTimeoutMs: 30_000,
      });

      const servePromise = provider.serve((request) =>
        Promise.resolve({
          amountSats: PROVIDER_AMOUNT_SATS,
          produce: () =>
            Promise.resolve({
              data: { schema: request.spec.schema, ok: true },
              proof: "regtest-proof-bytes",
            }),
        })
      );

      // Let provider's subscription register before customer publishes.
      await new Promise((r) => setTimeout(r, 500));

      const customer = createCustomer({
        oracles: [{
          pubkey: oracleKey.publicKey,
          client: oracleClient,
        }],
        relays: [RELAY_URL],
        mint: MINT_URL,
        cashuClient: customerCashu,
        relayClient: customerRelay,
        offerWindowMs: 3_000,
        resultTimeoutMs: 30_000,
      });

      try {
        const result = await customer.request({
          spec: {
            schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
            predicate: { target: "https://api.example.org" },
          },
          payment: { maxAmount: PROVIDER_AMOUNT_SATS },
          fundingProofs: customerProofs,
        });

        expect(result.providerPubkey).toBe(providerKey.publicKey);
        expect(result.schema).toBe(
          "https://anchr-spec.org/spec/proof/tlsn/v1",
        );
        expect(result.data).toEqual({
          schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
          ok: true,
        });
        expect(result.proof).toBe("regtest-proof-bytes");

        // Give the provider a moment to finish redeemHtlc against the
        // real mint after the customer has returned.
        await new Promise((r) => setTimeout(r, 2_000));
      } finally {
        await provider.stop();
        await servePromise;
        reqSub.close();
        respSub.close();
        oracleRelay.close();
        customerRelay.close();
        providerRelay.close();
      }
    });

    test("kind 5300 public advertisement does not broadcast payment-bearing material", async () => {
      const preimageBytes = new Uint8Array(32);
      crypto.getRandomValues(preimageBytes);
      const hashHex = bytesToHex(sha256(preimageBytes));

      const customerProofs = await throttledMintProofs(
        sharedWallet!,
        CUSTOMER_FUNDING_SATS,
      );
      const customerCashu = createCashuClient({ mintUrl: MINT_URL });
      const oracleKey = generateKeypair();
      const published: Event[] = [];
      const oracleClient: OracleClient = {
        requestHash: (_queryId) => Promise.resolve({ hash: hashHex }),
      };
      const customer = createCustomer({
        oracles: [{ pubkey: oracleKey.publicKey, client: oracleClient }],
        relays: ["recording://relay"],
        mint: MINT_URL,
        cashuClient: customerCashu,
        relayClient: {
          publish: (event) => {
            published.push(event);
            return Promise.resolve({
              successes: ["recording://relay"],
              failures: [],
            });
          },
          subscribe: () => ({ close: () => {} }),
          close: () => {},
        },
        offerWindowMs: 10,
      });

      await expect(customer.request({
        spec: {
          schema: "https://anchr-spec.org/spec/proof/tlsn/v1",
          predicate: { target: "https://api.example.org" },
        },
        payment: { maxAmount: PROVIDER_AMOUNT_SATS },
        fundingProofs: customerProofs,
      })).rejects.toThrow();

      const requestEvent = published.find((event) => event.kind === 5300);
      expect(requestEvent).toBeDefined();
      if (requestEvent === undefined) throw new Error("request not published");
      const content = JSON.parse(requestEvent.content) as Record<
        string,
        unknown
      >;
      expect(content).not.toHaveProperty("predicate");
      expect(content).not.toHaveProperty("mint_url");
      expect(content).not.toHaveProperty("payment_lock_token");
      expect(content).not.toHaveProperty("provider_redemption_token");
      expect(content).not.toHaveProperty("locktime_seconds");
    });
  },
);
