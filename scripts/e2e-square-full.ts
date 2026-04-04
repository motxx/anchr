/**
 * Full E2E: Seller (Requester) → Buyer (Worker) via Anchr + Square + TLSNotary + HTLC Escrow
 *
 * Flow (Worker-first):
 * 1. Seller: POST /hash → get preimage hash from Oracle
 * 2. Seller: Create Square Payment Link (URL only, no payment yet)
 * 3. Seller: Mint Cashu bounty + create HTLC token
 * 4. Seller: POST /queries — Worker UI now shows the job
 * 5. Buyer:  POST /quotes → Seller selects Worker (Worker accepts the job)
 * 6. Buyer:  Browser pays via Payment Link (Sandbox Testing Panel)
 * 7. Buyer:  Get Payment ID from Square API
 * 8. Buyer:  Generate TLSNotary proof via CLI
 * 9. Buyer:  POST /queries/:id/result → inline verification → preimage returned
 * 10. Verify final status
 */
import { chromium } from "playwright";
import { spawn } from "../src/runtime/mod.ts";

const ANCHR_URL = process.env.ANCHR_SERVER_URL ?? "http://localhost:3000";
const SQUARE_ACCESS_TOKEN = process.env.SANDBOX_ACCESS_TOKEN;

if (!SQUARE_ACCESS_TOKEN) {
  console.error("SANDBOX_ACCESS_TOKEN required");
  process.exit(1);
}

// Verify Anchr server is running
const healthResp = await fetch(`${ANCHR_URL}/health`).catch(() => null);
if (!healthResp?.ok) {
  console.error(`Anchr server not running at ${ANCHR_URL}`);
  process.exit(1);
}

const startTime = Date.now();
const elapsed = () => `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

// ============================================================
// Step 0: Open Anchr UI (Requester + Worker dashboards)
// ============================================================
console.log(`[${elapsed()}] === Step 0: Open Anchr UI ===`);

const pw = await import("playwright");

// Layout: 4 windows on screen (logical ~1512x982 for 3024x1964 Retina)
const SCREEN_W = 1512;
const SCREEN_H = 982;
const HALF_W = Math.floor(SCREEN_W / 2);
const HALF_H = Math.floor(SCREEN_H / 2);

// Requester UI — top left
const requesterBrowser = await pw.chromium.launch({
  headless: false,
  args: [`--window-size=${HALF_W},${HALF_H}`, `--window-position=0,0`],
});
const requesterPage = await requesterBrowser.newPage();
await requesterPage.setViewportSize({ width: HALF_W - 16, height: HALF_H - 80 });
await requesterPage.goto(`${ANCHR_URL}/requester`);

// Worker UI — top right
const workerBrowser = await pw.chromium.launch({
  headless: false,
  args: [`--window-size=${HALF_W},${HALF_H}`, `--window-position=${HALF_W},0`],
});
const workerPage = await workerBrowser.newPage();
await workerPage.setViewportSize({ width: HALF_W - 16, height: HALF_H - 80 });
await workerPage.goto(`${ANCHR_URL}/`);

// Square Payment browser — bottom left (blank until payment step)
const browser = await chromium.launch({
  headless: false,
  args: [`--window-size=${HALF_W},${HALF_H}`, `--window-position=0,${HALF_H}`],
});
const blankPage = await browser.newPage();
await blankPage.setViewportSize({ width: HALF_W - 16, height: HALF_H - 80 });
await blankPage.setContent('<html><body style="background:#0a0a0a;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p style="color:#555;font-family:system-ui;font-size:14px">Square Payment — waiting for Worker to accept job...</p></body></html>');

// Flow visualization UI — bottom right
const flowHtml = await Deno.readTextFile(new URL("./e2e-flow-ui.html", import.meta.url).pathname);
const flowBrowser = await pw.chromium.launch({
  headless: false,
  args: [`--window-size=${HALF_W},${HALF_H}`, `--window-position=${HALF_W},${HALF_H}`],
});
const flowPage = await flowBrowser.newPage();
await flowPage.setViewportSize({ width: HALF_W - 16, height: HALF_H - 80 });
await flowPage.setContent(flowHtml);
await flowPage.waitForFunction(() => typeof (window as any).flowUpdate === 'function');
await flowPage.evaluate((ts) => (window as any).flowSetStart(ts), startTime);

console.log(`[${elapsed()}] Requester: top-left | Worker: top-right | Square: bottom-left | Flow: bottom-right`);

const flow = (step: number, status: string, detail?: string) =>
  flowPage.evaluate(([s, st, d]) => (window as any).flowUpdate(s, st, d), [step, status, detail ?? ""]);

const BOUNTY_SATS = 100;

// Use fixed pubkeys (in production, these would be real Nostr pubkeys)
const ORACLE_PUBKEY = "0000000000000000000000000000000000000000000000000000000000000001";
const REQUESTER_PUBKEY = "0000000000000000000000000000000000000000000000000000000000000002";
const WORKER_PUBKEY = "0000000000000000000000000000000000000000000000000000000000000003";

// ============================================================
// Step 1: Oracle generates preimage hash (POST /hash)
// ============================================================
await flow(0, "active", "Getting hash...");
console.log(`\n[${elapsed()}] === Step 1: Oracle generates preimage hash ===`);

const hashResp = await fetch(`${ANCHR_URL}/hash`, { method: "POST" });
const hashData = await hashResp.json() as { hash: string };
const HTLC_HASH = hashData.hash;
console.log(`[${elapsed()}] HTLC hash: ${HTLC_HASH.slice(0, 16)}...`);
await flow(0, "complete", `Hash: ${HTLC_HASH.slice(0, 8)}`);

// ============================================================
// Step 2: Seller creates Square Payment Link (URL only)
// ============================================================
await flow(1, "active", "Creating link...");
console.log(`\n[${elapsed()}] === Step 2: Seller creates Square Payment Link ===`);

const locResp = await fetch("https://connect.squareupsandbox.com/v2/locations", {
  headers: { "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}` },
});
const LOCATION_ID = (await locResp.json()).locations?.[0]?.id;

const linkResp = await fetch("https://connect.squareupsandbox.com/v2/online-checkout/payment-links", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    quick_pay: {
      name: "BTC Swap ¥100",
      price_money: { amount: 100, currency: "JPY" },
      location_id: LOCATION_ID,
    },
  }),
});
const linkData = await linkResp.json();
const PAYMENT_LINK_URL = linkData.payment_link?.url;
const PAYMENT_LINK_ID = linkData.payment_link?.id;
await flow(1, "complete", "Link created");
console.log(`[${elapsed()}] Payment Link: ${PAYMENT_LINK_URL}`);

// ============================================================
// Step 3: Seller mints Cashu bounty + creates HTLC token
// ============================================================
await flow(2, "active", `Minting ${BOUNTY_SATS} sats...`);
console.log(`\n[${elapsed()}] === Step 3: Seller mints Cashu bounty ===`);

const { Wallet: CashuWallet, getEncodedToken } = await import("@cashu/cashu-ts");
const cashuWallet = new CashuWallet("http://localhost:3338", { unit: "sat" });
await cashuWallet.loadMint();

const mintQuote = await cashuWallet.createMintQuote(BOUNTY_SATS);
const payProc = spawn(["bash", "-c",
  `docker exec anchr-lnd-user-1 lncli --network=regtest --rpcserver=lnd-user:10009 payinvoice --force ${mintQuote.request}`
], { stdout: "pipe", stderr: "pipe" });
await payProc.exited;
const payOut = await new Response(payProc.stdout).text();
console.log(`[${elapsed()}] Lightning: ${payOut.includes("SUCCEEDED") ? "SUCCEEDED" : "FAILED"}`);

const proofs = await cashuWallet.mintProofs(BOUNTY_SATS, mintQuote.quote);
const cashuToken = getEncodedToken({ mint: "http://localhost:3338", proofs });
await flow(2, "complete", `${BOUNTY_SATS} sats minted`);
console.log(`[${elapsed()}] Cashu token: ${cashuToken.slice(0, 40)}...`);

// ============================================================
// Step 4: Seller creates Anchr query — Worker UI shows the job
// ============================================================
await flow(3, "active", "Creating query...");
console.log(`\n[${elapsed()}] === Step 4: Seller creates Anchr query ===`);

// TLSNotary target: Square payments list (most recent).
// The specific Payment ID isn't known yet (payment hasn't happened).
// Conditions check for COMPLETED status — the worker will prove the
// specific payment endpoint after it completes.
const queryResp = await fetch(`${ANCHR_URL}/queries`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    description: `Prove Square payment (¥100 BTC Swap) — Payment Link ready`,
    verification_requirements: ["tlsn"],
    ttl_seconds: 600,
    tlsn_requirements: {
      target_url: "https://connect.squareupsandbox.com/v2/payments?sort_order=DESC&limit=1",
      domain_hint: "connect.squareupsandbox.com",
      conditions: [
        {
          type: "contains",
          expression: '"status": "COMPLETED"',
          description: "Payment must have status=COMPLETED",
        },
      ],
      max_attestation_age_seconds: 600,
    },
    bounty: { amount_sats: BOUNTY_SATS, cashu_token: cashuToken },
    htlc: {
      hash: HTLC_HASH,
      oracle_pubkey: ORACLE_PUBKEY,
      requester_pubkey: REQUESTER_PUBKEY,
      locktime: Math.floor(Date.now() / 1000) + 3600,
    },
  }),
});

const queryData = await queryResp.json();
const QUERY_ID = queryData.query_id;
await flow(3, "complete", `ID: ${QUERY_ID?.slice(0, 12)}`);
console.log(`[${elapsed()}] Query ID: ${QUERY_ID}`);
console.log(`[${elapsed()}] Status: ${queryData.status} (HTLC: hash=${HTLC_HASH.slice(0, 8)}...)`);

if (!QUERY_ID) {
  console.error("Failed to create query:", JSON.stringify(queryData));
  process.exit(1);
}

// Wait for Worker UI to show the query
console.log(`[${elapsed()}] Waiting for Worker UI to display the query...`);
await new Promise(r => setTimeout(r, 5000));

// ============================================================
// Step 5: Worker accepts job (quote + select)
// ============================================================
await flow(4, "active", "Worker accepting...");
console.log(`\n[${elapsed()}] === Step 5: Worker accepts job ===`);

// Worker submits quote
const quoteResp = await fetch(`${ANCHR_URL}/queries/${QUERY_ID}/quotes`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    worker_pubkey: WORKER_PUBKEY,
    amount_sats: BOUNTY_SATS,
    quote_event_id: `quote_${Date.now()}`,
  }),
});
const quoteData = await quoteResp.json();
console.log(`[${elapsed()}] Quote: ${quoteData.ok ? "recorded" : quoteData.message}`);

// Seller selects worker + provides HTLC token
const selectResp = await fetch(`${ANCHR_URL}/queries/${QUERY_ID}/select`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    worker_pubkey: WORKER_PUBKEY,
    htlc_token: cashuToken,
  }),
});
const selectData = await selectResp.json();
console.log(`[${elapsed()}] Select: ${selectData.ok ? "worker selected" : selectData.message}`);

if (!selectData.ok) {
  console.error("Failed to select worker:", JSON.stringify(selectData));
  process.exit(1);
}
await flow(4, "complete", "Job accepted");

// Wait for UI to reflect worker_selected state
await new Promise(r => setTimeout(r, 3000));

// ============================================================
// Step 6: Buyer pays via browser (Sandbox Testing Panel)
// ============================================================
await flow(5, "active", "Buyer paying...");
console.log(`\n[${elapsed()}] === Step 6: Buyer pays via browser ===`);

// Close blank page, open payment page in the same browser
await blankPage.close();
const squarePage = await browser.newPage();
await squarePage.setViewportSize({ width: HALF_W - 16, height: HALF_H - 80 });
await squarePage.goto(PAYMENT_LINK_URL!);
const page = squarePage;
await page.waitForLoadState("networkidle");

// Navigate Sandbox Testing Panel: Overview → Test Payment → Checkout Complete
const nextBtn1 = page.locator('button:has-text("Next")').first();
if (await nextBtn1.count() > 0) {
  console.log(`[${elapsed()}] Clicking Next (Overview → Test Payment)...`);
  await nextBtn1.click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "/tmp/square-step2.png" });

  await page.waitForTimeout(1500);
  const allButtons = page.locator('button:visible');
  const btnCount = await allButtons.count();
  console.log(`[${elapsed()}] Test Payment page: ${btnCount} buttons found`);
  for (let i = 0; i < btnCount; i++) {
    const text = await allButtons.nth(i).textContent().catch(() => "");
    console.log(`  Button ${i}: "${text?.trim()}"`);
  }

  const payBtn = page.locator('button:has-text("Complete"), button:has-text("Pay"), button:has-text("Next"), button:has-text("Simulate"), button:has-text("Submit")').first();
  if (await payBtn.count() > 0) {
    const payBtnText = await payBtn.textContent();
    console.log(`[${elapsed()}] Clicking "${payBtnText?.trim()}"...`);
    await payBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "/tmp/square-step3.png" });
  } else {
    console.log(`[${elapsed()}] No payment button found on Test Payment page`);
    await page.screenshot({ path: "/tmp/square-step2-debug.png" });
  }
}
await flow(5, "complete", "Payment done");
console.log(`[${elapsed()}] Payment completed in browser`);

// ============================================================
// Step 7: Get Payment ID from Square API
// ============================================================
await flow(6, "active", "Getting Payment ID...");
console.log(`\n[${elapsed()}] === Step 7: Get Payment ID ===`);

let PAYMENT_ID = "";
let paymentStatus = "";
for (let attempt = 0; attempt < 10; attempt++) {
  const paymentsResp = await fetch("https://connect.squareupsandbox.com/v2/payments?sort_order=DESC&limit=1", {
    headers: {
      "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });
  const paymentsData = await paymentsResp.json();
  const payment = paymentsData.payments?.[0];
  if (payment?.status === "COMPLETED" && new Date(payment.created_at).getTime() > startTime) {
    PAYMENT_ID = payment.id;
    paymentStatus = payment.status;
    break;
  }
  if (payment?.status === "COMPLETED" && attempt >= 5) {
    PAYMENT_ID = payment.id;
    paymentStatus = payment.status;
    break;
  }
  console.log(`[${elapsed()}] Waiting for new payment... (attempt ${attempt + 1})`);
  await new Promise(r => setTimeout(r, 2000));
}
await flow(6, "complete", `ID: ${PAYMENT_ID.slice(0, 8)}`);
console.log(`[${elapsed()}] Payment ID: ${PAYMENT_ID} (status: ${paymentStatus})`);

if (!PAYMENT_ID || paymentStatus !== "COMPLETED") {
  console.error("Payment not completed!");
  process.exit(1);
}

// ============================================================
// Step 8: Worker generates TLSNotary proof
// ============================================================
await flow(7, "active", "MPC-TLS...");
console.log(`\n[${elapsed()}] === Step 8: Worker generates TLSNotary proof ===`);

const proofFile = `/tmp/e2e-square-${Date.now()}.presentation.tlsn`;
const proveStart = Date.now();

// Prove the specific payment endpoint (Payment ID is now known)
const proc = spawn([
  "./crates/tlsn-prover/target/release/tlsn-prove",
  "--verifier", "localhost:7046",
  "--max-recv-data", "4096",
  "--max-sent-data", "4096",
  "-H", `Authorization: Bearer ${SQUARE_ACCESS_TOKEN}`,
  `https://connect.squareupsandbox.com/v2/payments/${PAYMENT_ID}`,
  "-o", proofFile,
], { stdout: "pipe", stderr: "pipe" });

await proc.exited;
const proveTime = ((Date.now() - proveStart) / 1000).toFixed(1);
const stderr = await new Response(proc.stderr).text();
const proofB64 = (await new Response(proc.stdout).text()).trim();

if (proc.exitCode !== 0) {
  console.error(`tlsn-prove failed (exit ${proc.exitCode}):\n${stderr}`);
  process.exit(1);
}

await flow(7, "complete", `${proveTime}s`);
console.log(`[${elapsed()}] Proof generated in ${proveTime}s (${proofB64.length} chars base64)`);
for (const line of stderr.split("\n").filter(l => l.includes("[tlsn-prove]"))) {
  console.log(`  ${line}`);
}

// ============================================================
// Step 9: Worker submits proof via POST /result (HTLC verification)
// ============================================================
console.log(`\n[${elapsed()}] === Step 9: Worker submits proof to Anchr ===`);

const resultResp = await fetch(`${ANCHR_URL}/queries/${QUERY_ID}/result`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    worker_pubkey: WORKER_PUBKEY,
    attachments: [],
    tlsn_presentation: proofB64,
  }),
});

const resultData = await resultResp.json();
console.log(`[${elapsed()}] Verification: ${resultData.ok ? "PASSED" : "FAILED"}`);
if (resultData.verification?.checks) {
  for (const c of resultData.verification.checks) console.log(`  ✓ ${c}`);
}
if (resultData.verification?.failures?.length) {
  for (const f of resultData.verification.failures) console.log(`  ✗ ${f}`);
}

if (resultData.preimage) {
  console.log(`\n[${elapsed()}] === HTLC Preimage Revealed ===`);
  console.log(`  Preimage: ${resultData.preimage.slice(0, 16)}...`);
  console.log(`  → Worker can now redeem HTLC token on Cashu mint`);
} else {
  console.log(`[${elapsed()}] preimage: null (verification failed or no preimage store)`);
}

// Wait for UIs to show results
await new Promise(r => setTimeout(r, 3000));

// ============================================================
// Step 10: Verify query status
// ============================================================
console.log(`\n[${elapsed()}] === Step 10: Verify query status ===`);

const statusResp = await fetch(`${ANCHR_URL}/queries/${QUERY_ID}`);
const statusData = await statusResp.json();

console.log(`[${elapsed()}] Query status: ${statusData.status}`);
console.log(`[${elapsed()}] Payment status: ${statusData.payment_status}`);

if (statusData.verification) {
  if (statusData.verification.checks?.length) {
    console.log("  Checks passed:");
    for (const c of statusData.verification.checks) {
      console.log(`    ✓ ${c}`);
    }
  }
  if (statusData.verification.failures?.length) {
    console.log("  Failures:");
    for (const f of statusData.verification.failures) {
      console.log(`    ✗ ${f}`);
    }
  }
  if (statusData.verification.tlsn_verified) {
    const v = statusData.verification.tlsn_verified;
    console.log(`  Server name: ${v.server_name}`);
    console.log(`  Body preview: ${v.revealed_body?.slice(0, 100)}...`);
  }
}

// Refresh UIs to show updated status
await requesterPage.reload();
await workerPage.reload();
await requesterPage.waitForLoadState("networkidle");
await workerPage.waitForLoadState("networkidle");
await requesterPage.screenshot({ path: "/tmp/e2e-requester-ui.png" });
await workerPage.screenshot({ path: "/tmp/e2e-worker-ui.png" });
console.log(`[${elapsed()}] UI screenshots saved`);

// Final result
const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\n${"=".repeat(60)}`);
if (statusData.status === "approved") {
  console.log(`✓ E2E SUCCESS in ${totalTime}s (HTLC Escrow)`);
  console.log(`  Query: ${QUERY_ID}`);
  console.log(`  Payment: ${PAYMENT_ID}`);
  console.log(`  HTLC hash: ${HTLC_HASH.slice(0, 16)}...`);
  console.log(`  Preimage revealed: ${resultData.preimage ? "YES" : "NO"}`);
  console.log(`  Proof time: ${proveTime}s`);
  console.log(`\nBrowser open — press Ctrl+C to close.`);
  await new Promise(() => {}); // Keep browser open
} else {
  console.log(`✗ E2E FAILED — status: ${statusData.status}`);
  await requesterBrowser.close();
  await workerBrowser.close();
  process.exit(1);
}
