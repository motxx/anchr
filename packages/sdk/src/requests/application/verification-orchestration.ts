import { verifyWithQuorum } from "./query-verification.ts";
import type { ServiceDeps } from "./query-service-deps.ts";
import type { PreimageStore, ProofDelivery } from "./ports.ts";
import type { BlossomKeyMap } from "../../values.ts";
import type {
  OracleAttestationRecord,
  PaymentStatus,
  Query,
  QueryResult,
  QueryStatus,
} from "../domain/types.ts";
import { getLogger } from "../../internal/runtime/logger.ts";

const log = getLogger(["anchr", "query-service", "verification"]);

/**
 * Publish attestations to Nostr relays in parallel (best-effort).
 * Awaited so published_proofs IDs can be stored, but failures
 * do not affect the verification outcome.
 */
async function publishAttestations(
  query: Query,
  attestations: OracleAttestationRecord[],
  proofDelivery: ProofDelivery,
): Promise<string[]> {
  if (query.visibility !== "public") return [];

  const results = await Promise.allSettled(
    attestations.map((att) => proofDelivery.publish(query, att, "public")),
  );

  const eventIds: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      eventIds.push(r.value.event_id);
    } else if (r.status === "rejected") {
      log.error("attestation publish failed", { reason: r.reason });
    }
  }
  return eventIds;
}

/** Run oracle verification and build the finalized query record. */
export async function verifyAndFinalize(
  query: Query,
  normalizedResult: QueryResult,
  deps: ServiceDeps,
  blossomKeys: BlossomKeyMap | undefined,
  oracleId: string | undefined,
) {
  const { passed, attestations, verification } = await verifyWithQuorum(
    query,
    normalizedResult,
    deps.oracleResolver,
    deps.multiOracleResolver,
    blossomKeys,
    oracleId,
  );
  const newStatus: QueryStatus = passed ? "approved" : "rejected";
  const paymentStatus: PaymentStatus = passed ? "released" : "cancelled";

  let publishedProofs: string[] | undefined;
  if (
    deps.proofDelivery && query.visibility === "public" &&
    attestations.length > 0
  ) {
    publishedProofs = await publishAttestations(
      query,
      attestations,
      deps.proofDelivery,
    )
      .catch((err) => {
        log.error("failed to publish attestations", { err });
        return undefined;
      });
  }

  const updated: Query = {
    ...query,
    status: newStatus,
    payment_status: paymentStatus,
    verification,
    assigned_oracle_id: attestations[0]?.oracle_id,
    attestations: query.quorum ? attestations : undefined,
    published_proofs: publishedProofs?.length ? publishedProofs : undefined,
  };
  return { passed, attestations, verification, updated };
}

/** Attempt to reveal a preimage for an approved escrow query. */
export function tryRevealPreimage(
  preimageStore: PreimageStore | undefined,
  htlcHash: string | undefined,
  passed: boolean,
): string | undefined {
  if (!passed || !preimageStore || !htlcHash) return undefined;
  const preimage = preimageStore.getPreimage(htlcHash);
  if (preimage) {
    preimageStore.delete(htlcHash);
    return preimage;
  }
  return undefined;
}
