/**
 * E2E tests for the Anchr Worker Web app.
 *
 * Uses headless Chromium (gstack browse) to test the full UI flow.
 *
 * Prerequisites:
 *   1. Anchr server running on localhost:3000
 *   2. Expo web running on localhost:8082 (cd mobile && bun run web -- --port 8082)
 *
 * Run:
 *   bun test e2e/web.test.ts
 */

import { afterAll, beforeAll, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { spawn, fileExists } from "../src/runtime/mod.ts";

const BROWSE = `${process.env.HOME}/.claude/skills/gstack/browse/dist/browse`;
const SERVER_URL = "http://localhost:3000";
const WEB_URL = "http://localhost:8082";

async function browse(...args: string[]): Promise<string> {
  const proc = spawn([BROWSE, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout.trim();
}

async function isWebAppReachable(): Promise<boolean> {
  try {
    const res = await fetch(WEB_URL, { signal: AbortSignal.timeout(5000) });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

async function isServerReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(3000) });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

async function hasBrowseTool(): Promise<boolean> {
  try {
    return await fileExists(BROWSE);
  } catch {
    return false;
  }
}

describe("e2e: Anchr Worker Web app", () => {
  let webReachable = false;
  let serverReachable = false;
  let browseAvailable = false;
  let testQueryId: string | null = null;

  beforeAll(async () => {
    [webReachable, serverReachable, browseAvailable] = await Promise.all([
      isWebAppReachable(),
      isServerReachable(),
      hasBrowseTool(),
    ]);
    if (!webReachable) console.warn("[e2e-web] Web app not reachable at", WEB_URL, "— skipping");
    if (!serverReachable) console.warn("[e2e-web] Server not reachable at", SERVER_URL, "— skipping");
    if (!browseAvailable) console.warn("[e2e-web] browse tool not found at", BROWSE, "— skipping");
  });

  afterAll(async () => {
    // Clean up test query
    if (testQueryId) {
      await fetch(`${SERVER_URL}/queries/${testQueryId}/cancel`, { method: "POST" }).catch(() => {});
    }
    // Don't stop browse server — it may be shared with other tests/sessions
  });

  function skip() {
    return !webReachable || !serverReachable || !browseAvailable;
  }

  test("prerequisites are available", () => {
    if (skip()) {
      console.warn("[e2e-web] SKIPPED — infrastructure not ready");
      return;
    }
    expect(webReachable).toBe(true);
    expect(serverReachable).toBe(true);
    expect(browseAvailable).toBe(true);
  });

  test("create test query via API", async () => {
    if (skip()) return;

    const res = await fetch(`${SERVER_URL}/queries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "E2E Web: 渋谷の様子を撮影してください",
        location_hint: "渋谷",
        expected_gps: { lat: 35.6595, lon: 139.7004 },
        max_gps_distance_km: 5,
        ttl_seconds: 600,
        bounty: { amount_sats: 10 },
        verification_requirements: [],
      }),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { query_id: string };
    testQueryId = data.query_id;
    expect(testQueryId).toMatch(/^query_/);
  });

  test("web app loads and shows queries", async () => {
    if (skip()) return;

    await browse("goto", WEB_URL);
    // Wait for React Query to fetch data
    await browse("wait", "--networkidle");
    await new Promise(r => setTimeout(r, 2000));

    const text = await browse("text");
    expect(text).toContain("Anchr");
    expect(text).toContain("Queries");
    // Our test query should be visible
    expect(text).toContain("E2E Web");
    expect(text).toContain("渋谷");
  }, 30_000);

  test("query card shows bounty and location", async () => {
    if (skip()) return;

    const text = await browse("text");
    expect(text).toContain("Pending");
    expect(text).toContain("10 sats");
    expect(text).toContain("渋谷");
  });

  test("navigate to query detail view", async () => {
    if (skip() || !testQueryId) return;

    // Navigate directly to the detail URL (expo-router web routing)
    await browse("goto", `${WEB_URL}/${testQueryId}`);
    await browse("wait", "--networkidle");
    await new Promise(r => setTimeout(r, 2000));

    const text = await browse("text");

    // Detail view should show full description and action buttons
    expect(text).toContain("渋谷の様子を撮影してください");
    expect(text).toContain("Camera");
    expect(text).toContain("Import");
    expect(text).toContain("10 sats");
  }, 15_000);

  test("navigate to Wallet tab", async () => {
    if (skip()) return;

    // Go back to tabs first
    await browse("goto", WEB_URL);
    await browse("wait", "--networkidle");
    await new Promise(r => setTimeout(r, 1500));

    // Click Wallet tab
    await browse("js", `
      const tab = [...document.querySelectorAll('[role="button"], a, [role="tab"]')]
        .find(e => e.textContent.includes('Wallet'));
      if (tab) tab.click();
    `);
    await new Promise(r => setTimeout(r, 1000));

    const text = await browse("text");
    expect(text).toContain("Balance");
    expect(text).toContain("sats");
  }, 15_000);

  test("navigate to Settings tab", async () => {
    if (skip()) return;

    await browse("js", `
      const tab = [...document.querySelectorAll('[role="button"], a, [role="tab"]')]
        .find(e => e.textContent.includes('Settings'));
      if (tab) tab.click();
    `);
    await new Promise(r => setTimeout(r, 1000));

    const text = await browse("text");
    expect(text).toContain("Settings");
    expect(text).toContain("Server URL");
  }, 15_000);

  test("navigate to Map tab", async () => {
    if (skip()) return;

    await browse("js", `
      const tab = [...document.querySelectorAll('[role="button"], a, [role="tab"]')]
        .find(e => e.textContent.includes('Map'));
      if (tab) tab.click();
    `);
    await new Promise(r => setTimeout(r, 1000));

    const text = await browse("text");
    expect(text).toContain("Map");
  }, 15_000);

  test("submit text result via API and verify web reflects status", async () => {
    if (skip() || !testQueryId) return;

    // Submit via API (use /result endpoint — /submit is deprecated 410)
    const submitRes = await fetch(`${SERVER_URL}/queries/${testQueryId}/result`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        worker_pubkey: "e2e_web_test_worker",
        gps: { lat: 35.6595, lon: 139.7004 },
        notes: "E2E web test — 混雑してます",
      }),
    });
    const submitJson = (await submitRes.json()) as { ok: boolean; payment_status: string };
    expect(submitJson.ok).toBe(true);
    expect(submitJson.payment_status).toBe("released");

    // Navigate back to queries tab and verify
    await browse("goto", WEB_URL);
    await browse("wait", "--networkidle");
    await new Promise(r => setTimeout(r, 2000));

    const text = await browse("text");
    // Query should no longer be in pending list (it's completed)
    // It might show in "Completed" section or not show at all
    // The key check: it should NOT show "Pending" for our test query
    const lines = text.split("\n");
    const e2eLine = lines.find((l) => l.includes("E2E Web"));
    // If query appears, it should be in completed section, not pending
    if (e2eLine) {
      expect(text).not.toContain("E2E Web: 渋谷の様子を撮影してください\nPending");
    }

    // Clean up — mark as handled
    testQueryId = null;
  }, 30_000);
});
