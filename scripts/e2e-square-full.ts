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
// Step 1: Seller creates Anchr query
// ============================================================
console.log(`[${elapsed()}] === Step 1: Seller creates Anchr query ===`);

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
    bounty: { amount_sats: 100_000 },
  }),
});

const queryData = await queryResp.json();
const QUERY_ID = queryData.query_id;
console.log(`[${elapsed()}] Query ID: ${QUERY_ID}`);
console.log(`[${elapsed()}] Status: ${queryData.status}`);

if (!QUERY_ID) {
  console.error("Failed to create query:", JSON.stringify(queryData));
  process.exit(1);
}

// ============================================================
// Step 2: Seller creates Square Payment Link
// ============================================================
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
console.log(`[${elapsed()}] Payment Link: ${PAYMENT_LINK_URL}`);

// ============================================================
// Step 3: Buyer pays via browser (Sandbox Testing Panel)
// ============================================================
console.log(`\n[${elapsed()}] === Step 3: Buyer pays via browser ===`);

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();
await page.goto(PAYMENT_LINK_URL!);
await page.waitForLoadState("networkidle");

// Navigate Sandbox Testing Panel: Next → Next (completes payment)
const nextButton = page.locator('button:has-text("Next")').first();
if (await nextButton.count() > 0) {
  await nextButton.click();
  await page.waitForTimeout(2000);
  const completeButton = page.locator('button:has-text("Next"), button:has-text("Complete")').first();
  if (await completeButton.count() > 0) {
    await completeButton.click();
    await page.waitForTimeout(3000);
  }
}
console.log(`[${elapsed()}] Payment completed in browser`);
await browser.close();

// ============================================================
// Step 4: Buyer gets Payment ID
// ============================================================
console.log(`\n[${elapsed()}] === Step 4: Buyer gets Payment ID ===`);

const paymentsResp = await fetch("https://connect.squareupsandbox.com/v2/payments?sort_order=DESC&limit=1", {
  headers: {
    "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  },
});
const paymentsData = await paymentsResp.json();
const payment = paymentsData.payments?.[0];
const PAYMENT_ID = payment?.id;
console.log(`[${elapsed()}] Payment ID: ${PAYMENT_ID} (status: ${payment?.status})`);

if (payment?.status !== "COMPLETED") {
  console.error("Payment not completed!");
  process.exit(1);
}

// ============================================================
// Step 5: Buyer generates TLSNotary proof
// ============================================================
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

console.log(`[${elapsed()}] Proof generated in ${proveTime}s (${proofB64.length} chars base64)`);
for (const line of stderr.split("\n").filter(l => l.includes("[tlsn-prove]"))) {
  console.log(`  ${line}`);
}

// ============================================================
// Step 6: Buyer submits proof to Anchr
// ============================================================
console.log(`\n[${elapsed()}] === Step 6: Buyer submits proof to Anchr ===`);

const submitResp = await fetch(`${ANCHR_URL}/queries/${QUERY_ID}/submit`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    tlsn_presentation: proofB64,
  }),
});

const submitResult = await submitResp.json();
console.log(`[${elapsed()}] Submit result:`, JSON.stringify(submitResult, null, 2));

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

// Final result
const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\n${"=".repeat(60)}`);
if (statusData.status === "approved") {
  console.log(`✓ E2E SUCCESS in ${totalTime}s`);
  console.log(`  Query: ${QUERY_ID}`);
  console.log(`  Payment: ${PAYMENT_ID}`);
  console.log(`  Proof time: ${proveTime}s`);
} else {
  console.log(`✗ E2E FAILED — status: ${statusData.status}`);
  process.exit(1);
}
