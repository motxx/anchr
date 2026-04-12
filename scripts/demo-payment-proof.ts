/**
 * Demo: Payment Proof — 30 seconds
 *
 * 3 steps visible to the audience:
 *   1. Pay   — Buyer pays ¥100 via Square
 *   2. Prove — TLSNotary generates cryptographic proof
 *   3. Verify — Anchr verifies the proof independently
 *
 * Usage:
 *   SQUARE_ACCESS_TOKEN=xxx deno run --allow-all --env scripts/demo-payment-proof.ts
 *
 * Prerequisites:
 *   - Anchr server running (deno run --allow-all --env src/reference-app.ts)
 *   - TLSNotary verifier running (docker)
 *   - tlsn-prove binary built
 */

import { spawn } from "../src/runtime/mod.ts";

const ANCHR_URL = process.env.ANCHR_SERVER_URL ?? "http://localhost:3000";
const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN;

if (!SQUARE_ACCESS_TOKEN) {
  console.error("SQUARE_ACCESS_TOKEN required");
  process.exit(1);
}

const health = await fetch(`${ANCHR_URL}/health`).catch(() => null);
if (!health?.ok) {
  console.error(`Anchr server not running at ${ANCHR_URL}`);
  process.exit(1);
}

const startTime = Date.now();
const elapsed = () => `${((Date.now() - startTime) / 1000).toFixed(1)}s`;

// ── Layout: Demo UI (left) + Square browser (right) ──

const pw = await import("playwright");

const SCREEN_W = 1512;
const SCREEN_H = 982;
const LEFT_W = Math.floor(SCREEN_W * 0.5);
const RIGHT_W = SCREEN_W - LEFT_W;

// Demo UI — left
const demoHtml = await Deno.readTextFile(new URL("./demo-payment-proof.html", import.meta.url).pathname);
const demoBrowser = await pw.chromium.launch({
  headless: false,
  args: [`--window-size=${LEFT_W},${SCREEN_H}`, `--window-position=0,0`],
});
const demoPage = await demoBrowser.newPage();
await demoPage.setViewportSize({ width: LEFT_W - 16, height: SCREEN_H - 80 });
await demoPage.setContent(demoHtml);
await demoPage.waitForFunction(() => typeof (window as any).flowActivate === "function");
await demoPage.evaluate((ts: number) => (window as any).flowSetStart(ts), startTime);

const activate = (step: number, desc?: string) =>
  demoPage.evaluate(
    ([s, d]: [number, string]) => (window as any).flowActivate(s, d),
    [step, desc ?? ""] as [number, string],
  );
const complete = (step: number, desc?: string) =>
  demoPage.evaluate(
    ([s, d]: [number, string]) => (window as any).flowComplete(s, d),
    [step, desc ?? ""] as [number, string],
  );
const showResult = (data: { fields: Record<string, string>; footer?: string }) =>
  demoPage.evaluate((d: any) => (window as any).flowResult(d), data);

// Square browser — right (blank until payment)
const squareBrowser = await pw.chromium.launch({
  headless: false,
  args: [`--window-size=${RIGHT_W},${SCREEN_H}`, `--window-position=${LEFT_W},0`],
});
const squarePage = await squareBrowser.newPage();
await squarePage.setViewportSize({ width: RIGHT_W - 16, height: SCREEN_H - 80 });
await squarePage.setContent(
  '<html><body style="background:#08080d;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
    '<p style="color:#333;font-family:system-ui;font-size:15px">Waiting...</p></body></html>',
);

console.log(`[${elapsed()}] Demo ready\n`);

// ════════════════════════════════════════════════
// Step 1: PAY
// ════════════════════════════════════════════════
await activate(0, "Creating payment link...");
console.log(`[${elapsed()}] Creating Square Payment Link...`);

const locResp = await fetch("https://connect.squareupsandbox.com/v2/locations", {
  headers: { Authorization: `Bearer ${SQUARE_ACCESS_TOKEN}` },
});
const LOCATION_ID = ((await locResp.json()) as any).locations?.[0]?.id;

const linkResp = await fetch(
  "https://connect.squareupsandbox.com/v2/online-checkout/payment-links",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SQUARE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      quick_pay: {
        name: "BTC Swap ¥100",
        price_money: { amount: 100, currency: "JPY" },
        location_id: LOCATION_ID,
      },
    }),
  },
);
const PAYMENT_LINK_URL = ((await linkResp.json()) as any).payment_link?.url;

if (!PAYMENT_LINK_URL) {
  console.error("Failed to create payment link");
  process.exit(1);
}

// Open payment in Square browser
await activate(0, "Buyer paying via Square...");
await squarePage.goto(PAYMENT_LINK_URL);
await squarePage.waitForLoadState("networkidle");

// Navigate Sandbox Testing Panel: Overview → Test Payment → Complete
const nextBtn = squarePage.locator('button:has-text("Next")').first();
if ((await nextBtn.count()) > 0) {
  await nextBtn.click();
  await squarePage.waitForLoadState("networkidle");
  await squarePage.waitForTimeout(1500);

  const payBtn = squarePage
    .locator(
      'button:has-text("Complete"), button:has-text("Pay"), button:has-text("Next"), button:has-text("Simulate"), button:has-text("Submit")',
    )
    .first();
  if ((await payBtn.count()) > 0) {
    await payBtn.click();
    await squarePage.waitForTimeout(3000);
  }
}

// Get Payment ID
let PAYMENT_ID = "";
for (let i = 0; i < 10; i++) {
  const resp = await fetch(
    "https://connect.squareupsandbox.com/v2/payments?sort_order=DESC&limit=1",
    { headers: { Authorization: `Bearer ${SQUARE_ACCESS_TOKEN}` } },
  );
  const p = ((await resp.json()) as any).payments?.[0];
  if (p?.status === "COMPLETED") {
    PAYMENT_ID = p.id;
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
}

if (!PAYMENT_ID) {
  console.error("Payment not completed");
  process.exit(1);
}

await complete(0, `Paid ¥100 — ${PAYMENT_ID.slice(0, 16)}...`);
console.log(`[${elapsed()}] Payment: ${PAYMENT_ID}\n`);

// ════════════════════════════════════════════════
// Step 2: PROVE
// ════════════════════════════════════════════════
await activate(1, "MPC-TLS handshake...");
console.log(`[${elapsed()}] Generating TLSNotary proof...`);

const proofFile = `/tmp/demo-proof-${Date.now()}.tlsn`;
const proveStart = Date.now();
const proc = spawn(
  [
    "./crates/tlsn-prover/target/release/tlsn-prove",
    "--verifier",
    "localhost:7046",
    "--max-recv-data",
    "4096",
    "--max-sent-data",
    "4096",
    "-H",
    `Authorization: Bearer ${SQUARE_ACCESS_TOKEN}`,
    `https://connect.squareupsandbox.com/v2/payments/${PAYMENT_ID}`,
    "-o",
    proofFile,
  ],
  { stdout: "pipe", stderr: "pipe" },
);

// Animate dots while proof generates
let dotCount = 0;
const dotInterval = setInterval(async () => {
  dotCount = (dotCount % 3) + 1;
  const dots = ".".repeat(dotCount);
  await demoPage
    .evaluate(
      (d: string) => {
        const el = document.getElementById("desc-1");
        if (el) el.textContent = d;
      },
      `MPC-TLS proving${dots}`,
    )
    .catch(() => {});
}, 600);

await proc.exited;
clearInterval(dotInterval);

const proofB64 = (await new Response(proc.stdout).text()).trim();
const proveTime = ((Date.now() - proveStart) / 1000).toFixed(1);

if (proc.exitCode !== 0) {
  const stderr = await new Response(proc.stderr).text();
  console.error(`Proof failed:\n${stderr}`);
  process.exit(1);
}

await complete(1, `Proof generated in ${proveTime}s`);
console.log(`[${elapsed()}] Proof: ${proveTime}s, ${proofB64.length} bytes\n`);

// ════════════════════════════════════════════════
// Step 3: VERIFY
// ════════════════════════════════════════════════
await activate(2, "Submitting proof...");
console.log(`[${elapsed()}] Submitting to Anchr...`);

// Create query + submit result (infrastructure hidden from UI)
const WORKER_PUBKEY = "0000000000000000000000000000000000000000000000000000000000000003";

const queryResp = await fetch(`${ANCHR_URL}/queries`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    description: "Prove Square payment (¥100)",
    verification_requirements: ["tlsn"],
    ttl_seconds: 600,
    tlsn_requirements: {
      target_url: `https://connect.squareupsandbox.com/v2/payments/${PAYMENT_ID}`,
      domain_hint: "connect.squareupsandbox.com",
      conditions: [
        {
          type: "contains",
          expression: '"status":"COMPLETED"',
          description: "Payment completed",
        },
      ],
      max_attestation_age_seconds: 600,
    },
  }),
});
const queryData = (await queryResp.json()) as any;
const QUERY_ID = queryData.query_id;

if (!QUERY_ID) {
  console.error("Failed to create query:", JSON.stringify(queryData));
  process.exit(1);
}

// Quote + select (required by query-service, hidden from demo UI)
await fetch(`${ANCHR_URL}/queries/${QUERY_ID}/quotes`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    worker_pubkey: WORKER_PUBKEY,
    amount_sats: 0,
    quote_event_id: `demo_${Date.now()}`,
  }),
});
await fetch(`${ANCHR_URL}/queries/${QUERY_ID}/select`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ worker_pubkey: WORKER_PUBKEY }),
});

await demoPage
  .evaluate((d: string) => {
    const el = document.getElementById("desc-2");
    if (el) el.textContent = d;
  }, "Verifying proof cryptographically...")
  .catch(() => {});

const resultResp = await fetch(`${ANCHR_URL}/queries/${QUERY_ID}/result`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    worker_pubkey: WORKER_PUBKEY,
    attachments: [],
    tlsn_presentation: proofB64,
  }),
});
const result = (await resultResp.json()) as any;

const verified = result.ok;
await complete(2, verified ? "Proof verified ✓" : "Verification failed ✗");
console.log(`[${elapsed()}] Verification: ${verified ? "PASSED" : "FAILED"}`);

if (result.verification?.checks) {
  for (const c of result.verification.checks) console.log(`  ✓ ${c}`);
}
if (result.verification?.failures?.length) {
  for (const f of result.verification.failures) console.log(`  ✗ ${f}`);
}

// ════════════════════════════════════════════════
// Result
// ════════════════════════════════════════════════
const tlsn = result.verification?.tlsn_verified;
await showResult({
  fields: {
    Server: tlsn?.server_name ?? "connect.squareupsandbox.com",
    "Payment ID": PAYMENT_ID,
    Status: "COMPLETED",
    Amount: "¥100 JPY",
    "Verified at": new Date().toLocaleTimeString("ja-JP"),
  },
  footer: "信頼できる第三者なし。暗号技術のみで検証。",
});

const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\n✓ Demo complete in ${totalTime}s`);
console.log("Press Ctrl+C to close.\n");
await new Promise(() => {}); // Keep browsers open
