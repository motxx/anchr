import { chromium } from "playwright";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  console.error("STRIPE_SECRET_KEY is required in .env or environment");
  process.exit(1);
}

// Get Payment Intent ID
const piResp = await fetch("https://api.stripe.com/v1/checkout/sessions?limit=1", {
  headers: { "Authorization": `Basic ${btoa(STRIPE_SECRET_KEY + ":")}` },
});
const piData = await piResp.json();
const PAYMENT_INTENT_ID = piData.data?.[0]?.payment_intent;
if (!PAYMENT_INTENT_ID) {
  console.error("No Payment Intent found. Make a Stripe payment first.");
  process.exit(1);
}
console.log("Payment Intent ID:", PAYMENT_INTENT_ID);

// Launch Chrome with TLSNotary Extension
console.log("Launching Chrome with TLSNotary Extension...");
const context = await chromium.launchPersistentContext("/tmp/chrome-tlsn-profile", {
  headless: false,
  args: [
    "--disable-extensions-except=/private/tmp/tlsn-extension",
    "--load-extension=/private/tmp/tlsn-extension",
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

// Wait for Extension service worker
let extId = "unknown";
for (let i = 0; i < 30; i++) {
  const sw = context.serviceWorkers().find(s => s.url().includes("background.bundle.js"));
  if (sw) {
    extId = new URL(sw.url()).hostname;
    break;
  }
  await new Promise(r => setTimeout(r, 500));
}
if (extId === "unknown") {
  const sw = await context.waitForEvent("serviceworker", { timeout: 10000 }).catch(() => null);
  if (sw?.url().includes("background.bundle.js")) {
    extId = new URL(sw.url()).hostname;
  }
}
console.log("Extension ID:", extId);

if (extId === "unknown") {
  console.error("Failed to detect TLSNotary Extension. Check /tmp/tlsn-extension.");
  process.exit(1);
}

// Open DevConsole
const devConsoleUrl = `chrome-extension://${extId}/devConsole.html`;
console.log("Opening DevConsole:", devConsoleUrl);
const page = await context.newPage();
await page.goto(devConsoleUrl);
await page.waitForLoadState("networkidle");

// Plugin code to inject
const pluginCode = `// Anchr: prove Stripe Payment Intent status via API
const PAYMENT_INTENT_ID = '${PAYMENT_INTENT_ID}';
const STRIPE_KEY = '${STRIPE_SECRET_KEY}';
const VERIFIER_URL = 'ws://localhost:7047';
const PROXY_URL = 'ws://localhost:7047/proxy?token=api.stripe.com';

export default {
  config: {
    name: 'Anchr: Stripe API',
    description: 'Prove Stripe Payment Intent status',
    requests: [{
      method: 'GET',
      host: 'api.stripe.com',
      pathname: '/**',
      verifierUrl: VERIFIER_URL,
    }],
  },
  main: async () => {
    const proof = await prove(
      {
        url: \`https://api.stripe.com/v1/payment_intents/\${PAYMENT_INTENT_ID}\`,
        method: 'GET',
        headers: {
          'Host': 'api.stripe.com',
          'Authorization': \`Bearer \${STRIPE_KEY}\`,
          'Accept': 'application/json',
          'Accept-Encoding': 'identity',
          'Connection': 'close',
        },
      },
      {
        verifierUrl: VERIFIER_URL,
        proxyUrl: PROXY_URL,
        maxRecvData: 4096,
        maxSentData: 4096,
        handlers: [
          { type: 'SENT', part: 'START_LINE', action: 'REVEAL' },
          { type: 'RECV', part: 'STATUS_CODE', action: 'REVEAL' },
          { type: 'RECV', part: 'BODY', action: 'REVEAL' },
        ],
      }
    );

    try {
      await navigator.clipboard.writeText(JSON.stringify(proof));
      console.log('[Anchr] Proof copied to clipboard');
    } catch (e) {
      console.log('[Anchr] Proof:', JSON.stringify(proof).slice(0, 200));
    }

    done(proof);
  },
};`;

// Inject code into the editor
console.log("Injecting plugin code into DevConsole...");
await page.waitForTimeout(2000);

// Click on the editor area to focus it, then select all and type
const editorArea = page.locator('[contenteditable="true"]').first();
const hasContentEditable = await editorArea.count() > 0;

if (hasContentEditable) {
  await editorArea.click();
  // Select all and replace
  await page.keyboard.press("Meta+a");
  await page.waitForTimeout(200);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(200);
  // Type the code via clipboard
  await page.evaluate((code) => {
    navigator.clipboard.writeText(code);
  }, pluginCode);
  await page.keyboard.press("Meta+v");
  console.log("Code injected via contenteditable + clipboard");
} else {
  // Try clicking the code area with line numbers and using keyboard
  const codeArea = page.locator('.code-editor, .editor, [role="textbox"]').first();
  if (await codeArea.count() > 0) {
    await codeArea.click();
  } else {
    // Click roughly where the editor is (top-left area based on screenshot)
    await page.mouse.click(400, 120);
  }
  await page.waitForTimeout(300);
  await page.keyboard.press("Meta+a");
  await page.waitForTimeout(200);

  // Use clipboard to paste
  await page.evaluate((code) => {
    navigator.clipboard.writeText(code);
  }, pluginCode);
  await page.keyboard.press("Meta+v");
  console.log("Code injected via click + clipboard paste");
}

await page.waitForTimeout(1000);
await page.screenshot({ path: "/tmp/devconsole-after-inject.png" });
console.log("Screenshot saved to /tmp/devconsole-after-inject.png");

// Monitor console output from all pages
page.on('console', msg => {
  console.log(`[devconsole] ${msg.text()}`);
});

// Listen for new pages (Allow popup may open as new tab/window)
context.on('page', async (newPage) => {
  console.log(`[new page] ${newPage.url()}`);
  await newPage.waitForLoadState("domcontentloaded").catch(() => {});
  await newPage.screenshot({ path: "/tmp/new-page.png" }).catch(() => {});

  // Try to find and click Allow button
  try {
    const allowBtn = newPage.locator('button', { hasText: /allow/i }).first();
    if (await allowBtn.count() > 0) {
      await allowBtn.click({ timeout: 5000 });
      console.log("[new page] Clicked Allow!");
    }
  } catch {}
});

// Click "Run Code" button
console.log("Clicking 'Run Code'...");
const runButton = page.locator('button', { hasText: /run/i }).first();
await runButton.click();
console.log("Run Code clicked!");

// Wait a bit for popup to appear
await page.waitForTimeout(3000);

// Check all pages for Allow button
const pages = context.pages();
console.log(`Open pages: ${pages.length}`);
for (const p of pages) {
  console.log(`  - ${p.url()}`);
  try {
    const allowBtn = p.locator('button', { hasText: /allow/i }).first();
    if (await allowBtn.count() > 0) {
      await allowBtn.click({ timeout: 3000 });
      console.log(`  -> Clicked Allow on ${p.url()}`);
    }
  } catch {}
}

// Also check if Allow is on the same page (might be a modal)
try {
  const allowBtn = page.locator('button', { hasText: /allow/i }).first();
  if (await allowBtn.count() > 0) {
    await allowBtn.click({ timeout: 3000 });
    console.log("Clicked Allow on DevConsole page (modal)!");
  }
} catch {}

// Take screenshot after Run Code
await page.waitForTimeout(2000);
await page.screenshot({ path: "/tmp/devconsole-after-run.png" });
console.log("Screenshot saved to /tmp/devconsole-after-run.png");

console.log("Waiting for proof generation (this may take a while for RSA sites)...");

// Periodically take screenshots and check verifier logs
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(10000);
  await page.screenshot({ path: "/tmp/devconsole-progress.png" });
  console.log(`[${Math.round((i + 1) * 10)}s] Screenshot updated`);
}

await new Promise(() => {});
