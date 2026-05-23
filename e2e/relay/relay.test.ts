/**
 * E2E tests against a local Nostr relay (docker-compose).
 *
 * Prerequisites:
 *   docker compose up -d
 *
 * Run:
 *   NOSTR_RELAYS=ws://localhost:7777 deno test e2e/relay.test.ts --allow-all
 */

import { afterAll, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { SimplePool } from "nostr-tools/pool";
import type { Filter } from "nostr-tools/filter";
import type { Event } from "nostr-tools/core";
import { createQueryService } from "../../packages/sdk/src/requests/application/query-service.ts";
import { createOracleRegistry } from "@anchr/sdk/adapters/oracle-client";
import { publishQueryToRelay } from "@anchr/sdk/adapters/nostr";
import { closePool } from "@anchr/sdk/adapters/nostr";
import { ANCHR_QUERY_REQUEST } from "@anchr/sdk/adapters/nostr";
import { isRelayReachable } from "../helpers/regtest.ts";
import process from "node:process";

const NOSTR_RELAYS_ENV = process.env.NOSTR_RELAYS?.trim();
const RELAY_URL = NOSTR_RELAYS_ENV?.split(",")[0]?.trim() ??
  "ws://localhost:7777";
const REQUIRE_INFRA = process.env.ANCHR_E2E_REQUIRE_INFRA === "1";
const RELAY_CLOSE_GRACE_MS = 250;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRelayEvent(
  relayUrl: string,
  filter: Filter,
  timeoutMs = 5000,
): Promise<Event[]> {
  const pool = new SimplePool();
  const events: Event[] = [];
  let sub: { close: () => void } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await new Promise<Event[]>((resolve) => {
      const finish = () => resolve(events);
      timer = setTimeout(finish, timeoutMs);
      sub = pool.subscribeMany([relayUrl], filter, {
        onevent(event) {
          events.push(event);
        },
        oneose() {
          finish();
        },
      });
    });
  } finally {
    if (timer) clearTimeout(timer);
    sub?.close();
    pool.close([relayUrl]);
    await delay(RELAY_CLOSE_GRACE_MS);
  }
}

// --- Infrastructure readiness (top-level await for describe.ignore) ---

// Both conditions required: NOSTR_RELAYS env var must be set (so the worker API
// knows where to publish) AND the relay must be reachable.
const RELAY_REACHABLE = NOSTR_RELAYS_ENV
  ? await isRelayReachable(RELAY_URL)
  : false;

if (!NOSTR_RELAYS_ENV) {
  console.warn(
    `[e2e] NOSTR_RELAYS not set – relay tests skipped. Run: NOSTR_RELAYS=ws://localhost:7777 deno task test:e2e:relay`,
  );
} else if (!RELAY_REACHABLE) {
  console.warn(
    `[e2e] Relay not reachable at ${RELAY_URL} – tests will be skipped. Run: docker compose up -d`,
  );
}
if (REQUIRE_INFRA && !RELAY_REACHABLE) {
  throw new Error("Nostr relay e2e infrastructure is required but not ready");
}

const suite = RELAY_REACHABLE ? describe : describe.ignore;

// Relay tests need actual relay hooks (fire-and-forget WebSocket publishes);
// closePool() in afterAll keeps Deno's leak sanitizers active.
const relayService = createQueryService({
  oracleRegistry: createOracleRegistry(),
  hooks: { onCreated: publishQueryToRelay },
});

suite("e2e: full query lifecycle with Nostr relay", () => {
  afterAll(async () => {
    relayService.clearQueryStore();
    closePool();
    await delay(RELAY_CLOSE_GRACE_MS);
  });

  test("relay is reachable", () => {
    expect(RELAY_REACHABLE).toBe(true);
  });

  test("create query and verify relay publication", async () => {
    const query = relayService.createQuery(
      {
        description: "E2E Ramen Shop の営業状況",
        location_hint: "Shibuya",
      },
      { ttlSeconds: 120 },
    );
    expect(query.id).toMatch(/^query_/);
    expect(query.description).toBe("E2E Ramen Shop の営業状況");
    expect(query.status).toBe("pending");

    // Wait for fire-and-forget relay publish to complete
    await new Promise((r) => setTimeout(r, 1500));

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
      } catch {
        return false;
      }
    });

    expect(matchingEvent).toBeDefined();
    expect(matchingEvent!.kind).toBe(ANCHR_QUERY_REQUEST);

    // Verify event tags
    const tags = matchingEvent!.tags;
    expect(tags.some((t) => t[0] === "t" && t[1] === "anchr")).toBe(true);
    expect(
      tags.some((t) => t[0] === "i" && t[1] === "E2E Ramen Shop の営業状況"),
    ).toBe(true);
  });

  test("full lifecycle: create → list → submit → verify status", async () => {
    const query = relayService.createQuery(
      {
        description: "E2E Lifecycle Store の営業状況",
        location_hint: "Akihabara",
        verification_requirements: [],
      },
      { ttlSeconds: 300 },
    );

    // 2. List queries – should include our query
    const listed = relayService.listOpenQueries();
    expect(listed.some((q) => q.id === query.id)).toBe(true);

    // 3. Get query detail
    const detail = relayService.getQuery(query.id)!;
    expect(detail.status).toBe("pending");
    expect(detail.challenge_nonce).toBe(query.challenge_nonce);

    // 4. Submit result
    const submitOutcome = await relayService.submitQueryResult(
      query.id,
      {
        attachments: [],
        notes: `E2E test observation${
          query.challenge_nonce ? ` ${query.challenge_nonce}` : ""
        }`,
      },
      { executor_type: "human", channel: "adapter" },
    );
    expect(submitOutcome.ok).toBe(true);
    expect(submitOutcome.query?.payment_status).toBe("released");
    expect(submitOutcome.query?.verification?.passed).toBe(true);

    // 5. Verify status is approved
    const statusQuery = relayService.getQuery(query.id)!;
    expect(statusQuery.status).toBe("approved");
    expect(statusQuery.payment_status).toBe("released");
  });

  test("cancel query flow", async () => {
    const query = relayService.createQuery(
      { description: "E2E Cancel Store" },
      { ttlSeconds: 120 },
    );

    const cancelOutcome = relayService.cancelQuery(query.id);
    expect(cancelOutcome.ok).toBe(true);

    // Verify no longer in open list
    const listed = relayService.listOpenQueries();
    expect(listed.some((q) => q.id === query.id)).toBe(false);
  });

  test("multiple queries appear on relay", async () => {
    const since = Math.floor(Date.now() / 1000) - 5;

    // Create 3 queries in parallel
    const descriptions = [
      "E2E Alpha の確認",
      "E2E Bravo の確認",
      "E2E Charlie の確認",
    ];
    for (const desc of descriptions) {
      relayService.createQuery({ description: desc }, { ttlSeconds: 120 });
    }

    // Wait for relay publish
    await new Promise((r) => setTimeout(r, 2000));

    const events = await waitForRelayEvent(RELAY_URL, {
      kinds: [ANCHR_QUERY_REQUEST],
      "#t": ["anchr"],
      since,
    });

    const e2eEvents = events.filter((e) => {
      try {
        const p = JSON.parse(e.content);
        return typeof p.description === "string" &&
          p.description.startsWith("E2E ");
      } catch {
        return false;
      }
    });

    // At least our 3 should be there
    const foundDescriptions = e2eEvents.map((e) =>
      JSON.parse(e.content).description
    );
    for (const desc of descriptions) {
      expect(foundDescriptions).toContain(desc);
    }
  });
});
