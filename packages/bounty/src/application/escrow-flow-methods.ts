import {
  isEscrowQuery,
  validateEscrowTransition,
  verifyEscrowAmount,
  verifyEscrowLock,
} from "./query-escrow-validation.ts";
import type { QueryStore } from "../domain/query-store.ts";
import type {
  BlossomKeyMap,
  EscrowInfo,
  EscrowSubmitOutcome,
  OfferInfo,
  PaymentStatus,
  Query,
  QueryResult,
  QueryStatus,
} from "../domain/types.ts";
import type { HtlcOutcome } from "./query-service.ts";
import { identityNormalize, ServiceDeps } from "./query-service-deps.ts";
import {
  tryRevealPreimage,
  verifyAndFinalize,
} from "./verification-orchestration.ts";
import { getLogger } from "@anchr/core-runtime/logger";

const log = getLogger(["anchr", "query-service", "escrow"]);

export function doRecordOffer(
  store: QueryStore,
  queryId: string,
  offer: OfferInfo,
): HtlcOutcome {
  const query = store.get(queryId);
  if (!query) return { ok: false, message: "Query not found" };
  if (!isEscrowQuery(query)) {
    return { ok: false, message: "Not an escrow query" };
  }
  if (query.status !== "awaiting_offers") {
    return {
      ok: false,
      message: `Query is ${query.status}, not awaiting_offers`,
    };
  }

  const offers = [...(query.offers ?? []), offer];
  store.set(queryId, { ...query, offers });
  return { ok: true, message: "Offer recorded" };
}

export async function doSelectWorker(
  deps: ServiceDeps,
  queryId: string,
  workerPubkey: string,
  escrowToken?: string,
): Promise<HtlcOutcome> {
  const { store } = deps;
  const query = store.get(queryId);
  if (!query) return { ok: false, message: "Query not found" };
  if (!isEscrowQuery(query)) {
    return { ok: false, message: "Not an escrow query" };
  }
  if (!validateEscrowTransition(query.status, "worker_selected")) {
    return {
      ok: false,
      message: `Query is ${query.status}, not awaiting_offers`,
    };
  }

  const escrowRef = query.escrow?.escrow_ref ?? query.escrow?.escrow_token ??
    escrowToken;
  const expectedSats = query.bounty?.amount_sats;
  let verifiedEscrowSats: number | undefined;
  if (escrowRef && expectedSats && deps.escrowProvider) {
    const check = await verifyEscrowAmount(
      deps.escrowProvider,
      escrowRef,
      expectedSats,
    );
    if (!check.valid) {
      return {
        ok: false,
        message: `Escrow token verification failed: ${check.error}`,
      };
    }
    verifiedEscrowSats = check.amountSats;
  }

  // CTF-2: P2PK+FROST settlement uses a group signature instead of a preimage; the
  // hashlock check below is HTLC-only and skipped for the FROST variant.
  const paymentHash = query.escrow?.type === "htlc"
    ? query.escrow.hash
    : undefined;
  if (escrowRef && paymentHash && deps.escrowProvider) {
    const lockCheck = await verifyEscrowLock(
      deps.escrowProvider,
      escrowRef,
      paymentHash,
      workerPubkey,
    );
    if (!lockCheck.ok) {
      return { ok: false, message: lockCheck.message! };
    }
  }

  const escrow: EscrowInfo = {
    ...query.escrow!,
    worker_pubkey: workerPubkey,
    escrow_token: escrowToken ?? query.escrow?.escrow_token,
    verified_escrow_sats: verifiedEscrowSats,
  };

  store.set(queryId, {
    ...query,
    status: "worker_selected",
    escrow,
    payment_status: escrowToken ? "escrow_swapped" : query.payment_status,
  });
  return { ok: true, message: "Worker selected" };
}

export function doBeginWork(
  store: QueryStore,
  queryId: string,
): HtlcOutcome {
  const query = store.get(queryId);
  if (!query) return { ok: false, message: "Query not found" };
  if (!isEscrowQuery(query)) {
    return { ok: false, message: "Not an escrow query" };
  }
  if (!validateEscrowTransition(query.status, "processing")) {
    return {
      ok: false,
      message: `Query is ${query.status}, not worker_selected`,
    };
  }
  store.set(queryId, { ...query, status: "processing" });
  return { ok: true, message: "Work begun" };
}

export function doRecordResult(
  deps: ServiceDeps,
  queryId: string,
  result: QueryResult,
  workerPubkey: string,
  blossomKeys?: BlossomKeyMap,
): HtlcOutcome {
  const { store } = deps;
  const query = store.get(queryId);
  if (!query) return { ok: false, message: "Query not found" };
  if (!isEscrowQuery(query)) {
    return { ok: false, message: "Not an escrow query" };
  }
  if (!validateEscrowTransition(query.status, "verifying")) {
    return { ok: false, message: `Query is ${query.status}, not processing` };
  }
  if (
    query.escrow?.worker_pubkey && query.escrow.worker_pubkey !== workerPubkey
  ) {
    return {
      ok: false,
      message: "Worker pubkey does not match selected worker",
    };
  }

  const normalizedResult = (deps.normalizeResult ?? identityNormalize)(result);
  store.set(queryId, {
    ...query,
    status: "verifying",
    result: normalizedResult,
    submitted_at: Date.now(),
    submission_meta: { executor_type: "human", channel: "adapter" },
    blossom_keys: blossomKeys,
  });
  return { ok: true, message: "Result recorded, verification in progress" };
}

export function doCompleteVerification(
  store: QueryStore,
  queryId: string,
  passed: boolean,
  oracleId?: string,
): HtlcOutcome {
  const query = store.get(queryId);
  if (!query) return { ok: false, message: "Query not found" };
  if (!isEscrowQuery(query)) {
    return { ok: false, message: "Not an escrow query" };
  }
  const verifyTarget: QueryStatus = passed ? "approved" : "rejected";
  if (!validateEscrowTransition(query.status, verifyTarget)) {
    return { ok: false, message: `Query is ${query.status}, not verifying` };
  }

  const newStatus: QueryStatus = verifyTarget;
  const paymentStatus: PaymentStatus = passed ? "released" : "cancelled";
  store.set(queryId, {
    ...query,
    status: newStatus,
    payment_status: paymentStatus,
    assigned_oracle_id: oracleId,
  });
  return {
    ok: true,
    message: passed ? "Verification passed" : "Verification failed",
  };
}

export async function doSubmitEscrowResult(
  deps: ServiceDeps,
  queryId: string,
  result: QueryResult,
  workerPubkey: string,
  oracleId?: string,
  blossomKeys?: BlossomKeyMap,
): Promise<EscrowSubmitOutcome> {
  const { store } = deps;
  const query = store.get(queryId);
  if (!query) return { ok: false, query: null, message: "Query not found" };
  if (!isEscrowQuery(query)) {
    return { ok: false, query, message: "Not an escrow query" };
  }
  if (!validateEscrowTransition(query.status, "verifying")) {
    return {
      ok: false,
      query,
      message: `Query is ${query.status}, not processing`,
    };
  }
  if (
    query.escrow?.worker_pubkey && query.escrow.worker_pubkey !== workerPubkey
  ) {
    return {
      ok: false,
      query,
      message: "Worker pubkey does not match selected worker",
    };
  }

  const normalizedResult = (deps.normalizeResult ?? identityNormalize)(result);
  const verifyingQuery: Query = {
    ...query,
    status: "verifying",
    result: normalizedResult,
    submitted_at: Date.now(),
    submission_meta: { executor_type: "human", channel: "adapter" },
    blossom_keys: blossomKeys,
  };
  store.set(queryId, verifyingQuery);

  const { passed, verification, updated } = await verifyAndFinalize(
    verifyingQuery,
    normalizedResult,
    deps,
    blossomKeys,
    oracleId,
  );
  store.set(queryId, updated);

  if (passed && query.escrow?.type === "htlc") {
    const preimage = tryRevealPreimage(
      deps.preimageStore,
      query.escrow.hash,
      passed,
    );
    if (preimage) {
      return {
        ok: true,
        query: updated,
        message: "Verification passed. Preimage revealed for HTLC redemption.",
        preimage,
      };
    }
  }

  if (passed && query.escrow?.type === "p2pk_frost" && deps.frostSignature) {
    // Domain-separation tag: any future redeemer (Cashu mint, downstream verifier)
    // must use the same prefix when validating this signature against the P2PK
    // lock. The version suffix lets us evolve the encoding without colliding with
    // sigs from older deployments. See ADR notes in EscrowSubmitOutcome.
    const message = new TextEncoder().encode(
      `anchr/query-settle/v1:${query.id}:approved`,
    );
    const frostSignature = await deps.frostSignature
      .requestSignature(query.escrow.group_pubkey, message)
      .catch((err) => {
        log.error("FROST requestSignature failed", { err, queryId: query.id });
        return null;
      });
    if (frostSignature) {
      return {
        ok: true,
        query: updated,
        message:
          "Verification passed. FROST group signature delivered for P2PK redemption.",
        frost_signature: frostSignature,
      };
    }
  }

  return {
    ok: passed,
    query: updated,
    message: passed
      ? "Verification passed."
      : `Verification failed: ${verification.failures.join(", ")}`,
  };
}
