/**
 * Real e2e test for @anchr/sdk Customer + Provider against:
 *   - Real Cashu mint (regtest, http://localhost:3338)
 *   - Real Nostr relay (ws://localhost:7777)
 *   - In-process simulated oracle
 *
 * The customer's source proofs are minted via regtest Lightning so the
 * Phase-1 lock, Phase-2 swap, and provider's HTLC redemption all hit
 * the real mint. This is the "no Mock" verification of the SDK wire
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
 *   deno task test:regtest
 *
 * (Or directly:
 *   CASHU_MINT_URL=http://localhost:3338 \
 *   NOSTR_RELAYS=ws://localhost:7777 \
 *   deno test e2e/sdk-integration.test.ts --allow-all)
 */

import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { createCustomer } from "../packages/sdk/src/customer.ts";
import { createProvider } from "../packages/sdk/src/provider.ts";
import { createCashuClient } from "../packages/sdk/src/cashu.ts";
import {
  createRelayClient,
  generateKeypair,
} from "../packages/sdk/src/nostr.ts";
import {
  buildPreimageDeliveryEvent,
  parseQueryRequestEvent,
} from "../packages/sdk/src/events.ts";
import type { OracleClient } from "../packages/sdk/src/oracle.ts";
import { Wallet, getDecodedToken } from "@cashu/cashu-ts";

import {
  checkInfraReady,
  createWallet,
  throttledMintProofs,
} from "./helpers/regtest.ts";

const MINT_URL = Deno.env.get("CASHU_MINT_URL") ?? "http://localhost:3338";
const RELAY_URL = (Deno.env.get("NOSTR_RELAYS") ?? "ws://localhost:7777")
  .split(",")[0]!.trim();
const BOUNTY_SATS = 16;

const INFRA_READY = await checkInfraReady(MINT_URL);
const sharedWallet = INFRA_READY ? await createWallet(MINT_URL) : undefined;

const suite = INFRA_READY ? describe : describe.ignore;

suite(
  {
    name: "e2e: SDK Customer ↔ Provider via real Cashu mint + real Nostr relay",
    // SimplePool keeps long-lived WebSocket connections; cleanup races with
    // the test runner's leak detector, so we opt out (matches the pattern in
    // e2e/relay.test.ts and e2e/oracle-discovery.test.ts).
    sanitizeOps: false,
    sanitizeResources: false,
  },
  () => {
    test("end-to-end query: customer mints sats, provider redeems HTLC at the mint", async () => {
      // Generate a fresh preimage S and the matching hash H = sha256(S).
      const preimageBytes = new Uint8Array(32);
      crypto.getRandomValues(preimageBytes);
      const preimageHex = bytesToHex(preimageBytes);
      const hashHex = bytesToHex(sha256(preimageBytes));

      // Mint Cashu proofs into the customer's wallet via Lightning.
      const customerProofs = await throttledMintProofs(sharedWallet!, BOUNTY_SATS);

      // Generate keys for oracle and provider.
      const oracleKey = generateKeypair();
      const providerKey = generateKeypair();

      // Real relay clients (independent pools per actor).
      const oracleRelay = createRelayClient([RELAY_URL]);
      const customerRelay = createRelayClient([RELAY_URL]);
      const providerRelay = createRelayClient([RELAY_URL]);

      // The OracleClient that the customer uses for the pre-flight hash.
      const oracleClient: OracleClient = {
        requestHash: () =>
          Promise.resolve({
            hash: hashHex,
            oraclePubkey: oracleKey.publicKey,
          }),
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
          amountSats: BOUNTY_SATS,
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
        oracles: [oracleKey.publicKey],
        relays: [RELAY_URL],
        mint: MINT_URL,
        oracleClient,
        cashuClient: customerCashu,
        relayClient: customerRelay,
        quoteWindowMs: 3_000,
        resultTimeoutMs: 30_000,
      });

      try {
        const result = await customer.request({
          spec: {
            schema: "io.anchr.tlsn-https.v1",
            predicate: { target: "https://api.example.org" },
          },
          payment: { maxAmount: BOUNTY_SATS },
          sourceProofs: customerProofs,
        });

        expect(result.providerPubkey).toBe(providerKey.publicKey);
        expect(result.schema).toBe("io.anchr.tlsn-https.v1");
        expect(result.data).toEqual({
          schema: "io.anchr.tlsn-https.v1",
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

    test("Phase-1 bounty_token broadcast in kind 5300 is NOT spendable as a bearer instrument", async () => {
      // Regression test for the bearer-leak issue: an attacker who
      // subscribes to the relay sees the bounty_token in the kind 5300
      // event content. The token MUST NOT be spendable by anyone except
      // the customer (or, after Phase 2, by the chosen provider with
      // the preimage). Phase 1 locks proofs to P2PK(customerPubkey).
      const preimageBytes = new Uint8Array(32);
      crypto.getRandomValues(preimageBytes);
      const hashHex = bytesToHex(sha256(preimageBytes));

      const customerProofs = await throttledMintProofs(sharedWallet!, BOUNTY_SATS);
      const customerCashu = createCashuClient({ mintUrl: MINT_URL });
      const customerKey = generateKeypair();

      const phase1 = await customerCashu.buildHtlcLock({
        amountSats: BOUNTY_SATS,
        hashHex,
        customerPubkey: customerKey.publicKey,
        locktimeSeconds: Math.floor(Date.now() / 1000) + 3600,
        sourceProofs: customerProofs,
      });

      // Attacker wallet — loaded from the same mint so its keychain
      // can map the V4-truncated short keyset IDs in the broadcast
      // token back to full IDs.
      const attackerWallet = new Wallet(MINT_URL, { unit: "sat" });
      await attackerWallet.loadMint();

      // The token decodes to real cashuB proofs (proves it isn't an
      // opaque blob). Pass the wallet's keysets so V4 short IDs can be
      // resolved.
      const decoded = getDecodedToken(
        phase1.token,
        attackerWallet.keyChain.getAllKeysetIds(),
      );
      expect(decoded.proofs.length).toBeGreaterThan(0);
      // Each proof secret carries a P2PK lock to the customer pubkey.
      for (const proof of decoded.proofs) {
        const secret = JSON.parse(proof.secret) as [string, { data: string }];
        expect(secret[0]).toBe("P2PK");
        expect(secret[1].data).toContain(customerKey.publicKey);
      }

      // Attacker scenario A (cashu-ts client path): a passive relay
      // subscriber decodes the bounty_token and tries to spend it via
      // a fresh wallet that never knew the customer's privkey. The
      // wallet's send() refuses to even build a swap request because
      // the input proofs are P2PK-locked and no privkey was supplied.
      let clientPathError: unknown = null;
      try {
        await attackerWallet.ops.send(BOUNTY_SATS, decoded.proofs).run();
      } catch (err) {
        clientPathError = err;
      }
      expect(clientPathError).not.toBeNull();

      // Attacker scenario B (direct mint POST): a more determined
      // attacker bypasses cashu-ts and POSTs directly to the mint's
      // /v1/swap endpoint. The mint MUST reject. (The balance and
      // NUT-11 witness checks both reject; we just need _any_ rejection
      // to confirm the proofs cannot be spent without the customer's
      // signature.)
      const inputAmount = decoded.proofs.reduce((s, p) => s + p.amount, 0);
      const directPostRes = await fetch(`${MINT_URL}/v1/swap`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          inputs: decoded.proofs,
          outputs: [
            { amount: inputAmount, id: decoded.proofs[0]?.id ?? "00", B_: "02" + "ff".repeat(32) },
          ],
        }),
      });
      expect(directPostRes.ok).toBe(false);
      const directPostBody = await directPostRes.text();
      // Mint can reject for several reasons — fee imbalance, malformed
      // outputs, or NUT-11 witness missing. All confirm the proofs
      // cannot be spent without further signing.
      expect(directPostBody.length).toBeGreaterThan(0);

      // After both attack attempts, the proofs MUST still be UNSPENT
      // at the mint (i.e., the legitimate customer can still claim
      // them via Phase 2). This is the load-bearing property.
      const stateRes = await attackerWallet.checkProofsStates(decoded.proofs);
      for (const s of stateRes) {
        expect(s.state).toBe("UNSPENT");
      }
    });
  },
);
