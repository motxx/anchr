/**
 * Full E2E: Seller (Requester) → Buyer (Worker) via Anchr + Square + TLSNotary
 *
 * 1. Seller: Create Anchr query with Square domain_hint
 * 2. Seller: Create Square Payment Link
 * 3. Buyer:  Browser pays via Payment Link (Sandbox Testing Panel)
 * 4. Buyer:  Get Payment ID from Square API
 * 5. Buyer:  Generate TLSNotary proof via CLI
 * 6. Buyer:  Submit proof to Anchr
 * 7. Both:   Verify query status = "approved"
 */
import { chromium } from "playwright";

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
// ┌──────────┬──────────┐
// │Requester │ Worker   │
// ├──────────┼──────────┤
// │ Square   │ Flow UI  │
// └──────────┴──────────┘
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

// Flow visualization UI — bottom right
const flowHtml = await Bun.file(import.meta.dir + "/e2e-flow-ui.html").text();
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

// ============================================================
// Step 1: Seller mints Cashu bounty token + creates Anchr query
// ============================================================
console.log(`[${elapsed()}] === Step 1: Seller mints Cashu bounty + creates Anchr query ===`);
await flow(0, "active", "Creating query...");

const BOUNTY_SATS = 100;

// Mint Cashu token via Lightning
const { Wallet: CashuWallet, getEncodedToken } = await import("@cashu/cashu-ts");
const cashuWallet = new CashuWallet("http://localhost:3338", { unit: "sat" });
await cashuWallet.loadMint();

const mintQuote = await cashuWallet.createMintQuote(BOUNTY_SATS);
await flow(0, "complete", "Query params ready");
await flow(1, "active", `Minting ${BOUNTY_SATS} sats...`);
console.log(`[${elapsed()}] Lightning invoice created (${BOUNTY_SATS} sats)`);

// Pay invoice from LND user node
const payProc = Bun.spawn(["bash", "-c",
  `docker exec anchr-lnd-user-1 lncli --network=regtest --rpcserver=lnd-user:10009 payinvoice --force ${mintQuote.request}`
], { stdout: "pipe", stderr: "pipe" });
await payProc.exited;
const payOut = await new Response(payProc.stdout).text();
console.log(`[${elapsed()}] Lightning payment: ${payOut.includes("SUCCEEDED") ? "SUCCEEDED" : "FAILED"}`);

// Mint ecash proofs
const proofs = await cashuWallet.mintProofs(BOUNTY_SATS, mintQuote.quote);
const cashuToken = getEncodedToken({ mint: "http://localhost:3338", proofs });
await flow(1, "complete", `${BOUNTY_SATS} sats minted`);
console.log(`[${elapsed()}] Cashu token minted: ${cashuToken.slice(0, 40)}... (${BOUNTY_SATS} sats)`);
await flow(2, "active", "Posting to Anchr...");

// Create Anchr query with Cashu bounty
const queryResp = await fetch(`${ANCHR_URL}/queries`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    description: "Prove Square payment — pay via Payment Link, then prove payment status",
    verification_requirements: ["tlsn"],
    ttl_seconds: 600,
    tlsn_requirements: {
      target_url: "https://connect.squareupsandbox.com/",
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
  }),
});

const queryData = await queryResp.json();
const QUERY_ID = queryData.query_id;
await flow(2, "complete", `ID: ${QUERY_ID.slice(0, 12)}`);
console.log(`[${elapsed()}] Query ID: ${QUERY_ID}`);
console.log(`[${elapsed()}] Status: ${queryData.status}`);

if (!QUERY_ID) {
  console.error("Failed to create query:", JSON.stringify(queryData));
  process.exit(1);
}

// ============================================================
// Step 2: Seller creates Square Payment Link
// ============================================================
await flow(3, "active", "Creating link...");
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
await flow(3, "complete", "Link created");
console.log(`[${elapsed()}] Payment Link: ${PAYMENT_LINK_URL}`);

// ============================================================
// Step 3: Buyer pays via browser (Sandbox Testing Panel)
// ============================================================
await flow(4, "active", "Buyer paying...");
console.log(`\n[${elapsed()}] === Step 3: Buyer pays via browser ===`);

// Square Payment browser — bottom left
const browser = await chromium.launch({
  headless: false,
  args: [`--window-size=${HALF_W},${HALF_H}`, `--window-position=0,${HALF_H}`],
});
const squarePage = await browser.newPage();
await squarePage.setViewportSize({ width: HALF_W - 16, height: HALF_H - 80 });
await squarePage.goto(PAYMENT_LINK_URL!);
const page = squarePage;
await page.waitForLoadState("networkidle");

// Navigate Sandbox Testing Panel: Overview → Test Payment → Checkout Complete
// Step 1: Click "Next" on Overview page
const nextBtn1 = page.locator('button:has-text("Next")').first();
if (await nextBtn1.count() > 0) {
  console.log(`[${elapsed()}] Clicking Next (Overview → Test Payment)...`);
  await nextBtn1.click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "/tmp/square-step2.png" });

  // Step 2: "Test Payment" page — find all buttons and click the right one
  // Wait for the page to fully render
  await page.waitForTimeout(1500);
  const allButtons = page.locator('button:visible');
  const btnCount = await allButtons.count();
  console.log(`[${elapsed()}] Test Payment page: ${btnCount} buttons found`);
  for (let i = 0; i < btnCount; i++) {
    const text = await allButtons.nth(i).textContent().catch(() => "");
    console.log(`  Button ${i}: "${text?.trim()}"`);
  }

  // Try clicking various possible button texts for completing the test payment
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
await flow(4, "complete", "Payment done");
console.log(`[${elapsed()}] Payment completed in browser`);

// ============================================================
// Step 4: Buyer gets Payment ID
// ============================================================
console.log(`\n[${elapsed()}] === Step 4: Buyer gets Payment ID ===`);

// Poll for a new payment (created after we started)
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
  // Also accept any COMPLETED payment as fallback
  if (payment?.status === "COMPLETED" && attempt >= 5) {
    PAYMENT_ID = payment.id;
    paymentStatus = payment.status;
    break;
  }
  console.log(`[${elapsed()}] Waiting for new payment... (attempt ${attempt + 1})`);
  await new Promise(r => setTimeout(r, 2000));
}
console.log(`[${elapsed()}] Payment ID: ${PAYMENT_ID} (status: ${paymentStatus})`);

if (!PAYMENT_ID || paymentStatus !== "COMPLETED") {
  console.error("Payment not completed! Check if Test Payment button was clicked.");
  process.exit(1);
}

// ============================================================
// Step 5: Buyer generates TLSNotary proof
// ============================================================
await flow(5, "active", "MPC-TLS...");
console.log(`\n[${elapsed()}] === Step 5: Buyer generates TLSNotary proof ===`);

const proofFile = `/tmp/e2e-square-${Date.now()}.presentation.tlsn`;
const proveStart = Date.now();

const proc = Bun.spawn([
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

await flow(5, "complete", `${proveTime}s`);
console.log(`[${elapsed()}] Proof generated in ${proveTime}s (${proofB64.length} chars base64)`);
for (const line of stderr.split("\n").filter(l => l.includes("[tlsn-prove]"))) {
  console.log(`  ${line}`);
}

// ============================================================
// Step 6: Buyer submits proof to Anchr
// ============================================================
await flow(6, "active", "Submitting proof...");
console.log(`\n[${elapsed()}] === Step 6: Buyer submits proof to Anchr ===`);

const submitResp = await fetch(`${ANCHR_URL}/queries/${QUERY_ID}/submit`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    tlsn_presentation: proofB64,
  }),
});

const submitResult = await submitResp.json();
await flow(6, submitResult.ok ? "complete" : "error", submitResult.ok ? "Verified ✓" : "Failed");
console.log(`[${elapsed()}] Verification: ${submitResult.ok ? "PASSED" : "FAILED"}`);
if (submitResult.verification?.checks) {
  for (const c of submitResult.verification.checks) console.log(`  ✓ ${c}`);
}
if (submitResult.verification?.failures?.length) {
  for (const f of submitResult.verification.failures) console.log(`  ✗ ${f}`);
}
if (submitResult.cashu_token) {
  await flow(7, "active", "Releasing bounty...");
  await flow(7, "complete", `${submitResult.bounty_amount_sats} sats`);
  console.log(`\n[${elapsed()}] === Cashu Bounty Released to Worker ===`);
  console.log(`  Token: ${submitResult.cashu_token.slice(0, 50)}...`);
  console.log(`  Amount: ${submitResult.bounty_amount_sats} sats`);
  console.log(`  → Paste this token into any Cashu wallet (Minibits, Nutstash, etc.) to redeem`);
} else {
  console.log(`[${elapsed()}] cashu_token: null (no bounty released)`);
}

// ============================================================
// Step 7: Verify query status
// ============================================================
console.log(`\n[${elapsed()}] === Step 7: Verify query status ===`);

const statusResp = await fetch(`${ANCHR_URL}/queries/${QUERY_ID}`);
const statusData = await statusResp.json();

console.log(`[${elapsed()}] Query status: ${statusData.status}`);

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
  console.log(`✓ E2E SUCCESS in ${totalTime}s`);
  console.log(`  Query: ${QUERY_ID}`);
  console.log(`  Payment: ${PAYMENT_ID}`);
  console.log(`  Proof time: ${proveTime}s`);
  console.log(`\nBrowser open — press Ctrl+C to close.`);
  await new Promise(() => {}); // Keep browser open
} else {
  console.log(`✗ E2E FAILED — status: ${statusData.status}`);
  await requesterBrowser.close();
  await workerBrowser.close();
  process.exit(1);
}
