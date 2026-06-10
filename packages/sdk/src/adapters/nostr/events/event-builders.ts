/**
 * Oracle announcement builder (kind 30088, oracle-registry spec).
 */

import {
  type EventTemplate,
  finalizeEvent,
  type VerifiedEvent,
} from "nostr-tools";
import { KIND_ORACLE_ANNOUNCEMENT } from "@anchr/protocol/nostr";
import type { NostrIdentity } from "../../../identity.ts";
import type { OracleInfo } from "../../../requests/domain/oracle-types.ts";

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Build an Oracle Announcement event (kind 30088).
 *
 * Parametrized replaceable event per the oracle-registry spec — Oracles publish their
 * capabilities, fees, and endpoints so Customers can discover them.
 */
export function buildOracleAnnouncementEvent(
  identity: NostrIdentity,
  oracleInfo: OracleInfo,
  relayUrls?: string[],
): VerifiedEvent {
  const tags: string[][] = [
    ["d", oracleInfo.id],
    ["t", "anchr-oracle"],
  ];

  // Add capability tags: anchr-oracle-<factor>
  if (oracleInfo.supported_factors?.length) {
    for (const factor of oracleInfo.supported_factors) {
      tags.push(["t", `anchr-oracle-${factor}`]);
    }
  }

  // Add relay hints
  if (relayUrls?.length) {
    for (const url of relayUrls) {
      tags.push(["relay", url]);
    }
  }

  const content = JSON.stringify({
    name: oracleInfo.name,
    ...(oracleInfo.endpoint !== undefined && { endpoint: oracleInfo.endpoint }),
    fee_ppm: oracleInfo.fee_ppm,
    supported_factors: oracleInfo.supported_factors ?? [],
    supported_escrow_types: oracleInfo.supported_escrow_types ?? [],
    ...(oracleInfo.min_amount_sats !== undefined &&
      { min_amount_sats: oracleInfo.min_amount_sats }),
    ...(oracleInfo.max_amount_sats !== undefined &&
      { max_amount_sats: oracleInfo.max_amount_sats }),
    ...(oracleInfo.description !== undefined &&
      { description: oracleInfo.description }),
  });

  const template: EventTemplate = {
    kind: KIND_ORACLE_ANNOUNCEMENT,
    created_at: nowUnix(),
    tags,
    content,
  };

  return finalizeEvent(template, identity.secretKey);
}
