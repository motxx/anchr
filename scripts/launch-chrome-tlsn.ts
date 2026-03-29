import { chromium } from "playwright";

const context = await chromium.launchPersistentContext("/tmp/chrome-tlsn-profile", {
  headless: false,
  args: [
    "--disable-extensions-except=/private/tmp/tlsn-extension",
    "--load-extension=/private/tmp/tlsn-extension",
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

// Wait for service worker to start
let extId = "unknown";
for (let i = 0; i < 20; i++) {
  const sw = context.serviceWorkers().find(s => s.url().includes("background.bundle.js"));
  if (sw) {
    extId = new URL(sw.url()).hostname;
    break;
  }
  await new Promise(r => setTimeout(r, 500));
}

if (extId === "unknown") {
  // Try waiting for the next service worker event
  const sw = await context.waitForEvent("serviceworker", { timeout: 10000 }).catch(() => null);
  if (sw && sw.url().includes("background.bundle.js")) {
    extId = new URL(sw.url()).hostname;
  }
}

console.log("Extension ID:", extId);
console.log("DevConsole:", `chrome-extension://${extId}/devConsole.html`);

// Open DevConsole in a new tab
if (extId !== "unknown") {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/devConsole.html`);
}

await new Promise(() => {});
