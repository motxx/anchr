/**
 * E2E tests for Prediction Market Nostr integration.
 *
 * Verifies the full lifecycle: publish market, discover, place bets,
 * resolve, and category filtering — all against a real Nostr relay.
 *
 * Prerequisites:
 *   docker compose up -d          (provides relay at ws://localhost:7777)
 *
 * Run:
 *   NOSTR_RELAYS=ws://localhost:7777 deno test e2e/prediction-market-nostr.test.ts --allow-all
 */

import { describe, test, beforeAll } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { SimplePool } from "nostr-tools/pool";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  buildMarketEvent,
  buildBetEvent,
  buildResolutionEvent,
  publishMarket,
  discoverMarkets,
  type MarketIdentity,
} from "../example/prediction-market/src/nostr-market.ts";
import { createMarketHtlc } from "../example/prediction-market/src/market-oracle.ts";
import type {
  PredictionMarket,
  MarketResolution,
  BetEventContent,
} from "../example/prediction-market/src/market-types.ts";

// ---------------------------------------------------------------------------
// Relay connectivity
// ---------------------------------------------------------------------------

const NOSTR_RELAYS_ENV = Deno.env.get("NOSTR_RELAYS")?.trim();
const RELAY_URL =
  NOSTR_RELAYS_ENV?.split(",")[0]?.trim() ?? "ws://localhost:7777";

async function isRelayReachable(): Promise<boolean> {
  try {
    const ws = new WebSocket(RELAY_URL);
    return await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        ws.close();
        resolve(false);
      }, 2000);
      ws.onopen = () => {
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };
    });
  } catch {
    return false;
  }
}

const RELAY_REACHABLE = NOSTR_RELAYS_ENV ? await isRelayReachable() : false;

if (!NOSTR_RELAYS_ENV) {
  console.warn(
    `[e2e] NOSTR_RELAYS not set – prediction market tests skipped. Run: NOSTR_RELAYS=ws://localhost:7777 deno task test:e2e`,
  );
} else if (!RELAY_REACHABLE) {
  console.warn(
    `[e2e] Relay not reachable at ${RELAY_URL} – prediction market tests skipped. Run: docker compose up -d`,
  );
}

const suite = RELAY_REACHABLE ? describe : describe.ignore;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a MarketIdentity from nostr-tools key generation. */
function createIdentity(): MarketIdentity {
  const sk = generateSecretKey();
  return {
    secretKey: sk,
    pubkey: getPublicKey(sk),
  };
}

/** Publish a signed event to the relay via SimplePool. */
async function publishEventToRelay(
  event: ReturnType<typeof buildMarketEvent>,
): Promise<void> {
  const pool = new SimplePool();
  try {
    await Promise.allSettled(pool.publish([RELAY_URL], event));
    // Allow the relay to index the event before querying.
    await new Promise((r) => setTimeout(r, 500));
  } finally {
    pool.close([RELAY_URL]);
  }
}

/** Build a full PredictionMarket object for testing. */
function buildTestMarket(
  overrides: Partial<PredictionMarket> & {
    id: string;
    htlc_hash_yes: string;
    htlc_hash_no: string;
    oracle_pubkey: string;
    creator_pubkey: string;
  },
): PredictionMarket {
  return {
    title: "E2E Test: Will BTC hit $200K?",
    description: "Test market for E2E prediction market Nostr integration.",
    category: "crypto",
    resolution_url: "https://api.example.com/price",
    resolution_condition: {
      type: "price_above",
      target_url: "https://api.example.com/price",
      jsonpath: "price",
      threshold: 200_000,
      description: "BTC price above $200K",
    },
    resolution_deadline: Math.floor(Date.now() / 1000) + 86400, // 24h ahead
    yes_pool_sats: 0,
    no_pool_sats: 0,
    min_bet_sats: 1,
    max_bet_sats: 1_000_000,
    fee_ppm: 10_000,
    nostr_event_id: "",
    status: "open",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite(
  {
    name: "e2e: Prediction Market Nostr integration",
    sanitizeOps: false,
    sanitizeResources: false,
  },
  () => {
    const creatorIdentity = createIdentity();
    const oracleIdentity = createIdentity();
    const bettorIdentity = createIdentity();

    // Shared state across tests
    let marketEventId: string;
    let testMarket: PredictionMarket;
    let htlcYes: ReturnType<typeof createMarketHtlc>;
    let htlcNo: ReturnType<typeof createMarketHtlc>;

    beforeAll(() => {
      htlcYes = createMarketHtlc();
      htlcNo = createMarketHtlc();
    });

    test("relay is reachable", () => {
      expect(RELAY_REACHABLE).toBe(true);
    });

    // ----- Test 1: Build and publish a market event -----

    test("build and publish a market event (kind 30078)", async () => {
      const marketId = `e2e-market-${Date.now()}`;

      testMarket = buildTestMarket({
        id: marketId,
        title: "E2E: Will BTC hit $200K by 2027?",
        description: "E2E integration test market",
        category: "crypto",
        htlc_hash_yes: htlcYes.hash,
        htlc_hash_no: htlcNo.hash,
        oracle_pubkey: oracleIdentity.pubkey,
        creator_pubkey: creatorIdentity.pubkey,
      });

      const event = buildMarketEvent(creatorIdentity, testMarket);

      // Verify event structure before publishing
      expect(event.kind).toBe(30078);
      expect(event.pubkey).toBe(creatorIdentity.pubkey);

      const content = JSON.parse(event.content);
      expect(content.title).toBe("E2E: Will BTC hit $200K by 2027?");
      expect(content.htlc_hash_yes).toBe(htlcYes.hash);
      expect(content.htlc_hash_no).toBe(htlcNo.hash);
      expect(content.oracle_pubkey).toBe(oracleIdentity.pubkey);

      // Verify tags
      const tags = event.tags;
      expect(tags.some((t) => t[0] === "d" && t[1] === marketId)).toBe(true);
      expect(
        tags.some(
          (t) => t[0] === "t" && t[1] === "anchr-prediction-market",
        ),
      ).toBe(true);
      expect(
        tags.some((t) => t[0] === "t" && t[1] === "anchr-pm-crypto"),
      ).toBe(true);
      expect(
        tags.some((t) => t[0] === "p" && t[1] === oracleIdentity.pubkey),
      ).toBe(true);
      expect(
        tags.some((t) => t[0] === "htlc_hash_yes" && t[1] === htlcYes.hash),
      ).toBe(true);
      expect(
        tags.some((t) => t[0] === "htlc_hash_no" && t[1] === htlcNo.hash),
      ).toBe(true);

      // Publish to relay
      await publishEventToRelay(event);
      marketEventId = event.id;

      // Update testMarket with the event ID for later tests
      testMarket.nostr_event_id = marketEventId;
    });

    // ----- Test 2: Discover the market via discoverMarkets() -----

    test("discover market via discoverMarkets()", async () => {
      const markets = await discoverMarkets([RELAY_URL]);

      const found = markets.find((m) => m.eventId === marketEventId);
      expect(found).toBeDefined();
      expect(found!.pubkey).toBe(creatorIdentity.pubkey);
      expect(found!.content.title).toBe("E2E: Will BTC hit $200K by 2027?");
      expect(found!.content.htlc_hash_yes).toBe(htlcYes.hash);
      expect(found!.content.htlc_hash_no).toBe(htlcNo.hash);
      expect(found!.content.category).toBe("crypto");
      expect(found!.content.oracle_pubkey).toBe(oracleIdentity.pubkey);
    });

    // ----- Test 3: Build and publish a bet event -----

    test("build and publish a bet event referencing the market", async () => {
      const betContent: BetEventContent = {
        market_id: testMarket.id,
        side: "yes",
        amount_sats: 5000,
        escrow_token: "cashu_token_placeholder",
      };

      const betEvent = buildBetEvent(
        bettorIdentity,
        marketEventId,
        betContent,
      );

      // Verify bet event structure
      expect(betEvent.kind).toBe(1);
      expect(betEvent.pubkey).toBe(bettorIdentity.pubkey);

      // Verify the bet references the market event via "e" tag
      const eTag = betEvent.tags.find((t) => t[0] === "e");
      expect(eTag).toBeDefined();
      expect(eTag![1]).toBe(marketEventId);

      // Verify the bet is tagged for discovery
      expect(
        betEvent.tags.some(
          (t) => t[0] === "t" && t[1] === "anchr-prediction-bet",
        ),
      ).toBe(true);
      expect(
        betEvent.tags.some(
          (t) => t[0] === "t" && t[1] === "anchr-pm-bet-yes",
        ),
      ).toBe(true);

      // Verify bet content
      const parsedContent = JSON.parse(betEvent.content);
      expect(parsedContent.market_id).toBe(testMarket.id);
      expect(parsedContent.side).toBe("yes");
      expect(parsedContent.amount_sats).toBe(5000);

      // Publish to relay
      await publishEventToRelay(betEvent);
    });

    // ----- Test 4: Build and publish a resolution event -----

    test("build and publish a resolution event with outcome and preimage", async () => {
      const resolution: MarketResolution = {
        market_id: testMarket.id,
        outcome: "yes",
        tlsn_proof: btoa("mock-tlsn-proof-bytes"),
        verified_data: {
          server_name: "api.example.com",
          revealed_body: JSON.stringify({ price: 250_000 }),
          timestamp: Math.floor(Date.now() / 1000),
        },
        preimage: htlcYes.preimage,
      };

      const resolutionEvent = buildResolutionEvent(
        oracleIdentity,
        testMarket,
        resolution,
      );

      // Verify resolution event structure
      expect(resolutionEvent.kind).toBe(30078);
      expect(resolutionEvent.pubkey).toBe(oracleIdentity.pubkey);

      // Verify resolution tags
      const tags = resolutionEvent.tags;
      expect(tags.some((t) => t[0] === "d" && t[1] === testMarket.id)).toBe(
        true,
      );
      expect(
        tags.some(
          (t) => t[0] === "t" && t[1] === "anchr-prediction-resolution",
        ),
      ).toBe(true);
      expect(
        tags.some(
          (t) => t[0] === "t" && t[1] === "anchr-pm-resolved-yes",
        ),
      ).toBe(true);
      expect(
        tags.some((t) => t[0] === "outcome" && t[1] === "yes"),
      ).toBe(true);
      expect(
        tags.some(
          (t) => t[0] === "preimage" && t[1] === htlcYes.preimage,
        ),
      ).toBe(true);
      expect(
        tags.some((t) => t[0] === "e" && t[1] === marketEventId),
      ).toBe(true);
      expect(
        tags.some(
          (t) => t[0] === "p" && t[1] === creatorIdentity.pubkey,
        ),
      ).toBe(true);

      // Verify resolution content
      const content = JSON.parse(resolutionEvent.content);
      expect(content.outcome).toBe("yes");
      expect(content.preimage).toBe(htlcYes.preimage);
      expect(content.market_id).toBe(testMarket.id);
      expect(content.verified_data.server_name).toBe("api.example.com");

      // Publish to relay
      await publishEventToRelay(resolutionEvent);
    });

    // ----- Test 5: Category filtering -----

    test("category filtering: discover markets by category", async () => {
      const suffix = Date.now();

      // Create markets in different categories
      const cryptoMarket = buildTestMarket({
        id: `e2e-crypto-${suffix}`,
        title: `E2E Crypto Market ${suffix}`,
        category: "crypto",
        htlc_hash_yes: createMarketHtlc().hash,
        htlc_hash_no: createMarketHtlc().hash,
        oracle_pubkey: oracleIdentity.pubkey,
        creator_pubkey: creatorIdentity.pubkey,
      });

      const sportsMarket = buildTestMarket({
        id: `e2e-sports-${suffix}`,
        title: `E2E Sports Market ${suffix}`,
        category: "sports",
        htlc_hash_yes: createMarketHtlc().hash,
        htlc_hash_no: createMarketHtlc().hash,
        oracle_pubkey: oracleIdentity.pubkey,
        creator_pubkey: creatorIdentity.pubkey,
      });

      const politicsMarket = buildTestMarket({
        id: `e2e-politics-${suffix}`,
        title: `E2E Politics Market ${suffix}`,
        category: "politics",
        htlc_hash_yes: createMarketHtlc().hash,
        htlc_hash_no: createMarketHtlc().hash,
        oracle_pubkey: oracleIdentity.pubkey,
        creator_pubkey: creatorIdentity.pubkey,
      });

      // Publish all three
      const cryptoEvent = buildMarketEvent(creatorIdentity, cryptoMarket);
      const sportsEvent = buildMarketEvent(creatorIdentity, sportsMarket);
      const politicsEvent = buildMarketEvent(creatorIdentity, politicsMarket);

      await publishEventToRelay(cryptoEvent);
      await publishEventToRelay(sportsEvent);
      await publishEventToRelay(politicsEvent);

      // NIP-01: #t with multiple values uses OR semantics, so passing
      // ["anchr-prediction-market", "anchr-pm-crypto"] returns all events
      // that have EITHER tag. Since all prediction market events carry the
      // base "anchr-prediction-market" tag, the relay returns a superset.
      //
      // Verify that discoverMarkets with a category filter returns results
      // that include the matching category, and that the content.category
      // field is correct for client-side filtering.

      // Discover with crypto filter -- crypto market must be present
      const cryptoResults = await discoverMarkets([RELAY_URL], "crypto");
      const foundCrypto = cryptoResults.find(
        (m) => m.eventId === cryptoEvent.id,
      );
      expect(foundCrypto).toBeDefined();
      expect(foundCrypto!.content.title).toBe(`E2E Crypto Market ${suffix}`);
      expect(foundCrypto!.content.category).toBe("crypto");

      // Discover with sports filter -- sports market must be present
      const sportsResults = await discoverMarkets([RELAY_URL], "sports");
      const foundSports = sportsResults.find(
        (m) => m.eventId === sportsEvent.id,
      );
      expect(foundSports).toBeDefined();
      expect(foundSports!.content.title).toBe(`E2E Sports Market ${suffix}`);
      expect(foundSports!.content.category).toBe("sports");

      // Discover with politics filter -- politics market must be present
      const politicsResults = await discoverMarkets([RELAY_URL], "politics");
      const foundPolitics = politicsResults.find(
        (m) => m.eventId === politicsEvent.id,
      );
      expect(foundPolitics).toBeDefined();
      expect(foundPolitics!.content.title).toBe(
        `E2E Politics Market ${suffix}`,
      );
      expect(foundPolitics!.content.category).toBe("politics");

      // Discover without category -- should find all three
      const allResults = await discoverMarkets([RELAY_URL]);
      const allFound = [
        cryptoEvent.id,
        sportsEvent.id,
        politicsEvent.id,
      ].every((id) => allResults.some((m) => m.eventId === id));
      expect(allFound).toBe(true);

      // Client-side category filtering on unfiltered results
      const cryptoOnly = allResults.filter(
        (m) => m.content.category === "crypto",
      );
      const sportsOnly = allResults.filter(
        (m) => m.content.category === "sports",
      );
      const politicsOnly = allResults.filter(
        (m) => m.content.category === "politics",
      );

      expect(
        cryptoOnly.some((m) => m.eventId === cryptoEvent.id),
      ).toBe(true);
      expect(
        cryptoOnly.some((m) => m.eventId === sportsEvent.id),
      ).toBe(false);
      expect(
        sportsOnly.some((m) => m.eventId === sportsEvent.id),
      ).toBe(true);
      expect(
        sportsOnly.some((m) => m.eventId === cryptoEvent.id),
      ).toBe(false);
      expect(
        politicsOnly.some((m) => m.eventId === politicsEvent.id),
      ).toBe(true);
    });
  },
);
