#!/usr/bin/env bun
/**
 * Anchr Demo — full query lifecycle with local Nostr relay.
 *
 *   bun run demo            # docker compose up + demo
 *   bun run scripts/demo.ts # relay already running
 */

import { SimplePool } from "nostr-tools/pool";
import type { Filter } from "nostr-tools/filter";
import type { Event } from "nostr-tools/core";
import { buildWorkerApiApp } from "../src/worker-api";
import { clearQueryStore } from "../src/query-service";
import { closePool } from "../src/nostr/client";
import { ANCHR_QUERY_REQUEST } from "../src/nostr/events";

// --- Formatting ---

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

const TOTAL_STEPS = 7;
let passed = 0;
let failed = 0;

function header() {
  console.log(`\n${CYAN}${BOLD}${"═".repeat(52)}${RESET}`);
  console.log(`${CYAN}${BOLD}  Anchr Demo — Full Query Lifecycle with Nostr Relay${RESET}`);
  console.log(`${CYAN}${BOLD}${"═".repeat(52)}${RESET}\n`);
}

function step(n: number, msg: string) {
  console.log(`${BOLD}[${n}/${TOTAL_STEPS}]${RESET} ${msg}`);
}

function ok(msg: string) {
  passed++;
  console.log(`      ${GREEN}✓${RESET} ${msg}`);
}

function info(msg: string) {
  console.log(`      ${DIM}${msg}${RESET}`);
}

function err(msg: string) {
  failed++;
  console.log(`      ${RED}✗${RESET} ${msg}`);
}

function summary() {
  console.log(`\n${CYAN}${BOLD}${"═".repeat(52)}${RESET}`);
  if (failed === 0) {
    console.log(`  ${GREEN}${BOLD}All ${passed} checks passed.${RESET} Demo complete.`);
  } else {
    console.log(`  ${RED}${BOLD}${failed} check(s) failed${RESET}, ${passed} passed.`);
  }
  console.log(`${CYAN}${BOLD}${"═".repeat(52)}${RESET}\n`);
}

// --- Relay helpers ---

const RELAY_URL = process.env.NOSTR_RELAYS?.split(",")[0]?.trim() ?? "ws://localhost:7777";

async function waitForRelay(maxRetries = 5): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const ws = new WebSocket(RELAY_URL);
      const reachable = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => { ws.close(); resolve(false); }, 2000);
        ws.onopen = () => { clearTimeout(t); ws.close(); resolve(true); };
        ws.onerror = () => { clearTimeout(t); resolve(false); };
      });
      if (reachable) return true;
    } catch { /* retry */ }
    await Bun.sleep(1000);
  }
  return false;
}

async function readRelayEvents(filter: Filter, timeoutMs = 5000): Promise<Event[]> {
  const pool = new SimplePool();
  const events: Event[] = [];
  return new Promise<Event[]>((resolve) => {
    const timer = setTimeout(() => { sub.close(); pool.close([]); resolve(events); }, timeoutMs);
    const sub = pool.subscribeMany([RELAY_URL], filter, {
      onevent(event) { events.push(event); },
      oneose() { clearTimeout(timer); sub.close(); pool.close([]); resolve(events); },
    });
  });
}

// --- Main ---

async function runDemo() {
  header();
  clearQueryStore();
  const app = buildWorkerApiApp();
  const since = Math.floor(Date.now() / 1000) - 5;

  // Step 1: Relay check
  step(1, "Checking Nostr relay...");
  const reachable = await waitForRelay();
  if (!reachable) {
    err(`Relay not reachable at ${RELAY_URL}`);
    info("Run: docker compose up -d --wait");
    return;
  }
  ok(`Relay reachable at ${RELAY_URL}`);

  // Step 2: Create store_status query
  step(2, "Creating store_status query...");
  const storeRes = await app.request("http://localhost/queries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "store_status",
      store_name: "渋谷ラーメン太郎",
      location_hint: "Shibuya",
      ttl_seconds: 300,
    }),
  });
  const storeJson = await storeRes.json() as {
    query_id: string; type: string; status: string;
    challenge_nonce: string; reference_app_url: string;
  };
  if (storeRes.status === 201) {
    ok(`Query created: ${storeJson.query_id}`);
    info(`Type: ${storeJson.type} | Nonce: ${storeJson.challenge_nonce}`);
    info(`URL: ${storeJson.reference_app_url}`);
  } else {
    err(`Failed to create store_status query (${storeRes.status})`);
  }

  // Step 3: Create photo_proof query
  step(3, "Creating photo_proof query...");
  const photoRes = await app.request("http://localhost/queries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "photo_proof",
      target: "秋葉原駅前の看板",
      location_hint: "Akihabara",
      ttl_seconds: 300,
    }),
  });
  const photoJson = await photoRes.json() as {
    query_id: string; type: string; challenge_nonce: string;
  };
  if (photoRes.status === 201) {
    ok(`Query created: ${photoJson.query_id}`);
    info(`Type: ${photoJson.type} | Nonce: ${photoJson.challenge_nonce}`);
  } else {
    err(`Failed to create photo_proof query (${photoRes.status})`);
  }

  // Step 4: List open queries
  step(4, "Listing open queries...");
  const listRes = await app.request("http://localhost/queries");
  const listed = await listRes.json() as Array<{ id: string; type: string }>;
  if (listed.length >= 2) {
    ok(`Found ${listed.length} open queries`);
    for (const q of listed) {
      info(`- ${q.id} (${q.type})`);
    }
  } else {
    err(`Expected at least 2 open queries, found ${listed.length}`);
  }

  // Step 5: Submit result for store_status
  step(5, "Submitting result for store_status query...");
  const submitRes = await app.request(`http://localhost/queries/${storeJson.query_id}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "store_status",
      status: "open",
      notes: `Observed storefront open ${storeJson.challenge_nonce}`,
    }),
  });
  const submitJson = await submitRes.json() as {
    ok: boolean; payment_status: string;
    verification: { passed: boolean; checks: string[]; failures: string[] };
  };
  if (submitJson.ok) {
    ok("Verification passed");
    info(`Status: approved | Payment: ${submitJson.payment_status}`);
    info(`Checks: ${JSON.stringify(submitJson.verification.checks)}`);
  } else {
    err(`Verification failed: ${JSON.stringify(submitJson.verification?.failures)}`);
  }

  // Step 6: Verify query status
  step(6, "Checking query status...");
  const statusRes = await app.request(`http://localhost/queries/${storeJson.query_id}`);
  const statusJson = await statusRes.json() as {
    id: string; status: string; payment_status: string;
    result?: { type: string };
  };
  if (statusJson.status === "approved") {
    ok(`Query ${statusJson.id} → ${statusJson.status}`);
    info(`Payment: ${statusJson.payment_status} | Result type: ${statusJson.result?.type}`);
  } else {
    err(`Expected approved, got ${statusJson.status}`);
  }

  // Step 7: Verify Nostr relay events
  step(7, "Reading events from Nostr relay...");
  await Bun.sleep(1500);
  const events = await readRelayEvents({
    kinds: [ANCHR_QUERY_REQUEST],
    "#t": ["anchr"],
    since,
  });

  const demoEvents = events.filter((e) => {
    try {
      const p = JSON.parse(e.content);
      const name = p.params?.store_name ?? p.params?.target ?? "";
      return name === "渋谷ラーメン太郎" || name === "秋葉原駅前の看板";
    } catch { return false; }
  });

  if (demoEvents.length >= 2) {
    ok(`Found ${demoEvents.length} Anchr events on relay (kind ${ANCHR_QUERY_REQUEST})`);
    for (const e of demoEvents) {
      const p = JSON.parse(e.content);
      const name = p.params?.store_name ?? p.params?.target ?? "?";
      const dTag = e.tags.find((t) => t[0] === "d")?.[1] ?? "?";
      info(`- "${name}" [d=${dTag}] pubkey=${e.pubkey.slice(0, 12)}...`);
    }
  } else {
    err(`Expected 2 events on relay, found ${demoEvents.length}`);
  }

  // Cleanup
  clearQueryStore();
  closePool();
  summary();
}

runDemo()
  .catch((e) => {
    console.error(`${RED}Fatal:${RESET}`, e);
    failed++;
  })
  .finally(() => {
    process.exit(failed > 0 ? 1 : 0);
  });
