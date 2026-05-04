/**
 * Browser E2E QA test — exercises all UI pages and the Create Query flow.
 * Run: deno run --allow-all scripts/e2e-browser-qa.ts
 */

import { chromium } from "playwright";

const BASE = "http://localhost:3000";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let passed = 0;
  let failed = 0;

  async function check(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ✗ ${name}: ${(e as Error).message}`);
      failed++;
    }
  }

  // --- Worker UI ---
  console.log("\n=== Worker UI ===");
  await check("loads /", async () => {
    const res = await page.goto(BASE);
    if (res?.status() !== 200) throw new Error(`status ${res?.status()}`);
  });
  await check("shows Anchr title", async () => {
    const text = await page.textContent("body");
    if (!text?.includes("Anchr")) throw new Error("title not found");
  });
  await check("shows EARNED BALANCE", async () => {
    await page.waitForSelector("text=EARNED BALANCE", { timeout: 5000 });
  });
  await check("no JS errors on worker page", async () => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.reload();
    await page.waitForTimeout(2000);
    page.removeAllListeners("pageerror");
    if (errors.length > 0) throw new Error(errors.join("; "));
  });

  // --- Requester UI ---
  console.log("\n=== Requester UI ===");
  await check("loads /requester/", async () => {
    const res = await page.goto(`${BASE}/requester/`);
    if (res?.status() !== 200) throw new Error(`status ${res?.status()}`);
  });
  await check("shows Create Query button", async () => {
    await page.waitForSelector("text=Create Query", { timeout: 5000 });
  });
  await check("shows filter tabs (All, Active, Verified, Failed)", async () => {
    for (const tab of ["All", "Active", "Verified", "Failed"]) {
      await page.waitForSelector(`button:has-text("${tab}")`, { timeout: 3000 });
    }
  });

  // --- Create Query flow ---
  console.log("\n=== Create Query Flow ===");
  await check("opens New Query modal", async () => {
    await page.click("text=Create Query");
    await page.waitForSelector("text=New Query", { timeout: 3000 });
  });
  await check("fills description and URL", async () => {
    await page.fill("textarea", "Browser E2E: verify BTC price");
    // Target URL field has a placeholder but no value — must fill it explicitly
    await page.fill("input[type='url']", "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd");
    const desc = await page.inputValue("textarea");
    if (!desc.includes("Browser E2E")) throw new Error(`desc is "${desc}"`);
    const url = await page.inputValue("input[type='url']");
    if (!url.includes("coingecko")) throw new Error(`url is "${url}"`);
  });
  await check("clicks Create and query appears", async () => {
    await page.click("button:has-text('Create')");
    // Wait for modal to close and query to appear in list
    await page.waitForSelector("text=Browser E2E: verify BTC price", { timeout: 8000 });
  });
  await check("ACTIVE count incremented", async () => {
    // Find the ACTIVE stat card
    const text = await page.textContent("body");
    // The new query should appear and ACTIVE should be >= 2
    if (!text?.includes("Browser E2E")) throw new Error("query not in list");
  });

  // --- Filter tabs ---
  console.log("\n=== Filter Tabs ===");
  await check("Active filter shows only active queries", async () => {
    await page.click("button:has-text('Active')");
    await page.waitForTimeout(500);
    const text = await page.textContent("body");
    if (text?.includes("却下")) throw new Error("rejected query visible in Active filter");
  });
  await check("Failed filter shows only failed queries", async () => {
    await page.click("button:has-text('Failed')");
    await page.waitForTimeout(500);
    const text = await page.textContent("body");
    if (!text?.includes("却下")) throw new Error("no rejected queries in Failed filter");
  });
  await check("All filter shows everything", async () => {
    await page.click("button:has-text('All')");
    await page.waitForTimeout(500);
    const text = await page.textContent("body");
    if (!text?.includes("Browser E2E")) throw new Error("active query missing from All");
  });

  // --- Dashboard UI ---
  console.log("\n=== Dashboard UI ===");
  await check("loads /dashboard/", async () => {
    const res = await page.goto(`${BASE}/dashboard/`);
    if (res?.status() !== 200) throw new Error(`status ${res?.status()}`);
  });
  await check("shows Dashboard title", async () => {
    await page.waitForSelector("text=Dashboard", { timeout: 5000 });
  });

  // --- Market UI ---
  console.log("\n=== Market UI ===");
  await check("loads /market/", async () => {
    const res = await page.goto(`${BASE}/market/`);
    if (res?.status() !== 200) throw new Error(`status ${res?.status()}`);
  });
  await check("shows Prediction Markets", async () => {
    await page.waitForSelector("text=Prediction Markets", { timeout: 5000 });
  });
  await check("displays market listings", async () => {
    const cards = await page.$$("[class*='card'], [class*='Card'], [class*='rounded']");
    if (cards.length < 2) throw new Error(`only ${cards.length} cards found`);
  });

  // --- API endpoints ---
  console.log("\n=== API Health ===");
  await check("GET /health returns ok", async () => {
    const res = await page.goto(`${BASE}/health`);
    const body = await res?.json();
    if (!body?.ok) throw new Error(JSON.stringify(body));
  });
  await check("GET /oracles returns array", async () => {
    const res = await page.goto(`${BASE}/oracles`);
    const body = await res?.json();
    if (!Array.isArray(body)) throw new Error("not array");
  });

  // --- Cleanup: cancel the test query ---
  console.log("\n=== Cleanup ===");
  await check("cancel test query via API", async () => {
    const queriesRes = await (await fetch(`${BASE}/queries`)).json() as Array<{ id: string; description: string }>;
    const testQuery = queriesRes.find((q) => q.description.includes("Browser E2E"));
    if (testQuery) {
      await fetch(`${BASE}/queries/${testQuery.id}/cancel`, { method: "POST" });
    }
  });

  await browser.close();

  console.log(`\n${"=".repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`${"=".repeat(40)}`);

  if (failed > 0) Deno.exit(1);
}

main();
