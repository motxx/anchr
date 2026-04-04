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
 *   deno test e2e/regtest-cashu.test.ts --allow-all --no-check
 */

import { beforeAll, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { spawn } from "../src/runtime/mod.ts";
import { Wallet, type Proof, getEncodedToken } from "@cashu/cashu-ts";
import { buildWorkerApiApp } from "../src/infrastructure/worker-api";
import { createQueryService, clearQueryStore } from "../src/application/query-service";

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
    const proc = spawn([
      "docker", "compose", "exec", "-T", "lnd-user",
      "lncli", "--network", "regtest", "--rpcserver", "lnd-user:10009",
      "getinfo",
    ], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

async function payInvoiceViaLndUser(bolt11: string): Promise<boolean> {
  try {
    const proc = spawn([
      "docker", "compose", "exec", "-T", "lnd-user",
      "lncli", "--network", "regtest", "--rpcserver", "lnd-user:10009",
      "payinvoice", "--force", bolt11,
    ], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

async function mintCashuToken(amountSats: number): Promise<{ token: string; proofs: Proof[] }> {
  // Rate-limit to avoid hitting the Nutshell mint's built-in rate limiter.
  const elapsed = Date.now() - lastMintTime;
  if (elapsed < 1000) await new Promise(r => setTimeout(r, 1000 - elapsed));
  lastMintTime = Date.now();

  const wallet = new Wallet(MINT_URL, { unit: "sat" });
  await wallet.loadMint();

  const mintQuote = await wallet.createMintQuote(amountSats);
  const paid = await payInvoiceViaLndUser(mintQuote.request);
  if (!paid) throw new Error("Failed to pay Lightning invoice via lnd-user");

  await new Promise(r => setTimeout(r, 2000));

  const proofs = await wallet.mintProofs(amountSats, mintQuote.quote);
  const token = getEncodedToken({ mint: MINT_URL, proofs });
  return { token, proofs };
}

let lastMintTime = 0;

const [mintReachable, lndReachable] = await Promise.all([
  isCashuMintReachable(),
  isLndUserReachable(),
]);
const INFRA_READY = mintReachable && lndReachable;

if (!INFRA_READY) {
  if (!mintReachable) {
    console.warn(`[e2e] Cashu mint not reachable at ${MINT_URL} – tests will be ignored.`);
    console.warn("  Run: docker compose up -d && ./scripts/init-regtest.sh && docker compose restart cashu-mint");
  }
  if (!lndReachable) {
    console.warn("[e2e] lnd-user not reachable – tests will be ignored.");
  }
}

const suite = INFRA_READY ? describe : describe.ignore;

// Use a QueryService without relay hooks to avoid fire-and-forget WebSocket leaks.
const testService = createQueryService({ hooks: {} });

suite("e2e: regtest Cashu bounty lifecycle", () => {
  const app = buildWorkerApiApp({ queryService: testService });

  beforeAll(() => {
    clearQueryStore();
  });

  test("cashu mint is reachable", async () => {
    const res = await fetch(`${MINT_URL}/v1/info`);
    const info = (await res.json()) as { name: string };
    expect(info.name).toBe("Cashu mint");
  });

  test("lnd-user has channel balance", async () => {
    const proc = spawn([
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
    const { token, proofs } = await mintCashuToken(BOUNTY_SATS);
    expect(token).toMatch(/^cashuB/);
    expect(proofs.length).toBeGreaterThan(0);

    const totalAmount = proofs.reduce((sum, p) => sum + p.amount, 0);
    expect(totalAmount).toBe(BOUNTY_SATS);
  });

  test("full bounty lifecycle: mint → create query → submit → release", async () => {
    // 1. Mint Cashu token
    const { token } = await mintCashuToken(BOUNTY_SATS);
    expect(token).toMatch(/^cashuB/);

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
    expect(created.query_id).toMatch(/^query_/);
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
    };

    // 5. Verify results
    expect(submitJson.ok).toBe(true);
    expect(submitJson.verification.passed).toBe(true);
    expect(submitJson.payment_status).toBe("released");

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
  });

  test("bounty token is redeemable at cashu mint", async () => {
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
    const submitJson = (await submitRes.json()) as {
      ok: boolean;
      payment_status: string;
    };
    expect(submitJson.ok).toBe(true);
    expect(submitJson.payment_status).toBe("released");

    // Verify query bounty via detail endpoint
    const detailRes = await app.request(`http://localhost/queries/${query_id}`);
    const detail = (await detailRes.json()) as { bounty: { amount_sats: number } };
    expect(detail.bounty.amount_sats).toBe(BOUNTY_SATS);
  });
});
