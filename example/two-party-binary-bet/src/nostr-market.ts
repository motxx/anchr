/**
 * Nostr integration for two-party binary bet discovery
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
 *   Filter by kind=30078 + #t=anchr-two-party-binary-bet
 *   Category filtering via #t=anchr-pm-{category}
 */

import {
  type EventTemplate,
  finalizeEvent,
  type VerifiedEvent,
} from "nostr-tools/pure";
import type {
  BetEventContent,
  MarketEventContent,
  MarketResolution,
  ResolutionEventContent,
  TwoPartyBinaryBet,
} from "./market-types.ts";

// --- Constants ---

/** Nostr event kind for two-party binary bets (NIP-78: arbitrary custom app data). */
const MARKET_EVENT_KIND = 30078;

/** Standard Nostr relays for market discovery. */
export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

const RELAY_CLOSE_GRACE_MS = 250;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Identity ---

export interface MarketIdentity {
  /** Nostr secret key (32 bytes). */
  secretKey: Uint8Array;
  /** Nostr public key (hex). */
  pubkey: string;
}

// --- Publish market ---

/**
 * Build a Nostr event for publishing a new two-party binary bet.
 *
 * The event uses kind 30078 (parametrized replaceable) so the creator
 * can update the market status later. The "d" tag contains the market ID.
 *
 * Tags:
 *   d           — Market ID (for replacement)
 *   t           — "anchr-two-party-binary-bet" (for discovery)
 *   t           — "anchr-pm-{category}" (for category filtering)
 *   p           — Oracle pubkey
 *   expiration  — Resolution deadline (NIP-40)
 *   htlc_hash_yes — HTLC hash for YES redemption
 *   htlc_hash_no  — HTLC hash for NO redemption
 */
export function buildMarketEvent(
  identity: MarketIdentity,
  market: TwoPartyBinaryBet,
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
    htlc_hash_yes: market.htlc_hash_yes,
    htlc_hash_no: market.htlc_hash_no,
    group_pubkey_yes: market.group_pubkey_yes,
    group_pubkey_no: market.group_pubkey_no,
  };

  const tags: string[][] = [
    ["d", market.id],
    ["t", "anchr-two-party-binary-bet"],
    ["t", `anchr-pm-${market.category}`],
    ["p", market.oracle_pubkey, "", "oracle"],
    ["expiration", String(market.resolution_deadline)],
    ["htlc_hash_yes", market.htlc_hash_yes],
    ["htlc_hash_no", market.htlc_hash_no],
    ["title", market.title],
  ];

  // Include FROST group pubkeys when available
  if (market.group_pubkey_yes) {
    tags.push(["group_pubkey_yes", market.group_pubkey_yes]);
  }
  if (market.group_pubkey_no) {
    tags.push(["group_pubkey_no", market.group_pubkey_no]);
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
 * Publish a two-party binary bet to Nostr relays.
 *
 * @returns The Nostr event ID
 */
export async function publishMarket(
  market: TwoPartyBinaryBet,
  identity: MarketIdentity,
  relayUrls: string[] = DEFAULT_RELAYS,
): Promise<string> {
  const event = buildMarketEvent(identity, market);

  // Publish to each relay
  const publishPromises = relayUrls.map(async (url) => {
    let ws: WebSocket | null = null;
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    let okTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      ws = new WebSocket(url);
      const socket = ws;
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => {
          socket.send(JSON.stringify(["EVENT", event]));
          resolve();
        };
        socket.onerror = (e) => reject(e);
        openTimer = setTimeout(
          () => reject(new Error("WebSocket timeout")),
          5000,
        );
      });
      if (openTimer) clearTimeout(openTimer);
      // Wait for OK response
      await new Promise<void>((resolve) => {
        socket.onmessage = (msg) => {
          const data = JSON.parse(msg.data);
          if (data[0] === "OK" && data[1] === event.id) {
            resolve();
          }
        };
        okTimer = setTimeout(resolve, 3000);
      });
      console.log(`  Published to ${url}`);
    } catch (err) {
      console.warn(`  Failed to publish to ${url}: ${err}`);
    } finally {
      if (openTimer) clearTimeout(openTimer);
      if (okTimer) clearTimeout(okTimer);
      ws?.close();
      await delay(RELAY_CLOSE_GRACE_MS);
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
          "#t": ["anchr-binary-bet"],
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
      ["t", "anchr-binary-bet"],
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
  market: TwoPartyBinaryBet,
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
    ["t", "anchr-two-party-binary-bet"],
    ["t", "anchr-binary-resolution"],
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
  market: TwoPartyBinaryBet,
  resolution: MarketResolution,
  identity: MarketIdentity,
  relayUrls: string[] = DEFAULT_RELAYS,
): Promise<string> {
  const event = buildResolutionEvent(identity, market, resolution);

  const publishPromises = relayUrls.map(async (url) => {
    let ws: WebSocket | null = null;
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    let okTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      ws = new WebSocket(url);
      const socket = ws;
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => {
          socket.send(JSON.stringify(["EVENT", event]));
          resolve();
        };
        socket.onerror = (e) => reject(e);
        openTimer = setTimeout(
          () => reject(new Error("WebSocket timeout")),
          5000,
        );
      });
      if (openTimer) clearTimeout(openTimer);
      await new Promise<void>((resolve) => {
        socket.onmessage = (msg) => {
          const data = JSON.parse(msg.data);
          if (data[0] === "OK" && data[1] === event.id) {
            resolve();
          }
        };
        okTimer = setTimeout(resolve, 3000);
      });
      console.log(`  Resolution published to ${url}`);
    } catch (err) {
      console.warn(`  Failed to publish to ${url}: ${err}`);
    } finally {
      if (openTimer) clearTimeout(openTimer);
      if (okTimer) clearTimeout(okTimer);
      ws?.close();
      await delay(RELAY_CLOSE_GRACE_MS);
    }
  });

  await Promise.allSettled(publishPromises);
  return event.id;
}

// --- Discovery ---

/**
 * Fetch open two-party binary bets from Nostr relays.
 *
 * @param category Optional category filter
 * @returns Array of market event contents
 */
export async function discoverMarkets(
  relayUrls: string[] = DEFAULT_RELAYS,
  category?: string,
): Promise<
  Array<{ eventId: string; pubkey: string; content: MarketEventContent }>
> {
  const markets: Array<{
    eventId: string;
    pubkey: string;
    content: MarketEventContent;
  }> = [];

  const tags = ["anchr-two-party-binary-bet"];
  if (category) {
    tags.push(`anchr-pm-${category}`);
  }

  for (const url of relayUrls) {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      ws = new WebSocket(url);
      const socket = ws;

      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => {
          const filter = {
            kinds: [MARKET_EVENT_KIND],
            "#t": tags,
            limit: 50,
          };
          socket.send(JSON.stringify(["REQ", "discover", filter]));
        };
        socket.onerror = () => reject();

        socket.onmessage = (msg) => {
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

        timer = setTimeout(resolve, 5000);
      });

      break;
    } catch {
      continue;
    } finally {
      if (timer) clearTimeout(timer);
      ws?.close();
      await delay(RELAY_CLOSE_GRACE_MS);
    }
  }

  return markets;
}
