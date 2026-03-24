import puppeteer from "puppeteer";

const CHROME_PROFILE = "/tmp/chrome-tlsn-test";
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const EXT_ID = "gnoglgpcamodhflknhmafmjdahcejcgg";

const PLUGIN_CODE = `const VERIFIER_URL = 'ws://localhost:7048';
const PROXY_URL = 'ws://localhost:7048/proxy?token=api.coingecko.com';
export default {
  config: { name: 'Anchr BTC', description: 'BTC price proof' },
  main: async () => {
    const proof = await prove(
      { url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', method: 'GET', headers: { 'Accept': 'application/json', 'Accept-Encoding': 'identity', 'Connection': 'close' } },
      { verifierUrl: VERIFIER_URL, proxyUrl: PROXY_URL, maxRecvData: 16384, maxSentData: 4096, handlers: [{ type: 'SENT', part: 'START_LINE', action: 'REVEAL' }, { type: 'RECV', part: 'STATUS_CODE', action: 'REVEAL' }, { type: 'RECV', part: 'BODY', action: 'REVEAL' }] }
    );
    return proof;
  },
};`;

async function sleep(ms: number) {
  await new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log("[test] Launching Chrome...");
  const { spawn } = require("child_process");
  spawn(CHROME_PATH, [
    `--user-data-dir=${CHROME_PROFILE}`,
    "--remote-debugging-port=9222",
    "--no-first-run",
    `chrome-extension://${EXT_ID}/devConsole.html`,
  ], { detached: true, stdio: "ignore" }).unref();

  await sleep(5000);
  const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9222", protocolTimeout: 120000 });

  // Find DevConsole page
  const pages = await browser.pages();
  const devPage = pages.find(p => p.url().includes("devConsole"));
  if (!devPage) {
    console.log("[test] DevConsole not found");
    await browser.disconnect();
    return;
  }
  console.log("[test] DevConsole found");

  // Enter plugin code via CodeMirror
  const cm = await devPage.$(".cm-content");
  if (cm) {
    await cm.click();
    await devPage.keyboard.down("Meta");
    await devPage.keyboard.press("a");
    await devPage.keyboard.up("Meta");
    await sleep(100);

    // Type the code (clipboard doesn't work in extension context)
    await devPage.keyboard.press("Backspace"); // delete selected text
    await sleep(100);
    // Type via keyboard (slow but reliable)
    for (const line of PLUGIN_CODE.split("\n")) {
      await devPage.keyboard.type(line, { delay: 0 });
      await devPage.keyboard.press("Enter");
    }
    await sleep(500);
  }
  console.log("[test] Plugin code entered");

  // Click Run Code
  const btns = await devPage.$$("button");
  for (const btn of btns) {
    const text = await btn.evaluate(el => el.textContent?.trim());
    if (text?.includes("Run")) {
      await btn.click();
      console.log("[test] Run clicked");
      break;
    }
  }

  // Monitor for confirmPopup and auto-approve
  console.log("[test] Waiting for confirm popup...");
  let confirmed = false;
  let completed = false;

  for (let i = 0; i < 60; i++) {
    await sleep(1000);

    // Check all pages for confirmPopup
    if (!confirmed) {
      const allPages = await browser.pages();
      for (const p of allPages) {
        const url = p.url();
        if (url.includes("confirmPopup")) {
          console.log("[test] Found confirmPopup! Auto-approving...");
          await sleep(1000);
          await p.screenshot({ path: "/tmp/tlsn-confirm.png" });

          // Find approve/confirm button
          const popupBtns = await p.$$("button");
          for (const b of popupBtns) {
            const txt = await b.evaluate(el => el.textContent?.trim().toLowerCase());
            console.log(`[test]   Button: "${txt}"`);
            if (txt?.includes("confirm") || txt?.includes("approve") || txt?.includes("accept") || txt?.includes("allow")) {
              await b.click();
              console.log("[test] Approved!");
              confirmed = true;
              break;
            }
          }
          if (!confirmed) {
            // Click the last button (usually the confirm)
            if (popupBtns.length > 0) {
              await popupBtns[popupBtns.length - 1].click();
              console.log("[test] Clicked last button as fallback");
              confirmed = true;
            }
          }
          break;
        }
      }
    }

    // Check DevConsole for completion
    const text = await devPage.evaluate(() => document.body?.innerText?.slice(-300) || "");
    if (text.includes("Error") && text.includes("rejected")) {
      console.log("[test] Plugin was rejected (popup not approved in time)");
      break;
    }
    if (text.includes("completed") || text.includes("result") || text.includes("proof")) {
      console.log("[test] Plugin completed!");
      completed = true;
      break;
    }
    if (i % 5 === 0) {
      console.log(`[test] ${i}s...`);
    }
  }

  await devPage.screenshot({ path: "/tmp/tlsn-devconsole-final.png" });
  console.log("[test] Final screenshot: /tmp/tlsn-devconsole-final.png");

  const finalText = await devPage.evaluate(() => document.body?.innerText?.slice(-500) || "");
  console.log("[test] Console output:", finalText.slice(-300));

  await browser.disconnect();
  console.log("[test] Done");
}

main().catch(e => console.error("[test] Error:", e.message));
