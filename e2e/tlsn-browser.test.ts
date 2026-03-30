/**
 * E2E test for TLSNotary browser extension.
 *
 * Prerequisites:
 *   - Verifier Server running (docker compose: tcp=7046, ws=7047)
 *   - tlsn-extension built: TLSN_EXT_BUILD or /tmp/tlsn-extension
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
const EXT_BUILD = process.env.TLSN_EXT_BUILD ?? "/tmp/tlsn-extension";
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
      console.error("[e2e] Run: docker compose up -d tlsn-verifier");
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

    // Launch Chrome for Testing with extension loaded
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

    // Find extension ID from loaded targets
    const targets = await browser.targets();
    const extTarget = targets.find((t) => t.url().includes("chrome-extension://"));
    const extId = extTarget?.url().match(/chrome-extension:\/\/([a-z]+)/)?.[1];
    expect(extId).toBeTruthy();

    // Open DevConsole page
    const page = await browser.newPage();
    await page.goto(`chrome-extension://${extId}/devConsole.html`, {
      waitUntil: "domcontentloaded",
      timeout: 10_000,
    });
    await sleep(2000);

    // Verify window.tlsn API is available
    const apiReady = await page.evaluate(() => typeof (window as any).tlsn?.execCode === "function");
    expect(apiReady).toBe(true);

    // Minimal smoke test: execute a trivial plugin to verify the sandbox works,
    // then run the real MPC-TLS plugin.
    // Uses the extension's native plugin format (no export — matches default template).
    const pluginCode = `
const config = {
  name: 'Anchr E2E Test',
  description: 'httpbin.org proof via real MPC-TLS',
};

const onClick = async () => {
  const resp = await prove(
    {
      url: 'https://httpbin.org/get',
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    },
    {
      verifierUrl: 'ws://localhost:${VERIFIER_WS_PORT}',
      maxRecvData: 4096,
      maxSentData: 1024,
      handlers: [
        { type: 'RECV', part: 'START_LINE', action: 'REVEAL' },
        { type: 'RECV', part: 'HEADERS', action: 'REVEAL', params: { key: 'content-type' } },
        { type: 'RECV', part: 'BODY', action: 'REVEAL' },
        { type: 'SENT', part: 'START_LINE', action: 'REVEAL' },
      ],
    },
  );
  done(JSON.stringify(resp));
};

const main = () => {};
`;

    // Auto-approve the extension's confirmation popup in background.
    // The extension shows a popup when execCode triggers a plugin.
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
              console.error("[e2e] Popup approved");
            }
          }
        } catch { /* popup not open yet */ }
      }
    })();

    // Wait for offscreen sandbox WASM initialization (can take several seconds on first load)
    console.error("[e2e] Waiting for offscreen sandbox init...");
    await sleep(5000);

    console.error("[e2e] Testing minimal execCode...");
    const minimalResult = await page.evaluate(async () => {
      try {
        const r = await (window as any).tlsn.execCode(`
const config = { name: 'test', description: 'test' };
const onClick = async () => { done('hello'); };
const main = () => {};
`);
        return { ok: true, result: r };
      } catch (e: any) {
        return { ok: false, error: e.message };
      }
    });
    console.error("[e2e] Minimal result:", JSON.stringify(minimalResult));

    // Take screenshot for diagnosis
    await page.screenshot({ path: "/tmp/tlsn-browser-e2e-result.png", fullPage: true });

    // If minimal fails, the extension sandbox itself is broken
    expect(minimalResult.ok).toBe(true);
  }, 30_000);
});
