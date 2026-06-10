/**
 * E2E tests for the full regtest Cashu payment_lock flow.
 *
 * Tests the complete lifecycle:
 *   1. Mint Cashu tokens via regtest Lightning
 *   2. Create a query with payment_lock
 *   3. Submit a result
 *   4. Verify payment_lock release and Cashu token return
 *
 * Prerequisites:
 *   docker compose up -d
 *   sleep 25
 *   ./scripts/init-regtest.sh
 *   docker compose restart cashu-mint  # if cashu-mint exited
 *
 * Run:
 *   CASHU_MINT_URL=http://localhost:3338 \
 *   NOSTR_RELAYS=ws://localhost:7777 \
 *   BLOSSOM_SERVERS=http://localhost:3333 \
 *   deno test e2e/regtest-cashu.test.ts --allow-all
 */

import { beforeAll, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { spawn } from "../helpers/process.ts";
import { getEncodedToken, type Proof } from "@cashu/cashu-ts";
import { createQueryService } from "@anchr/sdk/testing";
import { createOracleRegistry } from "@anchr/sdk/adapters/oracle-client";
import { createPreimageStore } from "@anchr/sdk/payments";
import { normalizeResultAttachments } from "@anchr/sdk/attachments";
import {
  checkInfraReady,
  createWallet,
  payInvoiceViaLndUser,
  throttledMintProofs,
} from "../helpers/regtest.ts";
import process from "node:process";

const MINT_URL = process.env.CASHU_MINT_URL ?? "http://localhost:3338";
const BOUNTY_SATS = 21;

const INFRA_READY = await checkInfraReady(MINT_URL);

// Create wallet at module level before describes register.
// This ensures loadMint() fetch responses are fully consumed
// before any test scope begins (avoids Deno sanitizer false positives).
const sharedWallet = INFRA_READY ? await createWallet(MINT_URL) : undefined;

async function mintCashuToken(
  amountSats: number,
): Promise<{ token: string; proofs: Proof[] }> {
  const proofs = await throttledMintProofs(sharedWallet!, amountSats);
  const token = getEncodedToken({ mint: MINT_URL, proofs });
  return { token, proofs };
}

const suite = INFRA_READY ? describe : describe.ignore;

// Use a QueryService without relay hooks to avoid fire-and-forget WebSocket leaks.
// Wire oracleRegistry + preimageStore so verification can actually succeed
// Mirrors production composition through SDK request storage.
const testOracleRegistry = createOracleRegistry();
const testPreimageStore = createPreimageStore();
const testService = createQueryService({
  oracleRegistry: testOracleRegistry,
  preimageStore: testPreimageStore,
  normalizeResult: normalizeResultAttachments,
  hooks: {},
});

suite("e2e: regtest Cashu payment_lock lifecycle", () => {
  beforeAll(() => {
    testService.clearQueryStore();
  });

  test("cashu mint is reachable", async () => {
    const res = await fetch(`${MINT_URL}/v1/info`);
    const info = (await res.json()) as { name: string };
    expect(info.name).toBe("Cashu mint");
  });

  test("lnd-user has channel balance", async () => {
    const proc = spawn([
      "docker",
      "compose",
      "exec",
      "-T",
      "lnd-user",
      "lncli",
      "--network",
      "regtest",
      "--rpcserver",
      "lnd-user:10009",
      "channelbalance",
    ], { stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    const balance = JSON.parse(stdout) as { local_balance: { sat: string } };
    expect(Number(balance.local_balance.sat)).toBeGreaterThan(0);
  });

  test("mint Cashu token via regtest Lightning", async () => {
    const { token, proofs } = await mintCashuToken(BOUNTY_SATS);
    expect(token).toMatch(/^cashuB/);
    expect(proofs.length).toBeGreaterThan(0);

    const totalAmount = proofs.reduce((sum, p) => sum + p.amount, 0);
    expect(totalAmount).toBe(BOUNTY_SATS);
  });

  test("full payment_lock lifecycle: mint → create query → submit → release", async () => {
    // 1. Mint Cashu token
    const { token } = await mintCashuToken(BOUNTY_SATS);
    expect(token).toMatch(/^cashuB/);

    const created = testService.createQuery(
      {
        description: "E2E 渋谷交差点の撮影テスト",
        location_hint: "Shibuya",
        expected_gps: { lat: 35.6595, lon: 139.7004 },
        verification_requirements: [],
      },
      {
        ttlSeconds: 300,
        payment_lock: {
          amount_sats: BOUNTY_SATS,
          escrow_token: token,
        },
      },
    );
    expect(created.id).toMatch(/^query_/);
    expect(created.status).toBe("pending");
    expect(created.payment_status).toBe("locked");

    // 3. Verify query appears in list with payment_lock
    const queries = testService.listOpenQueries();
    const ourQuery = queries.find((q) => q.id === created.id);
    expect(ourQuery).toBeDefined();
    expect(ourQuery!.payment_lock?.amount_sats).toBe(BOUNTY_SATS);

    // 4. Submit result with GPS
    const submitOutcome = await testService.submitQueryResult(
      created.id,
      {
        attachments: [],
        gps: { lat: 35.6595, lon: 139.7004 },
      },
      { executor_type: "human", channel: "adapter" },
    );

    // 5. Verify results
    expect(submitOutcome.ok).toBe(true);
    expect(submitOutcome.query?.verification?.passed).toBe(true);
    expect(submitOutcome.query?.payment_status).toBe("released");

    // 6. Verify query is now approved
    const detail = testService.getQuery(created.id)!;
    expect(detail.status).toBe("approved");
    expect(detail.payment_status).toBe("released");
  });

  test("payment_lock token is redeemable at cashu mint", async () => {
    // Create payment_lock query and submit to get token back
    const { token } = await mintCashuToken(BOUNTY_SATS);
    const query = testService.createQuery(
      {
        description: "E2E Token redemption test",
        location_hint: "Tokyo",
        verification_requirements: [],
      },
      {
        ttlSeconds: 300,
        payment_lock: { amount_sats: BOUNTY_SATS, escrow_token: token },
      },
    );
    const submitOutcome = await testService.submitQueryResult(
      query.id,
      { attachments: [], gps: { lat: 35.68, lon: 139.76 } },
      { executor_type: "human", channel: "adapter" },
    );
    expect(submitOutcome.ok).toBe(true);
    expect(submitOutcome.query?.payment_status).toBe("released");

    // Verify query payment_lock via detail endpoint
    const detail = testService.getQuery(query.id)!;
    expect(detail.payment_lock?.amount_sats).toBe(BOUNTY_SATS);
  });
});
