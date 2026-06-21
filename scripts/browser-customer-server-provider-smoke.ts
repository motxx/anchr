#!/usr/bin/env -S deno run --allow-all
import puppeteer, { type Browser } from "puppeteer";
import { fromFileUrl } from "jsr:@std/path@^1";

import { startBrowserCustomerServerProviderExample } from "../examples/browser-customer-server-provider/server.ts";

interface SmokeResult {
  status: "pass";
  customer_runtime: "browser";
  provider_runtime: "deno-server";
  relay_runtime: "docker-nostr-rs-relay";
  mint_runtime: "docker-cashu-regtest";
  oracle_runtime: "sdk-nostr-oracle";
  proof_runtime: "tlsnotary";
  amount_sats: number;
  request_count: number;
  offer_count: number;
  oracle_verification_pass_count: number;
  provider_redeem_count: number;
  provider_pubkey_prefix: string;
  payment_lock_token_prefix: string;
  payment_lock_proof_count: number;
  proof_bytes: number;
  schema: string;
  data: SmokeData;
}

interface SmokeData {
  message: string;
  target: string;
  server: string;
  schema: string;
}

const ROOT = new URL("../", import.meta.url);
const EXAMPLE = new URL("examples/browser-customer-server-provider/", ROOT);
const BUNDLE = new URL("dist/app.js", EXAMPLE);
const CUSTOMER_RESULT_TIMEOUT_MS = 120_000;
const SERVER_SETTLEMENT_TIMEOUT_MS = 120_000;
const SMOKE_STATUS_TIMEOUT_MS = CUSTOMER_RESULT_TIMEOUT_MS +
  SERVER_SETTLEMENT_TIMEOUT_MS + 30_000;

async function main(): Promise<void> {
  await assertBrowserSourceIsPortable();
  const server = await startBrowserCustomerServerProviderExample({
    bundle: true,
  });

  let browser: Browser | null = null;
  try {
    await assertBundleIsPortable();
    const executablePath = await requireBrowserExecutable();
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error instanceof Error ? error.message : String(error));
    });

    await page.goto(server.url, {
      waitUntil: "domcontentloaded",
      timeout: 15_000,
    });
    await page.waitForFunction(
      () => {
        const status = document.documentElement.dataset.anchrStatus;
        return status === "pass" || status === "fail";
      },
      { timeout: SMOKE_STATUS_TIMEOUT_MS },
    );
    const resultText = await page.$eval(
      "[data-result]",
      (element) => element.textContent ?? "",
    );
    const statusText = await page.$eval(
      "[data-status]",
      (element) => element.textContent ?? "",
    );
    if (statusText !== "pass") {
      throw new Error(`browser example failed: ${resultText}`);
    }
    const parsed = JSON.parse(resultText) as unknown;
    if (!isSmokeResult(parsed)) {
      throw new Error(`unexpected smoke result: ${resultText}`);
    }
    if (pageErrors.length > 0) {
      throw new Error(`browser page errors: ${pageErrors.join("; ")}`);
    }

    console.log(
      `browser-customer-server-provider smoke passed: amount=${parsed.amount_sats} provider=${parsed.provider_pubkey_prefix}`,
    );
  } finally {
    try {
      if (browser !== null) {
        await browser.close();
      }
    } finally {
      await server.shutdown();
    }
  }
}

async function assertBrowserSourceIsPortable(): Promise<void> {
  const source = await Deno.readTextFile(new URL("app.ts", EXAMPLE));
  assertNoPortableHits(source, fromFileUrl(new URL("app.ts", EXAMPLE)), [
    {
      label: "root sdk barrel",
      pattern: /from\s+["']@anchr\/sdk["']/,
    },
    {
      label: "server-only sdk subpath",
      pattern:
        /@anchr\/sdk\/(?:adapters\/nostr|adapters\/oracle-service|payments|proofs|attachments)/,
    },
    {
      label: "runtime global",
      pattern: /\bDeno\.|\bprocess(?:\.|\[)|node:/,
    },
  ]);
}

async function assertBundleIsPortable(): Promise<void> {
  const bundle = await Deno.readTextFile(BUNDLE);
  assertNoPortableHits(bundle, fromFileUrl(BUNDLE), [
    { label: "Deno runtime global", pattern: /\bDeno\./ },
    { label: "process runtime global", pattern: /\bprocess(?:\.|\[)/ },
    { label: "node module specifier", pattern: /node:/ },
    {
      label: "server-only sdk subpath",
      pattern:
        /@anchr\/sdk\/(?:adapters\/nostr|adapters\/oracle-service|payments|proofs|attachments)/,
    },
  ]);
}

interface PortableCheck {
  label: string;
  pattern: RegExp;
}

function assertNoPortableHits(
  text: string,
  file: string,
  checks: readonly PortableCheck[],
): void {
  for (const check of checks) {
    const match = text.match(check.pattern);
    if (match === null) continue;
    throw new Error(
      `browser portability check failed for ${file}: ${check.label} (${
        match[0]
      })`,
    );
  }
}

async function findBrowserExecutable(): Promise<string | undefined> {
  const envPath = Deno.env.get("PUPPETEER_EXECUTABLE_PATH");
  if (envPath !== undefined && await isFile(envPath)) {
    return envPath;
  }

  const home = Deno.env.get("HOME");
  const candidates: string[] = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
  if (home !== undefined) {
    candidates.push(
      ...[
        ...await findExecutableFiles(`${home}/.cache/puppeteer/chrome`, 8),
        ...await findExecutableFiles(
          `${home}/.cache/puppeteer/chrome-headless-shell`,
          8,
        ),
      ].sort().reverse(),
    );
  }
  candidates.push(...pathBrowserCandidates(Deno.env.get("PATH")));

  for (const candidate of new Set(candidates)) {
    if (await isFile(candidate)) return candidate;
  }
  return undefined;
}

async function requireBrowserExecutable(): Promise<string> {
  const executablePath = await findBrowserExecutable();
  if (executablePath !== undefined) return executablePath;
  throw new Error(
    "Chrome/Chromium executable not found. Install Chrome/Chromium or set PUPPETEER_EXECUTABLE_PATH to the browser binary.",
  );
}

function pathBrowserCandidates(pathValue: string | undefined): string[] {
  if (pathValue === undefined) return [];
  const executableNames = [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ];
  return pathValue
    .split(":")
    .filter((directory) => directory.length > 0)
    .flatMap((directory) =>
      executableNames.map((name) => `${directory}/${name}`)
    );
}

async function findExecutableFiles(
  directory: string,
  maxDepth: number,
): Promise<string[]> {
  const names = new Set([
    "Google Chrome",
    "Google Chrome for Testing",
    "Chromium",
    "chrome",
    "chromium",
    "chrome-headless-shell",
  ]);
  const results: string[] = [];

  async function visit(path: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries: Deno.DirEntry[];
    try {
      entries = [];
      for await (const entry of Deno.readDir(path)) {
        entries.push(entry);
      }
    } catch {
      return;
    }

    for (const entry of entries) {
      const child = `${path}/${entry.name}`;
      if (entry.isFile && names.has(entry.name)) {
        results.push(child);
      } else if (entry.isDirectory) {
        await visit(child, depth + 1);
      }
    }
  }

  await visit(directory, 0);
  return results;
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

function isSmokeResult(value: unknown): value is SmokeResult {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.status === "pass" &&
    record.customer_runtime === "browser" &&
    record.provider_runtime === "deno-server" &&
    record.relay_runtime === "docker-nostr-rs-relay" &&
    record.mint_runtime === "docker-cashu-regtest" &&
    record.oracle_runtime === "sdk-nostr-oracle" &&
    record.proof_runtime === "tlsnotary" &&
    record.amount_sats === 16 &&
    typeof record.request_count === "number" &&
    record.request_count >= 1 &&
    typeof record.offer_count === "number" &&
    record.offer_count >= 1 &&
    typeof record.oracle_verification_pass_count === "number" &&
    record.oracle_verification_pass_count >= 1 &&
    typeof record.provider_redeem_count === "number" &&
    record.provider_redeem_count >= 1 &&
    typeof record.provider_pubkey_prefix === "string" &&
    record.provider_pubkey_prefix.length > 0 &&
    typeof record.payment_lock_token_prefix === "string" &&
    record.payment_lock_token_prefix.length > 0 &&
    typeof record.payment_lock_proof_count === "number" &&
    record.payment_lock_proof_count > 0 &&
    typeof record.proof_bytes === "number" &&
    record.proof_bytes > 100 &&
    typeof record.schema === "string" &&
    isSmokeData(record.data);
}

function isSmokeData(value: unknown): value is SmokeData {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.message === "browser customer paid server provider" &&
    record.target ===
      "https://api.bitflyer.com/v1/ticker?product_code=BTC_JPY" &&
    record.server === "api.bitflyer.com" &&
    typeof record.schema === "string";
}

if (import.meta.main) {
  await main();
}
