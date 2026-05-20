/**
 * E2E: NIP-61 nutzap end-to-end on regtest Cashu + Nostr relay.
 *
 *   1. Sender mints proofs from regtest Lightning.
 *   2. sendNutzap locks `amountSats` to recipient's Nostr pubkey via
 *      NUT-11 P2PK and publishes a kind:9321 event tagged with the
 *      recipient. Sender keeps change.
 *   3. fetchIncomingNutzaps on the recipient side queries the relay for
 *      kind:9321 events tagged `#p` self.
 *   4. redeemNutzap calls wallet.receive with the recipient's nsec —
 *      cashu-ts signs each proof's secret, mint accepts the n_sigs=1
 *      lock, returns plain proofs.
 *   5. Asserts recipient's plain-proof balance grew by ~amount minus
 *      mint swap fee.
 *
 * No mocks, no fallbacks. Real mint, real relay, real signature path.
 *
 * Run:
 *   docker compose up -d && ./scripts/init-regtest.sh && docker compose restart cashu-mint
 *   CASHU_MINT_URL=http://localhost:3338 NOSTR_RELAY_URL=ws://localhost:7777 \
 *     deno test e2e/nip61-nutzap.test.ts --allow-all
 */

import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";
import {
  fetchIncomingNutzaps,
  redeemNutzap,
  sendNutzap,
} from "../../apps/two-party-binary-bet/src/nip61.ts";
import {
  checkInfraReady,
  createWallet,
  isRelayReachable,
  throttledMintProofs,
} from "../helpers/regtest.ts";
import process from "node:process";

const MINT_URL = process.env.CASHU_MINT_URL ?? "http://localhost:3338";
const RELAY_URL = process.env.NOSTR_RELAY_URL ?? "ws://localhost:7777";

const INFRA_READY = await checkInfraReady(MINT_URL) &&
  await isRelayReachable(RELAY_URL);

const suite = INFRA_READY ? describe : describe.ignore;

suite("e2e: NIP-61 nutzap (regtest Cashu + Nostr relay)", () => {
  test("sender → recipient: nutzap delivered, locked, swapped, banked", async () => {
    const senderSk = generateSecretKey();
    const recipientSk = generateSecretKey();
    const recipientPk = getPublicKey(recipientSk);

    const senderWallet = await createWallet(MINT_URL);
    const recipientWallet = await createWallet(MINT_URL);
    const FUND = 256;
    const ZAP = 200;

    const senderProofs = await throttledMintProofs(senderWallet, FUND);
    expect(senderProofs.reduce((s, p) => s + p.amount, 0)).toBe(FUND);

    const pool = new SimplePool();
    try {
      // Sender publishes the nutzap.
      const sendResult = await sendNutzap({
        senderSecret: senderSk,
        recipientPubkey: recipientPk,
        mintUrl: MINT_URL,
        senderWallet,
        senderProofs,
        amountSats: ZAP,
        relays: [RELAY_URL],
        comment: "for the two-party binary bet faucet",
        pool,
      });
      expect(sendResult.eventId).toMatch(/^[0-9a-f]{64}$/);
      const senderChange = sendResult.keepProofs.reduce(
        (s, p) => s + p.amount,
        0,
      );
      // Sender keeps `FUND - ZAP - fee`. Nutshell input_fee_ppk=100 ≈ 1 sat.
      expect(senderChange).toBeLessThanOrEqual(FUND - ZAP);
      expect(senderChange).toBeGreaterThanOrEqual(FUND - ZAP - 5);

      // Recipient queries the relay for nutzaps targeting them.
      // Allow a beat for the relay to flush the event.
      await new Promise((r) => setTimeout(r, 200));
      const incoming = await fetchIncomingNutzaps(
        pool,
        [RELAY_URL],
        recipientPk,
      );
      expect(incoming.length).toBeGreaterThanOrEqual(1);
      const nz = incoming.find((n) => n.eventId === sendResult.eventId);
      expect(nz).toBeTruthy();
      expect(nz!.amountSats).toBe(ZAP);
      expect(nz!.mintUrl).toBe(MINT_URL);
      expect(nz!.comment).toBe("for the two-party binary bet faucet");

      // Recipient swaps the locked nutzap at the mint. The proofs are
      // P2PK-locked to recipientPk; redeemNutzap passes the nsec to
      // wallet.receive which signs each proof's secret.
      const fresh = await redeemNutzap({
        recipientWallet,
        recipientSecret: recipientSk,
        nutzap: nz!,
      });
      const got = fresh.reduce((s, p) => s + p.amount, 0);
      expect(got).toBeGreaterThan(0);
      // Mint takes one swap-fee chunk on the receive too.
      expect(got).toBeLessThanOrEqual(ZAP);
      expect(got).toBeGreaterThanOrEqual(ZAP - 5);
    } finally {
      pool.close([RELAY_URL]);
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  test("third party cannot redeem a nutzap addressed to someone else", async () => {
    const senderSk = generateSecretKey();
    const aliceSk = generateSecretKey();
    const evePk = getPublicKey(generateSecretKey()); // an unrelated key
    const aliceXOnly = getPublicKey(aliceSk);

    const senderWallet = await createWallet(MINT_URL);
    const eveWallet = await createWallet(MINT_URL);
    const senderProofs = await throttledMintProofs(senderWallet, 256);

    const pool = new SimplePool();
    try {
      const sent = await sendNutzap({
        senderSecret: senderSk,
        recipientPubkey: aliceXOnly,
        mintUrl: MINT_URL,
        senderWallet,
        senderProofs,
        amountSats: 100,
        relays: [RELAY_URL],
        pool,
      });
      void sent;
      void evePk;

      await new Promise((r) => setTimeout(r, 200));
      const incoming = await fetchIncomingNutzaps(
        pool,
        [RELAY_URL],
        aliceXOnly,
      );
      expect(incoming.length).toBeGreaterThanOrEqual(1);

      // Eve gets her hands on alice's nutzap event somehow (the relay is
      // public). She tries to redeem with HER nsec — the mint must reject.
      const eveSk = generateSecretKey();
      let redeemError: string | null = null;
      try {
        await redeemNutzap({
          recipientWallet: eveWallet,
          recipientSecret: eveSk,
          nutzap: incoming[0]!,
        });
      } catch (err) {
        redeemError = err instanceof Error ? err.message : String(err);
      }
      expect(redeemError).toBeTruthy();
    } finally {
      pool.close([RELAY_URL]);
      await new Promise((r) => setTimeout(r, 100));
    }
  });
});
