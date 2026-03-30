/**
 * E2E tests for the full regtest Cashu bounty flow.
 *
 * Tests the complete lifecycle:
 *   1. Mint Cashu tokens via regtest Lightning
 *   2. Create a query with bounty
 *   3. Submit a result
 *   4. Verify bounty release and Cashu token return
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
 *   bun test e2e/regtest-cashu.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Wallet, type Proof, getEncodedToken } from "@cashu/cashu-ts";
import { buildWorkerApiApp } from "../src/worker-api";
import { clearQueryStore } from "../src/query-service";
import { closePool } from "../src/nostr/client";

const MINT_URL = process.env.CASHU_MINT_URL ?? "http://localhost:3338";
const BOUNTY_SATS = 21;

async function isCashuMintReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${MINT_URL}/v1/info`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function isLndUserReachable(): Promise<boolean> {
  try {
    const proc = Bun.spawn([
      "docker", "compose", "exec", "-T", "lnd-user",
      "lncli", "--network", "regtest", "--rpcserver", "lnd-user:10009",
      "getinfo",
    ], { stdout: "pipe", stderr: "pipe" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

async function payInvoiceViaLndUser(bolt11: string): Promise<boolean> {
  try {
    const proc = Bun.spawn([
      "docker", "compose", "exec", "-T", "lnd-user",
      "lncli", "--network", "regtest", "--rpcserver", "lnd-user:10009",
      "payinvoice", "--force", bolt11,
    ], { stdout: "pipe", stderr: "pipe" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

async function mintCashuToken(amountSats: number): Promise<{ token: string; proofs: Proof[] }> {
  const wallet = new Wallet(MINT_URL, { unit: "sat" });
  await wallet.loadMint();

  const mintQuote = await wallet.createMintQuote(amountSats);
  const paid = await payInvoiceViaLndUser(mintQuote.request);
  if (!paid) throw new Error("Failed to pay Lightning invoice via lnd-user");

  await Bun.sleep(2000);

  const proofs = await wallet.mintProofs(amountSats, mintQuote.quote);
  const token = getEncodedToken({ mint: MINT_URL, proofs });
  return { token, proofs };
}

describe("e2e: regtest Cashu bounty lifecycle", () => {
  let mintReachable = false;
  let lndReachable = false;

  beforeAll(async () => {
    [mintReachable, lndReachable] = await Promise.all([
      isCashuMintReachable(),
      isLndUserReachable(),
    ]);
    if (!mintReachable) {
      console.warn(`[e2e] Cashu mint not reachable at ${MINT_URL} – skipping.`);
      console.warn("  Run: docker compose up -d && ./scripts/init-regtest.sh && docker compose restart cashu-mint");
    }
    if (!lndReachable) {
      console.warn("[e2e] lnd-user not reachable – skipping.");
    }
    clearQueryStore();
  });

  afterAll(() => {
    closePool();
  });

  test("cashu mint is reachable", async () => {
    if (!mintReachable) {
      console.warn("[e2e] SKIPPED – cashu mint not reachable");
      return;
    }
    const res = await fetch(`${MINT_URL}/v1/info`);
    const info = (await res.json()) as { name: string };
    expect(info.name).toBe("Cashu mint");
  });

  test("lnd-user has channel balance", async () => {
    if (!lndReachable) {
      console.warn("[e2e] SKIPPED – lnd-user not reachable");
      return;
    }
    const proc = Bun.spawn([
      "docker", "compose", "exec", "-T", "lnd-user",
      "lncli", "--network", "regtest", "--rpcserver", "lnd-user:10009",
      "channelbalance",
    ], { stdout: "pipe", stderr: "pipe" });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    const balance = JSON.parse(stdout) as { local_balance: { sat: string } };
    expect(Number(balance.local_balance.sat)).toBeGreaterThan(0);
  });

  test("mint Cashu token via regtest Lightning", async () => {
    if (!mintReachable || !lndReachable) {
      console.warn("[e2e] SKIPPED – infrastructure not ready");
      return;
    }

    const { token, proofs } = await mintCashuToken(BOUNTY_SATS);
    expect(token).toStartWith("cashuB");
    expect(proofs.length).toBeGreaterThan(0);

    const totalAmount = proofs.reduce((sum, p) => sum + p.amount, 0);
    expect(totalAmount).toBe(BOUNTY_SATS);
  }, 30_000);

  test("full bounty lifecycle: mint → create query → submit → release", async () => {
    if (!mintReachable || !lndReachable) {
      console.warn("[e2e] SKIPPED – infrastructure not ready");
      return;
    }

    const app = buildWorkerApiApp();

    // 1. Mint Cashu token
    const { token } = await mintCashuToken(BOUNTY_SATS);
    expect(token).toStartWith("cashuB");

    // 2. Create query with bounty
    const createRes = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "E2E 渋谷交差点の撮影テスト",
        location_hint: "Shibuya",
        expected_gps: { lat: 35.6595, lon: 139.7004 },
        ttl_seconds: 300,
        verification_requirements: [],
        bounty: {
          amount_sats: BOUNTY_SATS,
          cashu_token: token,
        },
      }),
    });
    expect(createRes.status).toBe(201);

    const created = (await createRes.json()) as {
      query_id: string;
      status: string;
      payment_status: string;
    };
    expect(created.query_id).toStartWith("query_");
    expect(created.status).toBe("pending");
    expect(created.payment_status).toBe("locked");

    // 3. Verify query appears in list with bounty
    const listRes = await app.request("http://localhost/queries");
    const queries = (await listRes.json()) as Array<{
      id: string;
      bounty: { amount_sats: number };
    }>;
    const ourQuery = queries.find((q) => q.id === created.query_id);
    expect(ourQuery).toBeDefined();
    expect(ourQuery!.bounty.amount_sats).toBe(BOUNTY_SATS);

    // 4. Submit result with GPS
    const submitRes = await app.request(
      `http://localhost/queries/${created.query_id}/result`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          worker_pubkey: "e2e_test_worker",
          blob_hash: "e2e_test_hash_deadbeef",
          blob_url: "http://localhost:3333/e2e-test.jpg",
          gps: { lat: 35.6595, lon: 139.7004 },
          timestamp_ms: Date.now(),
        }),
      },
    );
    expect(submitRes.status).toBe(200);

    const submitJson = (await submitRes.json()) as {
      ok: boolean;
      message: string;
      verification: { passed: boolean };
      payment_status: string;
      bounty_amount_sats: number;
      cashu_token: string | null;
    };

    // 5. Verify results
    expect(submitJson.ok).toBe(true);
    expect(submitJson.verification.passed).toBe(true);
    expect(submitJson.payment_status).toBe("released");
    expect(submitJson.bounty_amount_sats).toBe(BOUNTY_SATS);
    expect(submitJson.cashu_token).not.toBeNull();
    expect(submitJson.cashu_token!).toStartWith("cashuB");

    // 6. Verify query is now approved
    const detailRes = await app.request(
      `http://localhost/queries/${created.query_id}`,
    );
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as {
      status: string;
      payment_status: string;
    };
    expect(detail.status).toBe("approved");
    expect(detail.payment_status).toBe("released");
  }, 60_000);

  test("bounty token is redeemable at cashu mint", async () => {
    if (!mintReachable || !lndReachable) {
      console.warn("[e2e] SKIPPED – infrastructure not ready");
      return;
    }

    const app = buildWorkerApiApp();

    // Create bounty query and submit to get token back
    const { token } = await mintCashuToken(BOUNTY_SATS);
    const createRes = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "E2E Token redemption test",
        location_hint: "Tokyo",
        ttl_seconds: 300,
        verification_requirements: [],
        bounty: { amount_sats: BOUNTY_SATS, cashu_token: token },
      }),
    });
    const { query_id } = (await createRes.json()) as { query_id: string };

    const submitRes = await app.request(
      `http://localhost/queries/${query_id}/result`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          worker_pubkey: "e2e_redeem_worker",
          gps: { lat: 35.68, lon: 139.76 },
          timestamp_ms: Date.now(),
        }),
      },
    );
    const { cashu_token: returnedToken } = (await submitRes.json()) as {
      cashu_token: string;
    };
    expect(returnedToken).toStartWith("cashuB");

    // Verify token is valid by decoding and checking proofs
    const { getDecodedToken } = await import("@cashu/cashu-ts");
    const decoded = getDecodedToken(returnedToken);
    expect(decoded.mint).toBe(MINT_URL);
    expect(decoded.proofs.length).toBeGreaterThan(0);
    const totalAmount = decoded.proofs.reduce((sum, p) => sum + p.amount, 0);
    expect(totalAmount).toBe(BOUNTY_SATS);
  }, 60_000);
});
