import { verifyWithQuorum } from "./query-verification.ts";
import type { ServiceDeps } from "./query-service-deps.ts";
import type { PreimageStore } from "./ports.ts";
import type { BlossomKeyMap } from "../../values.ts";
import type {
  PaymentStatus,
  Query,
  QueryResult,
  QueryStatus,
} from "../domain/types.ts";

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

  const updated: Query = {
    ...query,
    status: newStatus,
    payment_status: paymentStatus,
    verification,
    assigned_oracle_id: attestations[0]?.oracle_id,
    attestations: query.quorum ? attestations : undefined,
  };
  return { passed, attestations, verification, updated };
}

/** Attempt to reveal a preimage for an approved escrow query. */
export async function tryRevealPreimage(
  preimageStore: PreimageStore | undefined,
  htlcHash: string | undefined,
  passed: boolean,
): Promise<string | undefined> {
  if (!passed || !preimageStore || !htlcHash) return undefined;
  const preimage = await preimageStore.getPreimage(htlcHash);
  if (preimage) {
    await preimageStore.delete(htlcHash);
    return preimage;
  }
  return undefined;
}
