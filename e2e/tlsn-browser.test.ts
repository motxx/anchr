/**
 * E2E test for TLSNotary browser extension.
 *
 * Prerequisites:
 *   - Verifier Server running: crates/tlsn-server/target/debug/tlsn-server --tcp-port 7046 --ws-port 7047
 *   - tlsn-extension built with Anchr plugin: /tmp/tlsn-extension/packages/extension/build
 *   - Puppeteer installed: bun add -d puppeteer
 *
 * Run:
 *   bun test e2e/tlsn-browser.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { existsSync } from "node:fs";
import { join } from "node:path";

const CHROMIUM = join(
  process.env.HOME ?? "",
  ".cache/puppeteer/chrome/mac_arm-146.0.7680.153/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
);
const EXT_BUILD = "/tmp/tlsn-extension/packages/extension/build";
const VERIFIER_WS_PORT = 7047;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hasChromium(): boolean {
  return existsSync(CHROMIUM);
}

function hasExtension(): boolean {
  return existsSync(join(EXT_BUILD, "manifest.json"));
}

async function isVerifierRunning(): Promise<boolean> {
  try {
    // WS-only server — check by attempting TCP connect
    const conn = await Bun.connect({
      hostname: "localhost",
      port: VERIFIER_WS_PORT,
      socket: { data() {}, open(s) { s.end(); }, error() {} },
    });
    return true;
  } catch {
    return false;
  }
}

describe("TLSNotary Browser Extension E2E", () => {
  let browser: Browser;
  let ready = false;

  beforeAll(async () => {
    if (!hasChromium()) {
      console.error("[e2e] Chromium not found at", CHROMIUM);
      console.error("[e2e] Run: bun add -d puppeteer (downloads Chromium)");
      return;
    }
    if (!hasExtension()) {
      console.error("[e2e] Extension build not found at", EXT_BUILD);
      console.error("[e2e] Build: cd /tmp/tlsn-extension && npm run build");
      return;
    }
    if (!(await isVerifierRunning())) {
      console.error("[e2e] Verifier Server not running on port", VERIFIER_WS_PORT);
      console.error("[e2e] Run: crates/tlsn-server/target/debug/tlsn-server --tcp-port 7046 --ws-port 7047");
      return;
    }
    ready = true;
  });

  afterAll(async () => {
    if (browser) await browser.close();
  });

  test("MPC-TLS proof via browser extension — httpbin.org 200 OK", async () => {
    if (!ready) {
      console.error("[e2e] SKIPPED — infrastructure not ready");
      return;
    }

    // Launch Chrome for Testing with extension
    browser = await puppeteer.launch({
      headless: false,
      executablePath: CHROMIUM,
      userDataDir: "/tmp/chromium-e2e-" + Date.now(),
      args: [
        "--no-first-run",
        "--disable-default-apps",
        `--disable-extensions-except=${EXT_BUILD}`,
        `--load-extension=${EXT_BUILD}`,
      ],
      protocolTimeout: 300_000,
    });

    await sleep(3000);

    // Find extension ID
    const targets = await browser.targets();
    const extTarget = targets.find((t) => t.url().includes("chrome-extension://"));
    const extId = extTarget?.url().match(/chrome-extension:\/\/([a-z]+)/)?.[1];
    expect(extId).toBeTruthy();

    // Open DevConsole
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extId}/devConsole.html`, {
      waitUntil: "domcontentloaded",
      timeout: 10_000,
    });
    await sleep(2000);

    // Verify plugin template loaded
    const editorText = await page.evaluate(
      () => document.querySelector(".cm-content")?.textContent?.slice(0, 50) || "",
    );
    expect(editorText).toContain("VERIFIER_URL");

    // Auto-approve confirmPopup in background
    let popupApproved = false;
    const popupMonitor = (async () => {
      for (let i = 0; i < 120 && !popupApproved; i++) {
        await sleep(500);
        try {
          for (const p of await browser.pages()) {
            if (p.url().includes("confirmPopup") && !popupApproved) {
              await sleep(300);
              await p.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll("button"));
                for (const b of buttons)
                  if (b.textContent?.toLowerCase().includes("allow")) {
                    (b as HTMLButtonElement).click();
                    return;
                  }
              });
              popupApproved = true;
            }
          }
        } catch { /* ignore */ }
      }
    })();

    // Click Run Code
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      for (const b of buttons)
        if (b.textContent?.includes("Run")) {
          (b as HTMLButtonElement).click();
          break;
        }
    });

    // Wait for completion (MPC ~10s + reveal ~5s)
    let resultText = "";
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      resultText = await page.evaluate(() => document.body?.innerText || "");
      if (resultText.includes("completed in")) break;
    }
    popupApproved = true; // stop monitor

    // Assertions
    expect(resultText).toContain("completed in");
    expect(resultText).toContain("results");

    // Extract status code
    const statusMatch = resultText.match(/"value":\s*"(\d{3})"/);
    const statusCode = statusMatch?.[1];
    expect(statusCode).toBe("200");

    // Extract body (should contain httpbin JSON)
    expect(resultText).toContain("httpbin.org");

    // Take evidence screenshot
    await page.screenshot({ path: "/tmp/tlsn-browser-e2e-result.png" });
  }, 120_000);
});
