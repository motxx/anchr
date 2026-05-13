/**
 * E2E: NIP-60 wallet round-trips real Cashu proofs through a Nostr relay.
 *
 * Uses the docker-compose relay (ws://localhost:7777) and the regtest Cashu
 * mint (http://localhost:3338). No localStorage, no in-memory shortcut —
 * proofs are NIP-44-encrypted and persisted as kind:7375 events. A second
 * wallet instance (same keypair, fresh pool) can load them back.
 *
 * Run:
 *   docker compose up -d && ./scripts/init-regtest.sh && docker compose restart cashu-mint
 *   CASHU_MINT_URL=http://localhost:3338 \
 *     deno test e2e/nip60-wallet.test.ts --allow-all
 */

import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { generateSecretKey } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";
import {
  closeNip60Wallet,
  createNip60Wallet,
  getBalance,
  loadProofs,
  publishProofs,
} from "../../example/two-party-binary-bet/src/nip60.ts";
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

suite("e2e: NIP-60 wallet (Nostr relay + regtest Cashu)", () => {
  test("round-trips real Cashu proofs through kind:7375 events", async () => {
    // Mint real Cashu proofs first so we have something to persist.
    const cashuWallet = await createWallet(MINT_URL);
    const proofs = await throttledMintProofs(cashuWallet, 200);
    const totalSats = proofs.reduce((s, p) => s + p.amount, 0);
    expect(totalSats).toBe(200);

    // First wallet: publish proofs as kind:7375 event.
    const sk = generateSecretKey();
    const pool = new SimplePool();
    const wallet = await createNip60Wallet({
      secretKey: sk,
      relays: [RELAY_URL],
      mintUrl: MINT_URL,
      pool,
    });
    const eventId = await publishProofs(wallet, proofs);
    expect(eventId).toMatch(/^[0-9a-f]{64}$/);

    // Second wallet: same nsec, fresh pool — must read the same proofs back.
    const pool2 = new SimplePool();
    const wallet2 = await createNip60Wallet({
      secretKey: sk,
      relays: [RELAY_URL],
      mintUrl: MINT_URL,
      pool: pool2,
    });
    const entries = await loadProofs(wallet2);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const restored = entries.flatMap((e) => e.proofs);
    expect(restored.reduce((s, p) => s + p.amount, 0)).toBe(200);

    // Sanity: balance helper agrees with manual aggregation.
    const balance = await getBalance(wallet2);
    expect(balance).toBe(200);

    await closeNip60Wallet(wallet);
    await closeNip60Wallet(wallet2);
  });

  test("supersedes prior token event via `del`", async () => {
    const sk = generateSecretKey();
    const pool = new SimplePool();
    const wallet = await createNip60Wallet({
      secretKey: sk,
      relays: [RELAY_URL],
      mintUrl: MINT_URL,
      pool,
    });

    const cashuWallet = await createWallet(MINT_URL);
    const proofsA = await throttledMintProofs(cashuWallet, 100);
    const proofsB = await throttledMintProofs(cashuWallet, 50);

    // Publish both, then publish a third event that supersedes A.
    const idA = await publishProofs(wallet, proofsA);
    const idB = await publishProofs(wallet, proofsB);
    expect(idA).not.toBe(idB);

    // The "spent" event leaves us with B only via del:[idA].
    await publishProofs(wallet, [], [idA]);

    const entries = await loadProofs(wallet);
    const liveIds = entries.map((e) => e.eventId);
    expect(liveIds).not.toContain(idA); // tombstoned
    expect(liveIds).toContain(idB); // survives
    expect(await getBalance(wallet)).toBe(50);

    await closeNip60Wallet(wallet);
  });
});
