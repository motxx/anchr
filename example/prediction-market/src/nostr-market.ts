/**
 * Nostr Integration for Prediction Market Discovery
 *
 * Markets are published as Nostr events so anyone can discover and
 * participate without a centralized server. Uses kind 30078
 * (parametrized replaceable event) with a "d" tag for the market ID.
 *
 * Event kinds:
 *   30078  — Market creation (parametrized replaceable, updateable by creator)
 *   1      — Bet placement (regular note referencing the market event)
 *   30078  — Resolution publication (oracle updates the market event)
 *
 * Discovery:
 *   Filter by kind=30078 + #t=anchr-prediction-market
 *   Category filtering via #t=anchr-pm-{category}
 */

import { finalizeEvent, type EventTemplate, type VerifiedEvent } from "nostr-tools/pure";
import type {
  PredictionMarket,
  MarketResolution,
  MarketEventContent,
  BetEventContent,
  ResolutionEventContent,
} from "./market-types.ts";

// --- Constants ---

/** Nostr event kind for prediction markets (NIP-78: arbitrary custom app data). */
const MARKET_EVENT_KIND = 30078;

/** Standard Nostr relays for market discovery. */
export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

// --- Identity ---

export interface MarketIdentity {
  /** Nostr secret key (32 bytes). */
  secretKey: Uint8Array;
  /** Nostr public key (hex). */
  pubkey: string;
}

// --- Publish market ---

/**
 * Build a Nostr event for publishing a new prediction market.
 *
 * The event uses kind 30078 (parametrized replaceable) so the creator
 * can update the market status later. The "d" tag contains the market ID.
 *
 * Tags:
 *   d           — Market ID (for replacement)
 *   t           — "anchr-prediction-market" (for discovery)
 *   t           — "anchr-pm-{category}" (for category filtering)
 *   p           — Oracle pubkey
 *   expiration  — Resolution deadline (NIP-40)
 *   htlc_hash   — HTLC hash for YES redemption
 */
export function buildMarketEvent(
  identity: MarketIdentity,
  market: PredictionMarket,
): VerifiedEvent {
  const content: MarketEventContent = {
    title: market.title,
    description: market.description,
    category: market.category,
    resolution_url: market.resolution_url,
    resolution_condition: market.resolution_condition,
    resolution_deadline: market.resolution_deadline,
    min_bet_sats: market.min_bet_sats,
    max_bet_sats: market.max_bet_sats,
    fee_ppm: market.fee_ppm,
    oracle_pubkey: market.oracle_pubkey,
    htlc_hash: market.htlc_hash,
  };

  const template: EventTemplate = {
    kind: MARKET_EVENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["d", market.id],
      ["t", "anchr-prediction-market"],
      ["t", `anchr-pm-${market.category}`],
      ["p", market.oracle_pubkey, "", "oracle"],
      ["expiration", String(market.resolution_deadline)],
      ["htlc_hash", market.htlc_hash],
      ["title", market.title],
    ],
    content: JSON.stringify(content),
  };

  return finalizeEvent(template, identity.secretKey);
}

/**
 * Publish a prediction market to Nostr relays.
 *
 * @returns The Nostr event ID
 */
export async function publishMarket(
  market: PredictionMarket,
  identity: MarketIdentity,
  relayUrls: string[] = DEFAULT_RELAYS,
): Promise<string> {
  const event = buildMarketEvent(identity, market);

  // Publish to each relay
  const publishPromises = relayUrls.map(async (url) => {
    try {
      const ws = new WebSocket(url);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          ws.send(JSON.stringify(["EVENT", event]));
          resolve();
        };
        ws.onerror = (e) => reject(e);
        setTimeout(() => reject(new Error("WebSocket timeout")), 5000);
      });
      // Wait for OK response
      await new Promise<void>((resolve) => {
        ws.onmessage = (msg) => {
          const data = JSON.parse(msg.data);
          if (data[0] === "OK" && data[1] === event.id) {
            resolve();
          }
        };
        setTimeout(resolve, 3000);
      });
      ws.close();
      console.log(`  Published to ${url}`);
    } catch (err) {
      console.warn(`  Failed to publish to ${url}: ${err}`);
    }
  });

  await Promise.allSettled(publishPromises);
  return event.id;
}

// --- Subscribe to bets ---

/**
 * Subscribe to bet events for a specific market.
 *
 * Bets are kind 1 notes that reference the market event with an "e" tag
 * and contain a structured JSON body with the bet details.
 *
 * @param marketEventId Nostr event ID of the market
 * @param onBet Callback for each new bet
 * @returns Cleanup function to close subscriptions
 */
export function subscribeToBets(
  marketEventId: string,
  onBet: (bet: BetEventContent, eventId: string, pubkey: string) => void,
  relayUrls: string[] = DEFAULT_RELAYS,
): () => void {
  const sockets: WebSocket[] = [];

  for (const url of relayUrls) {
    try {
      const ws = new WebSocket(url);
      sockets.push(ws);

      ws.onopen = () => {
        // Subscribe to kind 1 events that reference this market
        const filter = {
          kinds: [1],
          "#e": [marketEventId],
          "#t": ["anchr-prediction-bet"],
        };
        ws.send(JSON.stringify(["REQ", `bets-${marketEventId}`, filter]));
      };

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          if (data[0] === "EVENT") {
            const event = data[2];
            const betContent = JSON.parse(event.content) as BetEventContent;
            onBet(betContent, event.id, event.pubkey);
          }
        } catch {
          // Skip malformed events
        }
      };
    } catch {
      // Skip unavailable relays
    }
  }

  return () => {
    for (const ws of sockets) {
      try {
        ws.close();
      } catch {
        // Ignore close errors
      }
    }
  };
}

// --- Build bet event ---

/**
 * Build a Nostr event for placing a bet on a market.
 */
export function buildBetEvent(
  identity: MarketIdentity,
  marketEventId: string,
  bet: BetEventContent,
): VerifiedEvent {
  const template: EventTemplate = {
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["e", marketEventId],
      ["t", "anchr-prediction-bet"],
      ["t", `anchr-pm-bet-${bet.side}`],
    ],
    content: JSON.stringify(bet),
  };

  return finalizeEvent(template, identity.secretKey);
}

// --- Publish resolution ---

/**
 * Build a Nostr event for publishing a market resolution.
 *
 * The oracle publishes the resolution as an update to the original
 * market event (same "d" tag, kind 30078). Since this is a parametrized
 * replaceable event, the resolution replaces the original market listing.
 */
export function buildResolutionEvent(
  identity: MarketIdentity,
  market: PredictionMarket,
  resolution: MarketResolution,
): VerifiedEvent {
  const content: ResolutionEventContent = {
    market_id: resolution.market_id,
    outcome: resolution.outcome,
    tlsn_proof: resolution.tlsn_proof,
    verified_data: resolution.verified_data,
    preimage: resolution.preimage,
  };

  const tags: string[][] = [
    ["d", market.id],
    ["t", "anchr-prediction-market"],
    ["t", "anchr-prediction-resolution"],
    ["t", `anchr-pm-resolved-${resolution.outcome}`],
    ["e", market.nostr_event_id],
    ["p", market.creator_pubkey],
    ["outcome", resolution.outcome],
  ];

  if (resolution.preimage) {
    tags.push(["preimage", resolution.preimage]);
  }

  const template: EventTemplate = {
    kind: MARKET_EVENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify(content),
  };

  return finalizeEvent(template, identity.secretKey);
}

/**
 * Publish a market resolution to Nostr relays.
 *
 * @returns The Nostr event ID of the resolution
 */
export async function publishResolution(
  market: PredictionMarket,
  resolution: MarketResolution,
  identity: MarketIdentity,
  relayUrls: string[] = DEFAULT_RELAYS,
): Promise<string> {
  const event = buildResolutionEvent(identity, market, resolution);

  const publishPromises = relayUrls.map(async (url) => {
    try {
      const ws = new WebSocket(url);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          ws.send(JSON.stringify(["EVENT", event]));
          resolve();
        };
        ws.onerror = (e) => reject(e);
        setTimeout(() => reject(new Error("WebSocket timeout")), 5000);
      });
      await new Promise<void>((resolve) => {
        ws.onmessage = (msg) => {
          const data = JSON.parse(msg.data);
          if (data[0] === "OK" && data[1] === event.id) {
            resolve();
          }
        };
        setTimeout(resolve, 3000);
      });
      ws.close();
      console.log(`  Resolution published to ${url}`);
    } catch (err) {
      console.warn(`  Failed to publish to ${url}: ${err}`);
    }
  });

  await Promise.allSettled(publishPromises);
  return event.id;
}

// --- Discovery ---

/**
 * Fetch open prediction markets from Nostr relays.
 *
 * @param category Optional category filter
 * @returns Array of market event contents
 */
export async function discoverMarkets(
  relayUrls: string[] = DEFAULT_RELAYS,
  category?: string,
): Promise<Array<{ eventId: string; pubkey: string; content: MarketEventContent }>> {
  const markets: Array<{
    eventId: string;
    pubkey: string;
    content: MarketEventContent;
  }> = [];

  const tags = ["anchr-prediction-market"];
  if (category) {
    tags.push(`anchr-pm-${category}`);
  }

  for (const url of relayUrls) {
    try {
      const ws = new WebSocket(url);

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          const filter = {
            kinds: [MARKET_EVENT_KIND],
            "#t": tags,
            limit: 50,
          };
          ws.send(JSON.stringify(["REQ", "discover", filter]));
        };
        ws.onerror = () => reject();

        ws.onmessage = (msg) => {
          const data = JSON.parse(msg.data);
          if (data[0] === "EVENT") {
            try {
              const event = data[2];
              const content = JSON.parse(event.content) as MarketEventContent;
              // Only include markets that haven't expired
              if (content.resolution_deadline > Math.floor(Date.now() / 1000)) {
                markets.push({
                  eventId: event.id,
                  pubkey: event.pubkey,
                  content,
                });
              }
            } catch {
              // Skip malformed events
            }
          }
          if (data[0] === "EOSE") {
            resolve();
          }
        };

        setTimeout(resolve, 5000);
      });

      ws.close();
      break; // Only need one relay to succeed
    } catch {
      continue;
    }
  }

  return markets;
}
