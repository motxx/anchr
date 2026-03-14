/**
 * E2E tests against a local Nostr relay (docker-compose).
 *
 * Prerequisites:
 *   docker compose up -d
 *
 * Run:
 *   NOSTR_RELAYS=ws://localhost:7777 bun test e2e/relay.test.ts
 *   or: bun run test:e2e
 *
 * For production the only change is NOSTR_RELAYS pointing to real relays.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { SimplePool } from "nostr-tools/pool";
import type { Filter } from "nostr-tools/filter";
import type { Event } from "nostr-tools/core";
import { buildWorkerApiApp } from "../src/worker-api";
import { clearQueryStore } from "../src/query-service";
import { closePool } from "../src/nostr/client";
import { ANCHR_QUERY_REQUEST } from "../src/nostr/events";

const RELAY_URL = process.env.NOSTR_RELAYS?.split(",")[0]?.trim() ?? "ws://localhost:7777";

async function isRelayReachable(): Promise<boolean> {
  try {
    const ws = new WebSocket(RELAY_URL);
    return await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => { ws.close(); resolve(false); }, 2000);
      ws.onopen = () => { clearTimeout(timeout); ws.close(); resolve(true); };
      ws.onerror = () => { clearTimeout(timeout); resolve(false); };
    });
  } catch {
    return false;
  }
}

async function waitForRelayEvent(
  relayUrl: string,
  filter: Filter,
  timeoutMs = 5000,
): Promise<Event[]> {
  const pool = new SimplePool();
  const events: Event[] = [];
  return new Promise<Event[]>((resolve) => {
    const timer = setTimeout(() => { sub.close(); pool.close([]); resolve(events); }, timeoutMs);
    const sub = pool.subscribeMany([relayUrl], filter, {
      onevent(event) {
        events.push(event);
      },
      oneose() {
        clearTimeout(timer);
        sub.close();
        pool.close([]);
        resolve(events);
      },
    });
  });
}

describe("e2e: full query lifecycle with Nostr relay", () => {
  let reachable = false;

  beforeAll(async () => {
    reachable = await isRelayReachable();
    if (!reachable) {
      console.warn(`[e2e] Relay not reachable at ${RELAY_URL} – skipping. Run: docker compose up -d`);
    }
    clearQueryStore();
  });

  afterAll(() => {
    closePool();
  });

  test("relay is reachable", () => {
    if (!reachable) {
      console.warn("[e2e] SKIPPED – relay not reachable");
      return;
    }
    expect(reachable).toBe(true);
  });

  test("create query via HTTP and verify relay publication", async () => {
    if (!reachable) return;

    const app = buildWorkerApiApp();

    const createRes = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "E2E Ramen Shop の営業状況",
        location_hint: "Shibuya",
        ttl_seconds: 120,
      }),
    });
    expect(createRes.status).toBe(201);

    const createJson = await createRes.json() as {
      query_id: string;
      description: string;
      status: string;
      challenge_nonce: string;
      reference_app_url: string;
    };
    expect(createJson.query_id).toStartWith("query_");
    expect(createJson.description).toBe("E2E Ramen Shop の営業状況");
    expect(createJson.status).toBe("pending");

    // Wait for fire-and-forget relay publish to complete
    await Bun.sleep(1500);

    // Verify the event appeared on the relay
    const events = await waitForRelayEvent(RELAY_URL, {
      kinds: [ANCHR_QUERY_REQUEST],
      "#t": ["anchr"],
      since: Math.floor(Date.now() / 1000) - 60,
    });

    const matchingEvent = events.find((e) => {
      try {
        const payload = JSON.parse(e.content);
        return payload.description === "E2E Ramen Shop の営業状況";
      } catch { return false; }
    });

    expect(matchingEvent).toBeDefined();
    expect(matchingEvent!.kind).toBe(ANCHR_QUERY_REQUEST);

    // Verify event tags
    const tags = matchingEvent!.tags;
    expect(tags.some((t) => t[0] === "t" && t[1] === "anchr")).toBe(true);
    expect(tags.some((t) => t[0] === "i" && t[1] === "E2E Ramen Shop の営業状況")).toBe(true);
  });

  test("full lifecycle: create → list → submit → verify status", async () => {
    if (!reachable) return;

    const app = buildWorkerApiApp();

    // 1. Create query
    const createRes = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "E2E Lifecycle Store の営業状況",
        location_hint: "Akihabara",
        ttl_seconds: 300,
      }),
    });
    expect(createRes.status).toBe(201);
    const { query_id, challenge_nonce } = await createRes.json() as {
      query_id: string;
      challenge_nonce: string;
    };

    // 2. List queries – should include our query
    const listRes = await app.request("http://localhost/queries");
    expect(listRes.status).toBe(200);
    const listed = await listRes.json() as Array<{ id: string }>;
    expect(listed.some((q) => q.id === query_id)).toBe(true);

    // 3. Get query detail
    const detailRes = await app.request(`http://localhost/queries/${query_id}`);
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json() as { id: string; status: string; challenge_nonce: string };
    expect(detail.status).toBe("pending");
    expect(detail.challenge_nonce).toBe(challenge_nonce);

    // 4. Submit result
    const submitRes = await app.request(`http://localhost/queries/${query_id}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        attachments: [],
        notes: `E2E test observation ${challenge_nonce}`,
      }),
    });
    expect(submitRes.status).toBe(200);
    const submitJson = await submitRes.json() as {
      ok: boolean;
      payment_status: string;
      verification: { passed: boolean };
    };
    expect(submitJson.ok).toBe(true);
    expect(submitJson.payment_status).toBe("released");
    expect(submitJson.verification.passed).toBe(true);

    // 5. Verify status is approved
    const statusRes = await app.request(`http://localhost/queries/${query_id}`);
    expect(statusRes.status).toBe(200);
    const statusJson = await statusRes.json() as { status: string; payment_status: string };
    expect(statusJson.status).toBe("approved");
    expect(statusJson.payment_status).toBe("released");
  });

  test("cancel query flow", async () => {
    if (!reachable) return;

    const app = buildWorkerApiApp();

    const createRes = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "E2E Cancel Store", ttl_seconds: 120 }),
    });
    const { query_id } = await createRes.json() as { query_id: string };

    const cancelRes = await app.request(`http://localhost/queries/${query_id}/cancel`, {
      method: "POST",
    });
    expect(cancelRes.status).toBe(200);
    const cancelJson = await cancelRes.json() as { ok: boolean };
    expect(cancelJson.ok).toBe(true);

    // Verify no longer in open list
    const listRes = await app.request("http://localhost/queries");
    const listed = await listRes.json() as Array<{ id: string }>;
    expect(listed.some((q) => q.id === query_id)).toBe(false);
  });

  test("multiple queries appear on relay", async () => {
    if (!reachable) return;

    const app = buildWorkerApiApp();
    const since = Math.floor(Date.now() / 1000) - 5;

    // Create 3 queries in parallel
    const descriptions = ["E2E Alpha の確認", "E2E Bravo の確認", "E2E Charlie の確認"];
    await Promise.all(
      descriptions.map((desc) =>
        app.request("http://localhost/queries", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ description: desc, ttl_seconds: 120 }),
        }),
      ),
    );

    // Wait for relay publish
    await Bun.sleep(2000);

    const events = await waitForRelayEvent(RELAY_URL, {
      kinds: [ANCHR_QUERY_REQUEST],
      "#t": ["anchr"],
      since,
    });

    const e2eEvents = events.filter((e) => {
      try {
        const p = JSON.parse(e.content);
        return typeof p.description === "string" && p.description.startsWith("E2E ");
      } catch { return false; }
    });

    // At least our 3 should be there
    const foundDescriptions = e2eEvents.map((e) => JSON.parse(e.content).description);
    for (const desc of descriptions) {
      expect(foundDescriptions).toContain(desc);
    }
  });
});
