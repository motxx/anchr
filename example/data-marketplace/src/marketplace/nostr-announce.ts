// NIP-33 parameterized replaceable event (kind 38421), Routstr-compatible.

import { Buffer } from "node:buffer";
import { finalizeEvent, type EventTemplate, type VerifiedEvent } from "nostr-tools/pure";
import { publishEvent } from "@anchr/bounty/nostr-transport";
import { getCashuConfig } from "@anchr/core-cashu/wallet";
import { ANCHR_MARKETPLACE_LISTING } from "@anchr/bounty/nostr-events";
import type { DataListing } from "./types.ts";

async function getIdentityKey(): Promise<Uint8Array | null> {
  const hexKey = Deno.env.get("NOSTR_PRIVATE_KEY")?.trim();
  if (!hexKey) return null;
  return Uint8Array.from(Buffer.from(hexKey, "hex"));
}

export function buildListingAnnouncementEvent(
  listing: DataListing,
  secretKey: Uint8Array,
): VerifiedEvent {
  const config = getCashuConfig();
  const mintUrl = config?.mintUrl ?? "";

  const tags: string[][] = [
    ["d", listing.id],
    ["name", listing.name],
    ["u", listing.source_url],
    ["price", String(listing.price_sats), "sat"],
    ["htlc_price", String(listing.htlc_price_sats), "sat"],
    ["mint", mintUrl],
    ["proof", "tlsnotary"],
    ["t", "anchr-marketplace"],
  ];

  if (listing.description) {
    tags.push(["description", listing.description]);
  }

  const template: EventTemplate = {
    kind: ANCHR_MARKETPLACE_LISTING,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify({
      name: listing.name,
      description: listing.description,
      source_url: listing.source_url,
      price_sats: listing.price_sats,
      htlc_price_sats: listing.htlc_price_sats,
      max_age_seconds: listing.max_age_seconds,
      tlsn_requirement: listing.tlsn_requirement,
    }),
  };

  return finalizeEvent(template, secretKey);
}

export async function announceListingOnNostr(
  listing: DataListing,
  relayUrls?: string[],
): Promise<{ successes: string[]; failures: string[] }> {
  const secretKey = await getIdentityKey();
  if (!secretKey) {
    return { successes: [], failures: ["Nostr private key not configured"] };
  }

  const event = buildListingAnnouncementEvent(listing, secretKey);
  return publishEvent(event, relayUrls);
}
