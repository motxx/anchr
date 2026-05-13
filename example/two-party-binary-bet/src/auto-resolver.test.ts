/**
 * Auto-resolver unit tests — drive `tick()` directly so we don't depend
 * on real timers. Each test injects a mock fetcher + clock so the
 * scheduler is fully deterministic.
 */
import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { startAutoResolver } from "./auto-resolver.ts";
import { createMarketState } from "./server-routes.ts";
import type { TwoPartyBinaryBet } from "./market-types.ts";

function makeMarket(
  overrides: Partial<TwoPartyBinaryBet> = {},
): TwoPartyBinaryBet {
  return {
    id: "mkt_test",
    title: "Will it work?",
    description: "",
    category: "custom",
    creator_pubkey: "creator",
    resolution_url: "https://truth.example/api",
    resolution_condition: {
      type: "contains_text",
      target_url: "https://truth.example/api",
      expected_text: "YES",
      description: "body contains YES",
    },
    resolution_deadline: 1000, // unix seconds
    yes_pool_sats: 0,
    no_pool_sats: 0,
    min_bet_sats: 1,
    max_bet_sats: 0,
    fee_ppm: 0,
    oracle_pubkey: "oracle",
    htlc_hash_yes: "a".repeat(64),
    htlc_hash_no: "b".repeat(64),
    nostr_event_id: "",
    status: "open",
    ...overrides,
  };
}

describe("auto-resolver", () => {
  test("settles a market past its deadline with the evaluated outcome", async () => {
    const state = createMarketState();
    // Seed a real preimage pair so settleMarket's HTLC fallback path can complete.
    const hashes = state.dualPreimageStore.create("mkt_test");
    state.dualKeyStore.create("mkt_test");
    state.markets.set(
      "mkt_test",
      makeMarket({ htlc_hash_yes: hashes.hash_a, htlc_hash_no: hashes.hash_b }),
    );

    const fetched: string[] = [];
    const handle = startAutoResolver(state, {
      pollIntervalMs: 60_000,
      runImmediately: false,
      now: () => 2_000_000, // deadline is 1000 unix s; we're way past it
      fetchTruthSource: async (url) => {
        fetched.push(url);
        return "the price moved up — YES";
      },
      log: () => {},
    });
    // Force a deterministic pass instead of waiting for the implicit kickoff.
    await handle.tick();
    handle.stop();

    expect(fetched).toEqual(["https://truth.example/api"]);
    const settled = state.markets.get("mkt_test");
    expect(settled?.status).toBe("resolved_yes");
  });

  test("settles NO when the body fails the condition", async () => {
    const state = createMarketState();
    state.dualPreimageStore.create("mkt_no");
    state.dualKeyStore.create("mkt_no");
    state.markets.set(
      "mkt_no",
      makeMarket({
        id: "mkt_no",
        resolution_condition: {
          type: "contains_text",
          target_url: "https://truth.example/api",
          expected_text: "OUTAGE",
          description: "body contains OUTAGE",
        },
      }),
    );

    const handle = startAutoResolver(state, {
      pollIntervalMs: 60_000,
      runImmediately: false,
      now: () => 2_000_000,
      fetchTruthSource: async () => "all systems nominal",
      log: () => {},
    });
    await handle.tick();
    handle.stop();

    expect(state.markets.get("mkt_no")?.status).toBe("resolved_no");
  });

  test("does NOT settle markets still in their resolution window", async () => {
    const state = createMarketState();
    state.markets.set(
      "mkt_open",
      makeMarket({ id: "mkt_open", resolution_deadline: 9_999_999_999 }),
    );

    let fetchedCount = 0;
    const handle = startAutoResolver(state, {
      pollIntervalMs: 60_000,
      runImmediately: false,
      now: () => 1_000_000, // before the deadline
      fetchTruthSource: async () => {
        fetchedCount++;
        return "YES";
      },
      log: () => {},
    });
    await handle.tick();
    handle.stop();

    expect(fetchedCount).toBe(0);
    expect(state.markets.get("mkt_open")?.status).toBe("open");
  });

  test("does NOT re-settle an already-resolved market", async () => {
    const state = createMarketState();
    state.markets.set(
      "mkt_done",
      makeMarket({ id: "mkt_done", status: "resolved_yes" }),
    );

    let fetchedCount = 0;
    const handle = startAutoResolver(state, {
      pollIntervalMs: 60_000,
      runImmediately: false,
      now: () => 2_000_000,
      fetchTruthSource: async () => {
        fetchedCount++;
        return "YES";
      },
      log: () => {},
    });
    await handle.tick();
    handle.stop();

    expect(fetchedCount).toBe(0);
    expect(state.markets.get("mkt_done")?.status).toBe("resolved_yes");
  });

  test("survives a fetch error and leaves the market open for retry", async () => {
    const state = createMarketState();
    state.dualPreimageStore.create("mkt_flaky");
    state.dualKeyStore.create("mkt_flaky");
    state.markets.set("mkt_flaky", makeMarket({ id: "mkt_flaky" }));

    const logged: Array<{ level: string; msg: string }> = [];
    const handle = startAutoResolver(state, {
      pollIntervalMs: 60_000,
      runImmediately: false,
      now: () => 2_000_000,
      fetchTruthSource: async () => {
        throw new Error("ENETUNREACH");
      },
      log: (level, msg) => logged.push({ level, msg }),
    });
    await handle.tick();
    handle.stop();

    expect(state.markets.get("mkt_flaky")?.status).toBe("open");
    expect(
      logged.some((l) => l.level === "warn" && l.msg.includes("fetch failed")),
    ).toBe(true);
  });

  test("survives a condition-evaluation error and leaves the market open", async () => {
    const state = createMarketState();
    state.dualPreimageStore.create("mkt_badcond");
    state.dualKeyStore.create("mkt_badcond");
    state.markets.set(
      "mkt_badcond",
      makeMarket({
        id: "mkt_badcond",
        resolution_condition: {
          type: "jsonpath_gt",
          target_url: "https://truth.example/api",
          jsonpath: "data.value",
          threshold: 100,
          description: "value > 100",
        },
      }),
    );

    const logged: Array<{ level: string; msg: string }> = [];
    const handle = startAutoResolver(state, {
      pollIntervalMs: 60_000,
      runImmediately: false,
      now: () => 2_000_000,
      fetchTruthSource: async () => "this is not JSON",
      log: (level, msg) => logged.push({ level, msg }),
    });
    await handle.tick();
    handle.stop();

    expect(state.markets.get("mkt_badcond")?.status).toBe("open");
    expect(
      logged.some((l) =>
        l.level === "warn" && l.msg.includes("condition evaluation failed")
      ),
    ).toBe(true);
  });
});
