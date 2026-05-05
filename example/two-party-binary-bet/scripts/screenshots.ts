#!/usr/bin/env -S deno run --allow-all
/**
 * Capture screenshots of the two-party binary bet UI for documentation.
 *
 * Boots the standalone market server in-process, drives a headless
 * Chromium via Playwright through the empty state and the
 * create-market form, and writes screenshots into
 * docs/two-party-binary-bet/screenshots/.
 *
 * Run:
 *   deno task build:ui && deno task build:css
 *   deno task screenshot   # from example/two-party-binary-bet/
 *
 * The script does NOT require Docker — it captures the empty market
 * UI plus the in-page wallet panel banner. For full bet → resolve
 * → redeem screenshots, run after `docker compose up -d` and seed
 * a market through the UI manually, then re-run with `--full`.
 */

import { chromium, type Browser, type Page } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const PROJECT_ROOT = dirname(dirname(new URL(import.meta.url).pathname));
const SCREENSHOT_DIR = join(PROJECT_ROOT, "docs/two-party-binary-bet/screenshots");
const PORT = 3098;

if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });

// --- Start the market server in-process via spawning deno -----------------

console.log("[screenshots] starting market server on :" + PORT);
const serverProc = new Deno.Command("deno", {
  args: [
    "run",
    "--config",
    join(PROJECT_ROOT, "deno.json"),
    "--allow-all",
    join(PROJECT_ROOT, "example/two-party-binary-bet/server.ts"),
  ],
  env: {
    "MARKET_PORT": String(PORT),
    "AUTO_RESOLVE_DISABLED": "1",
  },
  stdout: "piped",
  stderr: "piped",
}).spawn();

// Wait for the server to come up.
async function waitForServer(): Promise<boolean> {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/markets/wallet/config`);
      if (res.ok) {
        await res.body?.cancel();
        return true;
      }
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const ready = await waitForServer();
if (!ready) {
  console.error("[screenshots] server did not come up in 15s");
  serverProc.kill();
  Deno.exit(1);
}
console.log("[screenshots] server up");

// --- Launch headless browser ----------------------------------------------

let browser: Browser | undefined;
let page: Page | undefined;
try {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  // Empty market list — the most common first impression.
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector("text=Two-party binary bets", { timeout: 10_000 });
  await page.screenshot({
    path: join(SCREENSHOT_DIR, "01-empty-markets.png"),
    fullPage: true,
  });
  console.log("[screenshots] 01-empty-markets.png");

  // Open the create-market form so the form layout is visible.
  await page.click("text=+ Create Market");
  await page.waitForSelector("text=Create New Market");
  await page.screenshot({
    path: join(SCREENSHOT_DIR, "02-create-market-form.png"),
    fullPage: true,
  });
  console.log("[screenshots] 02-create-market-form.png");

  // Seed a market via the API so we can capture a populated list + detail.
  const created = await fetch(`http://localhost:${PORT}/markets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Will BTC/JPY exceed 15M by end of 2026?",
      description: "Resolves YES if bitFlyer best_bid > 15,000,000 JPY at deadline.",
      category: "crypto",
      resolution_url: "https://api.bitflyer.com/v1/ticker?product_code=BTC_JPY",
      resolution_deadline: Math.floor(Date.now() / 1000) + 86400 * 7,
      resolution_condition: {
        type: "jsonpath_gt",
        target_url: "https://api.bitflyer.com/v1/ticker?product_code=BTC_JPY",
        jsonpath: "best_bid",
        threshold: 15_000_000,
        description: "BTC/JPY best_bid > 15,000,000",
      },
    }),
  });
  if (!created.ok) {
    console.warn("[screenshots] could not seed market for screenshots:", created.status);
  } else {
    await page.click("text=Cancel");
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForSelector("text=Will BTC/JPY exceed", { timeout: 10_000 });
    await page.screenshot({
      path: join(SCREENSHOT_DIR, "03-market-list.png"),
      fullPage: true,
    });
    console.log("[screenshots] 03-market-list.png");

    // Drill into the detail view.
    await page.click("text=Will BTC/JPY exceed");
    await page.waitForSelector("text=Place a Bet", { timeout: 10_000 });
    await page.screenshot({
      path: join(SCREENSHOT_DIR, "04-market-detail.png"),
      fullPage: true,
    });
    console.log("[screenshots] 04-market-detail.png");
  }

  console.log(`[screenshots] done → ${SCREENSHOT_DIR}`);
} catch (err) {
  console.error("[screenshots] error:", err);
  Deno.exit(1);
} finally {
  if (page) await page.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  try { serverProc.kill("SIGINT"); } catch { /* already gone */ }
  await serverProc.status.catch(() => {});
}
