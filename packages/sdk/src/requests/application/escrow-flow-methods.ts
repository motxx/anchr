/**
 * Application-layer escrow flow: store I/O, escrow-provider verification,
 * and settlement orchestration. Transition and validation rules are owned by
 * the domain aggregate (`../domain/query-aggregate.ts`); every state change
 * here goes through it.
 */

import {
  addOffer,
  beginWork,
  completeVerification,
  type EscrowSelectionUpdates,
  recordResult,
  selectProvider,
} from "../domain/query-aggregate.ts";
import {
  isEscrowQuery,
  verifyEscrowAmount,
  verifyEscrowLock,
} from "./query-escrow-validation.ts";
import type { QueryStore } from "../domain/query-store.ts";
import type { BlossomKeyMap } from "../../values.ts";
import type {
  EscrowSubmitOutcome,
  OfferInfo,
  QueryResult,
} from "../domain/types.ts";
import type { HtlcOutcome } from "./query-service.ts";
import { identityNormalize, ServiceDeps } from "./query-service-deps.ts";
import {
  tryRevealPreimage,
  verifyAndFinalize,
} from "./verification-orchestration.ts";
import { getLogger } from "../../internal/runtime/logger.ts";

const log = getLogger(["anchr", "query-service", "escrow"]);

export function doRecordOffer(
  store: QueryStore,
  queryId: string,
  offer: OfferInfo,
): HtlcOutcome {
  const query = store.get(queryId);
  if (!query) return { ok: false, message: "Query not found" };

  const transition = addOffer(query, offer);
  if (!transition.ok) return { ok: false, message: transition.error };
  store.set(queryId, transition.query);
  return { ok: true, message: "Offer recorded" };
}

export async function doSelectProvider(
  deps: ServiceDeps,
  queryId: string,
  providerPubkey: string,
  escrowToken?: string,
): Promise<HtlcOutcome> {
  const { store } = deps;
  const query = store.get(queryId);
  if (!query) return { ok: false, message: "Query not found" };

  // Validate the transition before any escrow I/O so state errors surface
  // with the domain's message; the committing call happens after the token
  // checks pass.
  const dryRun = selectProvider(query, providerPubkey, {});
  if (!dryRun.ok) return { ok: false, message: dryRun.error };

  const escrowRef = query.escrow?.escrow_ref ?? query.escrow?.escrow_token ??
    escrowToken;
  const expectedSats = query.payment_lock?.amount_sats;
  // CTF-2: P2PK+FROST settlement uses a group signature instead of a preimage;
  // the hashlock check is HTLC-only and skipped for the FROST variant.
  const paymentHash = query.escrow?.type === "htlc"
    ? query.escrow.hash
    : undefined;

  // CTF-2: when the escrow token demands amount/lock verification, a missing
  // escrow provider port is a wiring error — fail closed instead of selecting
  // a provider with the token never verified.
  if (escrowRef && (expectedSats || paymentHash) && !deps.escrowProvider) {
    return {
      ok: false,
      message:
        "Escrow provider port not configured — cannot verify escrow token before selection",
    };
  }

  const updates: EscrowSelectionUpdates = {};
  if (escrowToken !== undefined) updates.escrow_token = escrowToken;

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
    updates.verified_escrow_sats = check.amountSats;
  }

  if (escrowRef && paymentHash && deps.escrowProvider) {
    const lockCheck = await verifyEscrowLock(
      deps.escrowProvider,
      escrowRef,
      paymentHash,
      providerPubkey,
    );
    if (!lockCheck.ok) {
      return { ok: false, message: lockCheck.message! };
    }
  }

  const transition = selectProvider(query, providerPubkey, updates);
  if (!transition.ok) return { ok: false, message: transition.error };
  store.set(queryId, transition.query);
  return { ok: true, message: "Provider selected" };
}

export function doBeginWork(
  store: QueryStore,
  queryId: string,
): HtlcOutcome {
  const query = store.get(queryId);
  if (!query) return { ok: false, message: "Query not found" };

  const transition = beginWork(query);
  if (!transition.ok) return { ok: false, message: transition.error };
  store.set(queryId, transition.query);
  return { ok: true, message: "Work begun" };
}

export function doRecordResult(
  deps: ServiceDeps,
  queryId: string,
  result: QueryResult,
  providerPubkey: string,
  blossomKeys?: BlossomKeyMap,
): HtlcOutcome {
  const { store } = deps;
  const query = store.get(queryId);
  if (!query) return { ok: false, message: "Query not found" };

  const normalizedResult = (deps.normalizeResult ?? identityNormalize)(result);
  const transition = recordResult(
    query,
    normalizedResult,
    providerPubkey,
    blossomKeys,
  );
  if (!transition.ok) return { ok: false, message: transition.error };
  store.set(queryId, transition.query);
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

  const transition = completeVerification(query, passed, undefined, oracleId);
  if (!transition.ok) return { ok: false, message: transition.error };
  store.set(queryId, transition.query);
  return {
    ok: true,
    message: passed ? "Verification passed" : "Verification failed",
  };
}

export async function doSubmitEscrowResult(
  deps: ServiceDeps,
  queryId: string,
  result: QueryResult,
  providerPubkey: string,
  oracleId?: string,
  blossomKeys?: BlossomKeyMap,
): Promise<EscrowSubmitOutcome> {
  const { store } = deps;
  const query = store.get(queryId);
  if (!query) return { ok: false, query: null, message: "Query not found" };
  if (!isEscrowQuery(query)) {
    return { ok: false, query, message: "Not an escrow query" };
  }

  const normalizedResult = (deps.normalizeResult ?? identityNormalize)(result);
  const transition = recordResult(
    query,
    normalizedResult,
    providerPubkey,
    blossomKeys,
  );
  if (!transition.ok) {
    return { ok: false, query, message: transition.error };
  }
  const verifyingQuery = transition.query;
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
    const preimage = await tryRevealPreimage(
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
    const frostSignature = await deps.frostSignature
      .requestSignature(verifyingQuery, normalizedResult, blossomKeys)
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
