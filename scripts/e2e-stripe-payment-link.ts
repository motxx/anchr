/**
 * E2E: Stripe Payment Link → テストカード入力 → TLSNotary proof (CLI)
 *
 * 1. Product → Price → Payment Link を作成
 * 2. ブラウザでテストカード入力・支払い
 * 3. PaymentIntent ID を取得
 * 4. tlsn-prove で proof 生成
 */
import { chromium } from "playwright";
import { spawn } from "../src/runtime/mod.ts";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  console.error("STRIPE_SECRET_KEY required (test mode key starting with sk_test_)");
  process.exit(1);
}

const STRIPE_API = "https://api.stripe.com";
const stripeHeaders = {
  "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
  "Content-Type": "application/x-www-form-urlencoded",
};

const startTime = Date.now();

// --- Step 1: Create Product + Price ---
console.log("=== Step 1: Create Product + Price ===");

const productResp = await fetch(`${STRIPE_API}/v1/products`, {
  method: "POST",
  headers: stripeHeaders,
  body: "name=BTC+Swap+Test+¥100&type=service",
});
const productData = await productResp.json();
console.log("Product:", productData.id);

const priceResp = await fetch(`${STRIPE_API}/v1/prices`, {
  method: "POST",
  headers: stripeHeaders,
  body: `product=${productData.id}&unit_amount=100&currency=jpy`,
});
const priceData = await priceResp.json();
console.log("Price:", priceData.id);

// --- Step 2: Create Payment Link ---
console.log("\n=== Step 2: Create Payment Link ===");
const linkResp = await fetch(`${STRIPE_API}/v1/payment_links`, {
  method: "POST",
  headers: stripeHeaders,
  body: `line_items[0][price]=${priceData.id}&line_items[0][quantity]=1`,
});
const linkData = await linkResp.json();
const PAYMENT_LINK_URL = linkData.url;
console.log("Payment Link:", PAYMENT_LINK_URL);

if (!PAYMENT_LINK_URL) {
  console.error("Failed to create Payment Link:", JSON.stringify(linkData));
  process.exit(1);
}

// --- Step 3: Open browser and pay with test card ---
console.log("\n=== Step 3: Browser payment ===");
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

console.log("Opening Payment Link...");
await page.goto(PAYMENT_LINK_URL);
await page.waitForLoadState("networkidle");
await page.waitForTimeout(3000);
await page.screenshot({ path: "/tmp/stripe-e2e-1-loaded.png" });
console.log("Screenshot: /tmp/stripe-e2e-1-loaded.png");

// Fill email
const emailField = page.locator('input[name="email"], input[type="email"], input[placeholder*="email" i]').first();
if (await emailField.count() > 0) {
  await emailField.fill("test@example.com");
  console.log("Email filled");
}

// Fill card details in Stripe's iframe
console.log("Filling test card details (4242 4242 4242 4242)...");
const cardFrame = page.frameLocator('iframe[name*="__privateStripeFrame"], iframe[title*="card"]').first();

const cardInput = cardFrame.locator('input[name="cardnumber"], input[placeholder*="card" i]').first();
if (await cardInput.count() > 0) await cardInput.fill("4242424242424242");

const expiryInput = cardFrame.locator('input[name="exp-date"], input[placeholder*="MM" i]').first();
if (await expiryInput.count() > 0) await expiryInput.fill("1230");

const cvcInput = cardFrame.locator('input[name="cvc"], input[placeholder*="CVC" i]').first();
if (await cvcInput.count() > 0) await cvcInput.fill("123");

await page.screenshot({ path: "/tmp/stripe-e2e-2-filled.png" });
console.log("Screenshot: /tmp/stripe-e2e-2-filled.png");

// Submit payment
const payButton = page.locator('button[type="submit"], button:has-text("Pay"), button:has-text("支払う")').first();
if (await payButton.count() > 0) {
  const btnText = await payButton.textContent();
  console.log(`Clicking "${btnText?.trim()}"...`);
  await payButton.click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: "/tmp/stripe-e2e-3-complete.png" });
  console.log("Screenshot: /tmp/stripe-e2e-3-complete.png");
}

await browser.close();

// --- Step 4: Find PaymentIntent ID ---
console.log("\n=== Step 4: Find PaymentIntent ID ===");
await new Promise(r => setTimeout(r, 3000));

let PAYMENT_INTENT_ID = "";
for (let attempt = 0; attempt < 10; attempt++) {
  const piResp = await fetch(`${STRIPE_API}/v1/payment_intents?limit=1`, {
    headers: { "Authorization": `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const piData = await piResp.json();
  const pi = piData.data?.[0];
  if (pi?.status === "succeeded") {
    PAYMENT_INTENT_ID = pi.id;
    console.log("PaymentIntent:", {
      id: pi.id,
      status: pi.status,
      amount: pi.amount,
      currency: pi.currency,
      created: new Date(pi.created * 1000).toISOString(),
    });
    break;
  }
  console.log(`Waiting for PaymentIntent... (attempt ${attempt + 1}, status: ${pi?.status ?? "none"})`);
  await new Promise(r => setTimeout(r, 2000));
}

if (!PAYMENT_INTENT_ID) {
  console.log("No succeeded PaymentIntent found.");
  process.exit(1);
}

// --- Step 5: TLSNotary proof ---
console.log("\n=== Step 5: TLSNotary proof ===");
console.log(`Running tlsn-prove against PaymentIntent: ${PAYMENT_INTENT_ID}`);

const proc = spawn([
  "./crates/tlsn-prover/target/release/tlsn-prove",
  "--verifier", "localhost:7046",
  "--max-recv-data", "4096",
  "--max-sent-data", "4096",
  "-H", `Authorization: Bearer ${STRIPE_SECRET_KEY}`,
  `https://api.stripe.com/v1/payment_intents/${PAYMENT_INTENT_ID}`,
  "-o", "/tmp/stripe-e2e-proof.presentation.tlsn",
], { stdout: "pipe", stderr: "pipe" });

const proveStart = Date.now();
await proc.exited;
const proofElapsed = ((Date.now() - proveStart) / 1000).toFixed(1);

const stderr = await new Response(proc.stderr).text();
console.log(stderr);

if (proc.exitCode === 0) {
  const stdout = await new Response(proc.stdout).text();
  console.log(`\n=== PROOF GENERATED in ${proofElapsed}s ===`);
  console.log(`Proof file: /tmp/stripe-e2e-proof.presentation.tlsn`);
  console.log(`Base64 length: ${stdout.trim().length}`);
} else {
  console.error(`tlsn-prove failed (exit ${proc.exitCode})`);
}

const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\nTotal time: ${totalTime}s`);
