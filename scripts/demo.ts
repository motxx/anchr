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

const TOTAL_STEPS = 6;
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

  // Step 2: Create query
  step(2, "Creating query...");
  const createRes = await app.request("http://localhost/queries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      description: "渋谷ラーメン太郎の営業状況",
      location_hint: "Shibuya",
      ttl_seconds: 300,
    }),
  });
  const createJson = await createRes.json() as {
    query_id: string; description: string; status: string;
    challenge_nonce: string | null; reference_app_url: string;
  };
  if (createRes.status === 201) {
    ok(`Query created: ${createJson.query_id}`);
    info(`Description: ${createJson.description}${createJson.challenge_nonce ? ` | Nonce: ${createJson.challenge_nonce}` : ""}`);
    info(`URL: ${createJson.reference_app_url}`);
  } else {
    err(`Failed to create query (${createRes.status})`);
  }

  // Step 3: List open queries
  step(3, "Listing open queries...");
  const listRes = await app.request("http://localhost/queries");
  const listed = await listRes.json() as Array<{ id: string; description: string }>;
  if (listed.length >= 1) {
    ok(`Found ${listed.length} open queries`);
    for (const q of listed) {
      info(`- ${q.id} (${q.description})`);
    }
  } else {
    err(`Expected at least 1 open query, found ${listed.length}`);
  }

  // Step 4: Submit result
  step(4, "Submitting result...");
  const submitRes = await app.request(`http://localhost/queries/${createJson.query_id}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      attachments: [],
      notes: `Observed storefront open${createJson.challenge_nonce ? ` ${createJson.challenge_nonce}` : ""}`,
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

  // Step 5: Verify query status
  step(5, "Checking query status...");
  const statusRes = await app.request(`http://localhost/queries/${createJson.query_id}`);
  const statusJson = await statusRes.json() as {
    id: string; status: string; payment_status: string;
  };
  if (statusJson.status === "approved") {
    ok(`Query ${statusJson.id} → ${statusJson.status}`);
    info(`Payment: ${statusJson.payment_status}`);
  } else {
    err(`Expected approved, got ${statusJson.status}`);
  }

  // Step 6: Verify Nostr relay events
  step(6, "Reading events from Nostr relay...");
  await Bun.sleep(1500);
  const events = await readRelayEvents({
    kinds: [ANCHR_QUERY_REQUEST],
    "#t": ["anchr"],
    since,
  });

  const demoEvents = events.filter((e) => {
    try {
      const p = JSON.parse(e.content);
      return p.description === "渋谷ラーメン太郎の営業状況";
    } catch { return false; }
  });

  if (demoEvents.length >= 1) {
    ok(`Found ${demoEvents.length} Anchr events on relay (kind ${ANCHR_QUERY_REQUEST})`);
    for (const e of demoEvents) {
      const p = JSON.parse(e.content);
      const dTag = e.tags.find((t) => t[0] === "d")?.[1] ?? "?";
      info(`- "${p.description}" [d=${dTag}] pubkey=${e.pubkey.slice(0, 12)}...`);
    }
  } else {
    err(`Expected at least 1 event on relay, found ${demoEvents.length}`);
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
