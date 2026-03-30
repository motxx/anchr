import { chromium } from "playwright";

const SQUARE_ACCESS_TOKEN = process.env.SANDBOX_ACCESS_TOKEN;
if (!SQUARE_ACCESS_TOKEN) {
  console.error("SANDBOX_ACCESS_TOKEN is required in .env or environment");
  process.exit(1);
}

// Get latest Payment ID (or create a test payment)
console.log("Creating test payment in Square sandbox...");
const locationResp = await fetch("https://connect.squareupsandbox.com/v2/locations", {
  headers: { "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}` },
});
const locationData = await locationResp.json();
const locationId = locationData.locations?.[0]?.id;
if (!locationId) {
  console.error("No Square sandbox location found.");
  process.exit(1);
}

const payResp = await fetch("https://connect.squareupsandbox.com/v2/payments", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    source_id: "cnon:card-nonce-ok",
    idempotency_key: crypto.randomUUID(),
    amount_money: { amount: 100, currency: "JPY" },
    location_id: locationId,
  }),
});
const payData = await payResp.json();
const PAYMENT_ID = payData.payment?.id;
if (!PAYMENT_ID) {
  console.error("Failed to create test payment:", JSON.stringify(payData));
  process.exit(1);
}
console.log(`Payment ID: ${PAYMENT_ID} (status: ${payData.payment.status})`);

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
  console.error("Failed to detect TLSNotary Extension.");
  process.exit(1);
}

// Open DevConsole
const devConsoleUrl = `chrome-extension://${extId}/devConsole.html`;
console.log("Opening DevConsole:", devConsoleUrl);
const page = await context.newPage();
await page.goto(devConsoleUrl);
await page.waitForLoadState("networkidle");

// Plugin code
const pluginCode = `// Anchr: prove Square Payment status via API
const PAYMENT_ID = '${PAYMENT_ID}';
const SQUARE_KEY = '${SQUARE_ACCESS_TOKEN}';
const VERIFIER_URL = 'ws://localhost:7047';
const PROXY_URL = 'ws://localhost:7047/proxy?token=connect.squareupsandbox.com';

export default {
  config: {
    name: 'Anchr: Square API',
    description: 'Prove Square Payment status',
    requests: [{
      method: 'GET',
      host: 'connect.squareupsandbox.com',
      pathname: '/**',
      verifierUrl: VERIFIER_URL,
    }],
  },
  main: async () => {
    const proof = await prove(
      {
        url: \`https://connect.squareupsandbox.com/v2/payments/\${PAYMENT_ID}\`,
        method: 'GET',
        headers: {
          'Host': 'connect.squareupsandbox.com',
          'Authorization': \`Bearer \${SQUARE_KEY}\`,
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

// Inject code
console.log("Injecting plugin code...");
await page.waitForTimeout(2000);
const editorArea = page.locator('[contenteditable="true"]').first();
await editorArea.click();
await page.keyboard.press("Meta+a");
await page.waitForTimeout(200);
await page.keyboard.press("Backspace");
await page.waitForTimeout(200);
await page.evaluate((code) => { navigator.clipboard.writeText(code); }, pluginCode);
await page.keyboard.press("Meta+v");
await page.waitForTimeout(1000);
console.log("Code injected.");

// Monitor console
page.on('console', msg => {
  console.log(`[devconsole] ${msg.text()}`);
});

// Listen for Allow popup
context.on('page', async (newPage) => {
  console.log(`[new page] ${newPage.url()}`);
  await newPage.waitForLoadState("domcontentloaded").catch(() => {});
  try {
    const allowBtn = newPage.locator('button', { hasText: /allow/i }).first();
    if (await allowBtn.count() > 0) {
      await allowBtn.click({ timeout: 5000 });
      console.log("[new page] Clicked Allow!");
    }
  } catch {}
});

// Click Run Code
console.log("Clicking Run Code...");
const runButton = page.locator('button', { hasText: /run/i }).first();
await runButton.click();
console.log("Run Code clicked! Waiting for proof...");

const startTime = Date.now();

// Wait for completion - check console output
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(2000);
  const elapsed = Math.round((Date.now() - startTime) / 1000);

  // Check if proof completed by looking at console
  const consoleText = await page.locator('.console, [class*="console"]').textContent().catch(() => "");
  if (consoleText.includes("Proof copied") || consoleText.includes("Proof:")) {
    console.log(`\n=== PROOF COMPLETED in ${elapsed}s ===`);
    await page.screenshot({ path: "/tmp/square-proof-done.png" });
    break;
  }
  if (consoleText.includes("error") || consoleText.includes("Error")) {
    console.log(`\n=== ERROR after ${elapsed}s ===`);
    console.log(consoleText);
    await page.screenshot({ path: "/tmp/square-proof-error.png" });
    break;
  }
  process.stdout.write(`\r[${elapsed}s] Waiting...`);
}

// Final screenshot
await page.screenshot({ path: "/tmp/square-proof-final.png" });
console.log("\nScreenshot: /tmp/square-proof-final.png");

// Keep browser open briefly for inspection
await page.waitForTimeout(3000);
await context.close();
