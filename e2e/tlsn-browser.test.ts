/**
 * E2E test for TLSNotary browser extension.
 *
 * Prerequisites:
 *   - Verifier Server running (docker compose: tcp=7046, ws=7047)
 *   - tlsn-extension built: TLSN_EXT_BUILD or /tmp/tlsn-extension/packages/extension/build
 *   - Puppeteer (npm:puppeteer in deno.json import map)
 *
 * Run:
 *   deno test e2e/tlsn-browser.test.ts --allow-all --no-check
 */

import { afterAll, beforeAll, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

function findChromium(): string | null {
  const base = join(process.env.HOME ?? "", ".cache/puppeteer/chrome");
  try {
    const versions = readdirSync(base).filter((d) => d.startsWith("mac_arm-"));
    if (versions.length === 0) return null;
    versions.sort();
    const latest = versions[versions.length - 1]!;
    const path = join(base, latest, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

const CHROMIUM = findChromium();
const EXT_BUILD = process.env.TLSN_EXT_BUILD ?? "/tmp/tlsn-extension/packages/extension/build";
const VERIFIER_WS_PORT = 7047;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function hasChromium(): boolean { return CHROMIUM !== null; }
function hasExtension(): boolean { return existsSync(join(EXT_BUILD, "manifest.json")); }

async function isVerifierRunning(): Promise<boolean> {
  try {
    const conn = await Deno.connect({ hostname: "localhost", port: VERIFIER_WS_PORT });
    conn.close();
    return true;
  } catch {
    return false;
  }
}

// Puppeteer FrameManager creates internal deferred timers on browser.close().
describe("TLSNotary Browser Extension E2E", { sanitizeOps: false, sanitizeResources: false }, () => {
  let browser: Browser;
  let page: Page;
  let ready = false;

  beforeAll(async () => {
    if (!hasChromium()) { console.error("[e2e] Chromium not found"); return; }
    if (!hasExtension()) { console.error("[e2e] Extension not found at", EXT_BUILD); return; }
    if (!(await isVerifierRunning())) { console.error("[e2e] Verifier not running"); return; }

    browser = await puppeteer.launch({
      headless: false,
      executablePath: CHROMIUM!,
      userDataDir: "/tmp/chromium-e2e-" + Date.now(),
      args: [
        "--no-first-run", "--disable-default-apps",
        `--disable-extensions-except=${EXT_BUILD}`,
        `--load-extension=${EXT_BUILD}`,
      ],
      protocolTimeout: 30_000,
    });

    await sleep(3000);

    const targets = await browser.targets();
    const extTarget = targets.find((t) => t.url().includes("chrome-extension://"));
    const extId = extTarget?.url().match(/chrome-extension:\/\/([a-z]+)/)?.[1];
    if (!extId) { console.error("[e2e] Extension ID not found"); return; }

    page = await browser.newPage();
    await page.goto(`chrome-extension://${extId}/devConsole.html`, {
      waitUntil: "domcontentloaded",
      timeout: 10_000,
    });

    // Poll for WASM init
    for (let i = 0; i < 30; i++) {
      const ok = await page.evaluate(() => typeof (window as any).tlsn?.execCode === "function");
      if (ok) break;
      await sleep(200);
    }
    ready = true;
  });

  afterAll(async () => {
    if (browser) {
      const proc = browser.process();
      if (proc?.stderr) { proc.stderr.removeAllListeners(); proc.stderr.destroy(); }
      await browser.close();
      if (proc && proc.exitCode === null) proc.kill("SIGKILL");
    }
  });

  test("MPC-TLS proof via browser extension — bitflyer ECDSA", { sanitizeOps: false, sanitizeResources: false }, async () => {
    if (!ready) { console.error("[e2e] SKIPPED"); return; }

    // Inject plugin code into CodeMirror editor (triggers React setCode via onChange)
    const pluginCode = `\
export const config = {
  name: 'Anchr E2E',
  description: 'bitFlyer BTC/JPY ticker via MPC-TLS (ECDSA)',
  requests: [{
    method: 'GET',
    host: 'api.bitflyer.com',
    pathname: '/v1/ticker',
    verifierUrl: 'ws://localhost:${VERIFIER_WS_PORT}',
  }],
};

export const onClick = async () => {};

export const main = async () => {
  const resp = await prove(
    {
      url: 'https://api.bitflyer.com/v1/ticker?product_code=BTC_JPY',
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    },
    {
      verifierUrl: 'ws://localhost:${VERIFIER_WS_PORT}',
      proxyUrl: 'ws://localhost:${VERIFIER_WS_PORT}/proxy?token=api.bitflyer.com',
      maxRecvData: 16384,
      maxSentData: 4096,
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
`;

    // Set code via CodeMirror 6 EditorView
    await page.evaluate((code: string) => {
      const cmContent = document.querySelector(".cm-content");
      const view = (cmContent as any)?.cmView?.view;
      if (view) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
      }
    }, pluginCode);

    // Verify injection
    const editorText = await page.evaluate(
      () => document.querySelector(".cm-content")?.textContent?.slice(0, 80) || "",
    );
    expect(editorText).toContain("Anchr E2E");

    // Auto-approve confirmPopup
    let popupApproved = false;
    const popupMonitor = (async () => {
      for (let i = 0; i < 30 && !popupApproved; i++) {
        await sleep(300);
        try {
          for (const p of await browser.pages()) {
            if (p.url().includes("confirmPopup") && !popupApproved) {
              await sleep(200);
              await p.evaluate(() => {
                for (const b of document.querySelectorAll("button"))
                  if (b.textContent?.toLowerCase().includes("allow")) {
                    (b as HTMLButtonElement).click();
                    return;
                  }
              });
              popupApproved = true;
              console.error("[e2e] Popup approved");
            }
          }
        } catch { /* ignore */ }
      }
    })();

    // Click "Run Code" button — triggers DevConsole's executeCode() → console output
    await page.evaluate(() => {
      for (const b of document.querySelectorAll("button"))
        if (b.textContent?.includes("Run")) {
          (b as HTMLButtonElement).click();
          break;
        }
    });

    // Capture browser console messages for debugging
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("[ProveManager]") || text.includes("WASM") || text.includes("error") || text.includes("Error")) {
        console.error("[browser]", text);
      }
    });

    // Poll DevConsole console output for completion (up to 45s for MPC)
    let resultText = "";
    for (let i = 0; i < 45; i++) {
      await sleep(1000);
      resultText = await page.evaluate(() => document.body?.innerText || "");
      if (resultText.includes("completed in") || resultText.includes("Error after")) break;
    }
    popupApproved = true;

    // Log console output
    const execIdx = resultText.indexOf("Executing");
    if (execIdx >= 0) {
      console.error("[e2e] Console output:", resultText.slice(execIdx, execIdx + 500));
    }

    await page.screenshot({ path: "/tmp/tlsn-browser-e2e-result.png" });

    // Assertions — proof transcript with 200 OK response
    expect(resultText).toContain("completed in");
    expect(resultText).toContain("results");
    expect(resultText).toContain("200");
    expect(resultText).toContain("START_LINE");
  });
});
