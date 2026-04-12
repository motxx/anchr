/**
 * E2E: Square Payment Link → カード入力 → TLSNotary proof (CLI)
 *
 * 1. Payment Link を作成
 * 2. ブラウザでカード入力・支払い
 * 3. Payment ID を取得
 * 4. tlsn-prove で proof 生成
 */
import { chromium } from "playwright";
import { spawn } from "../src/runtime/mod.ts";

const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
if (!SQUARE_ACCESS_TOKEN) {
  console.error("SQUARE_ACCESS_TOKEN required in environment");
  process.exit(1);
}

// --- Step 1: Get Location ID ---
console.log("=== Step 1: Setup ===");
const locResp = await fetch("https://connect.squareupsandbox.com/v2/locations", {
  headers: { "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}` },
});
const locData = await locResp.json();
const LOCATION_ID = locData.locations?.[0]?.id;
console.log("Location ID:", LOCATION_ID);

// --- Step 2: Create Payment Link ---
console.log("\n=== Step 2: Create Payment Link ===");
const linkResp = await fetch("https://connect.squareupsandbox.com/v2/online-checkout/payment-links", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    quick_pay: {
      name: "BTC Swap Test ¥100",
      price_money: { amount: 100, currency: "JPY" },
      location_id: LOCATION_ID,
    },
  }),
});
const linkData = await linkResp.json();
const PAYMENT_LINK_URL = linkData.payment_link?.url;
const ORDER_ID = linkData.payment_link?.order_id;
console.log("Payment Link:", PAYMENT_LINK_URL);
console.log("Order ID:", ORDER_ID);

if (!PAYMENT_LINK_URL) {
  console.error("Failed to create Payment Link:", JSON.stringify(linkData));
  process.exit(1);
}

// --- Step 3: Open browser and pay ---
console.log("\n=== Step 3: Browser payment ===");
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

console.log("Opening Payment Link...");
await page.goto(PAYMENT_LINK_URL);
await page.waitForLoadState("networkidle");
await page.waitForTimeout(3000);
await page.screenshot({ path: "/tmp/square-e2e-1-loaded.png" });
console.log("Screenshot: /tmp/square-e2e-1-loaded.png");

// Square Sandbox Payment Link shows a "Sandbox Testing Panel"
// with steps: Overview → Test Payment → Checkout Complete
// Click through the steps to simulate payment.

console.log("Navigating Sandbox Testing Panel...");

// Step 1: Click "Next" on Overview
const nextButton = page.locator('button:has-text("Next")').first();
if (await nextButton.count() > 0) {
  console.log("Clicking Next (Overview → Test Payment)...");
  await nextButton.click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "/tmp/square-e2e-2-test-payment.png" });
  console.log("Screenshot: /tmp/square-e2e-2-test-payment.png");

  // Step 2: On "Test Payment" step, there should be a button to complete
  const completeButton = page.locator('button:has-text("Next"), button:has-text("Complete"), button:has-text("Pay"), button:has-text("Simulate")').first();
  if (await completeButton.count() > 0) {
    console.log("Clicking to complete payment...");
    await completeButton.click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: "/tmp/square-e2e-3-complete.png" });
    console.log("Screenshot: /tmp/square-e2e-3-complete.png");
  }
} else {
  console.log("Next button not found. Taking screenshot.");
  await page.screenshot({ path: "/tmp/square-e2e-2-debug.png" });
}

await browser.close();

// --- Step 4: Find Payment ID from Order ---
console.log("\n=== Step 4: Find Payment ID ===");
// Wait a moment for payment to process
await new Promise(r => setTimeout(r, 3000));

// Get the order to find the payment
const orderResp = await fetch(`https://connect.squareupsandbox.com/v2/orders/${ORDER_ID}`, {
  method: "POST",  // Square's RetrieveOrder is POST-based via batch
  headers: {
    "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({}),
});

// Also try listing recent payments
const paymentsResp = await fetch("https://connect.squareupsandbox.com/v2/payments?sort_order=DESC&limit=1", {
  headers: {
    "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  },
});
const paymentsData = await paymentsResp.json();
const latestPayment = paymentsData.payments?.[0];

if (latestPayment) {
  console.log("Latest Payment:", {
    id: latestPayment.id,
    status: latestPayment.status,
    amount: latestPayment.amount_money,
    created_at: latestPayment.created_at,
  });

  if (latestPayment.status === "COMPLETED") {
    const PAYMENT_ID = latestPayment.id;

    // --- Step 5: TLSNotary proof ---
    console.log("\n=== Step 5: TLSNotary proof ===");
    console.log(`Running tlsn-prove against Payment ID: ${PAYMENT_ID}`);

    const proc = spawn([
      "./crates/tlsn-prover/target/release/tlsn-prove",
      "--verifier", "localhost:7046",
      "--max-recv-data", "4096",
      "--max-sent-data", "4096",
      "-H", `Authorization: Bearer ${SQUARE_ACCESS_TOKEN}`,
      `https://connect.squareupsandbox.com/v2/payments/${PAYMENT_ID}`,
      "-o", "/tmp/square-e2e-proof.presentation.tlsn",
    ], { stdout: "pipe", stderr: "pipe" });

    const startTime = Date.now();
    await proc.exited;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const stderr = await new Response(proc.stderr).text();
    console.log(stderr);

    if (proc.exitCode === 0) {
      const stdout = await new Response(proc.stdout).text();
      console.log(`\n=== PROOF GENERATED in ${elapsed}s ===`);
      console.log(`Proof file: /tmp/square-e2e-proof.presentation.tlsn`);
      console.log(`Base64 length: ${stdout.trim().length}`);
    } else {
      console.error(`tlsn-prove failed (exit ${proc.exitCode})`);
    }
  } else {
    console.log(`Payment status is ${latestPayment.status}, not COMPLETED.`);
    console.log("The Payment Link checkout may not have completed.");
  }
} else {
  console.log("No payments found. The checkout may not have completed.");
  console.log("You can still run proof with an existing Payment ID.");
}
