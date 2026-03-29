import { normalizeQueryResult } from "./attachments";
import { buildChallengeRule, generateNonce } from "./challenge";
import { resolveOracle } from "./oracle";
import type { OracleRegistry } from "./oracle/registry";
import type { PreimageStore } from "./oracle/preimage-store";
import type { OracleAttestation } from "./oracle/types";
import type {
  BlossomKeyMap,
  BountyInfo,
  ExecutorType,
  HtlcInfo,
  HtlcSubmitOutcome,
  OracleAttestationRecord,
  PaymentStatus,
  Query,
  QueryInput,
  QueryResult,
  QueryStatus,
  QuorumConfig,
  QuoteInfo,
  RequesterMeta,
  SubmissionMeta,
  VerificationDetail,
  VerificationFactor,
} from "./types";
import { DEFAULT_VERIFICATION_FACTORS } from "./types";

export type {
  AttachmentRef,
  AttachmentStorageKind,
  Query,
  QueryInput,
  QueryResult,
  QueryStatus,
  VerificationFactor,
  RequesterMeta,
  RequesterType,
} from "./types";
export type QueryVerification = VerificationDetail;
export type QueryExecutorType = ExecutorType;
export type QuerySubmissionMeta = SubmissionMeta;

export interface CreateQueryOptions {
  ttlMs?: number;
  ttlSeconds?: number;
  requesterMeta?: RequesterMeta;
  bounty?: BountyInfo;
  /** Acceptable oracle IDs. Empty/undefined = any (defaults to built-in). */
  oracleIds?: string[];
  /** HTLC escrow info — when present, creates an HTLC-mode query. */
  htlc?: HtlcInfo;
  /** Nostr event ID of the kind 5300 Job Request. */
  nostrEventId?: string;
  /** Multi-oracle quorum config. */
  quorum?: QuorumConfig;
}

export interface SubmitQueryOutcome {
  ok: boolean;
  query: Query | null;
  message: string;
}

export interface CancelQueryOutcome {
  ok: boolean;
  message: string;
}

// --- QueryStore interface ---

export interface QueryStore {
  get(id: string): Query | null;
  set(id: string, query: Query): void;
  values(): Query[];
  delete(id: string): void;
  clear(): void;
}

export function createQueryStore(): QueryStore {
  const queries = new Map<string, Query>();
  return {
    get: (id) => queries.get(id) ?? null,
    set: (id, query) => { queries.set(id, query); },
    values: () => Array.from(queries.values()),
    delete: (id) => { queries.delete(id); },
    clear: () => { queries.clear(); },
  };
}

// --- QueryService ---

export interface QueryHooks {
  onCreated?: (query: Query) => void;
}

export interface QueryServiceDeps {
  store?: QueryStore;
  oracleRegistry?: OracleRegistry;
  preimageStore?: PreimageStore;
  hooks?: QueryHooks;
}

export interface HtlcOutcome {
  ok: boolean;
  message: string;
}

export interface QueryService {
  createQuery(input: QueryInput, options?: CreateQueryOptions): Query;
  getQuery(id: string): Query | null;
  listOpenQueries(): Query[];
  listAllQueries(): Query[];
  submitQueryResult(
    id: string,
    result: QueryResult,
    submissionMeta: SubmissionMeta,
    oracleId?: string,
    blossomKeys?: BlossomKeyMap,
  ): Promise<SubmitQueryOutcome>;
  cancelQuery(id: string): CancelQueryOutcome;
  expireQueries(): number;
  purgeExpiredFromStore(): Query[];
  clearQueryStore(): void;

  // --- HTLC lifecycle ---

  /** Record a Worker quote for an HTLC query. */
  recordQuote(queryId: string, quote: QuoteInfo): HtlcOutcome;
  /** Select a Worker and transition to worker_selected/processing. */
  selectWorker(queryId: string, workerPubkey: string, htlcToken?: string): HtlcOutcome;
  /** Record a Worker's result submission (transition to verifying). */
  recordResult(queryId: string, result: QueryResult, workerPubkey: string, blossomKeys?: BlossomKeyMap): HtlcOutcome;
  /** Complete Oracle verification (transition to approved/rejected). */
  completeVerification(queryId: string, passed: boolean, oracleId?: string): HtlcOutcome;
  /** Submit result for HTLC query with inline verification — returns preimage on success. */
  submitHtlcResult(
    queryId: string,
    result: QueryResult,
    workerPubkey: string,
    oracleId?: string,
    blossomKeys?: BlossomKeyMap,
  ): Promise<HtlcSubmitOutcome>;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

function resolveTtlMs(options?: CreateQueryOptions): number {
  if (!options) return DEFAULT_TTL_MS;
  if (typeof options.ttlMs === "number") return options.ttlMs;
  if (typeof options.ttlSeconds === "number") return options.ttlSeconds * 1000;
  return DEFAULT_TTL_MS;
}

function generateQueryId(): string {
  return `query_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createQueryService(deps?: QueryServiceDeps): QueryService {
  const store = deps?.store ?? createQueryStore();
  const registry = deps?.oracleRegistry;
  const preimageStore = deps?.preimageStore;
  const hooks = deps?.hooks;

  function doResolveOracle(oracleId: string | undefined, acceptableIds: string[] | undefined) {
    return registry
      ? registry.resolve(oracleId, acceptableIds)
      : resolveOracle(oracleId, acceptableIds);
  }

  /** Valid state transitions for HTLC queries. */
  const HTLC_TRANSITIONS: Record<string, QueryStatus[]> = {
    awaiting_quotes: ["worker_selected"],
    worker_selected: ["processing"],
    processing: ["verifying"],
    verifying: ["approved", "rejected"],
  };

  function isHtlcQuery(query: Query): boolean {
    return query.htlc !== undefined;
  }

  async function verifyWithQuorum(
    query: Query,
    result: QueryResult,
    blossomKeys?: BlossomKeyMap,
    oracleId?: string,
  ): Promise<{
    passed: boolean;
    attestations: OracleAttestationRecord[];
    verification: VerificationDetail;
  }> {
    if (!query.quorum) {
      // Single oracle — backward compatible
      const oracle = doResolveOracle(oracleId, query.oracle_ids);
      if (!oracle) {
        return {
          passed: false,
          attestations: [],
          verification: {
            passed: false,
            checks: [],
            failures: [oracleId
              ? `Oracle "${oracleId}" is not available or not accepted for this query`
              : "No oracle available for this query"],
          },
        };
      }
      const att = await oracle.verify(query, result, blossomKeys);
      const record: OracleAttestationRecord = {
        oracle_id: att.oracle_id,
        passed: att.passed,
        checks: att.checks,
        failures: att.failures,
        attested_at: att.attested_at,
        tlsn_verified: att.tlsn_verified,
      };
      return {
        passed: att.passed,
        attestations: [record],
        verification: {
          passed: att.passed,
          checks: att.checks,
          failures: att.failures,
          tlsn_verified: att.tlsn_verified,
        },
      };
    }

    // Multi-oracle quorum
    const resolveMultiple = registry?.resolveMultiple;
    if (!resolveMultiple) {
      return {
        passed: false,
        attestations: [],
        verification: { passed: false, checks: [], failures: ["No oracle registry with resolveMultiple support"] },
      };
    }
    const needed = query.quorum.min_approvals + 2;
    const oracles = resolveMultiple(query.oracle_ids, needed);
    if (oracles.length < query.quorum.min_approvals) {
      return {
        passed: false,
        attestations: [],
        verification: { passed: false, checks: [], failures: [`Need ${query.quorum.min_approvals} oracles but only ${oracles.length} available`] },
      };
    }

    const rawAtts = await Promise.all(oracles.map((o) => o.verify(query, result, blossomKeys)));
    const records: OracleAttestationRecord[] = rawAtts.map((a) => ({
      oracle_id: a.oracle_id,
      passed: a.passed,
      checks: a.checks,
      failures: a.failures,
      attested_at: a.attested_at,
      tlsn_verified: a.tlsn_verified,
    }));

    const passCount = records.filter((a) => a.passed).length;
    const passed = passCount >= query.quorum.min_approvals;
    // Use the first passing oracle's tlsn_verified data
    const firstPass = records.find((a) => a.passed);
    const allChecks = records.flatMap((a) => a.checks);
    const allFailures = records.flatMap((a) => a.failures);

    return {
      passed,
      attestations: records,
      verification: {
        passed,
        checks: allChecks,
        failures: allFailures,
        tlsn_verified: firstPass?.tlsn_verified,
      },
    };
  }

  return {
    createQuery(input: QueryInput, options?: CreateQueryOptions): Query {
      const now = Date.now();
      const requirements = input.verification_requirements
        ?? DEFAULT_VERIFICATION_FACTORS;
      const needsNonce = requirements.includes("nonce");
      const nonce = needsNonce ? generateNonce() : undefined;
      const isHtlc = options?.htlc !== undefined;
      const query: Query = {
        id: generateQueryId(),
        status: isHtlc ? "awaiting_quotes" : "pending",
        description: input.description,
        location_hint: input.location_hint,
        challenge_nonce: nonce,
        challenge_rule: nonce ? buildChallengeRule(nonce, input.description) : undefined,
        verification_requirements: requirements,
        created_at: now,
        expires_at: now + resolveTtlMs(options),
        requester_meta: options?.requesterMeta,
        bounty: options?.bounty,
        oracle_ids: options?.oracleIds,
        payment_status: isHtlc ? "htlc_locked" : "locked",
        htlc: options?.htlc,
        quotes: isHtlc ? [] : undefined,
        nostr_event_id: options?.nostrEventId,
        expected_gps: input.expected_gps,
        max_gps_distance_km: input.max_gps_distance_km,
        tlsn_requirements: input.tlsn_requirements,
        quorum: options?.quorum,
      };

      store.set(query.id, query);
      hooks?.onCreated?.(query);
      return query;
    },

    getQuery(id: string): Query | null {
      return store.get(id);
    },

    listOpenQueries(): Query[] {
      const now = Date.now();
      const openStatuses: QueryStatus[] = ["pending", "awaiting_quotes", "worker_selected", "processing"];
      return store.values().filter((q) => openStatuses.includes(q.status) && q.expires_at > now);
    },

    listAllQueries(): Query[] {
      return store.values().sort((a, b) => b.created_at - a.created_at);
    },

    async submitQueryResult(
      id: string,
      result: QueryResult,
      submissionMeta: SubmissionMeta,
      oracleId?: string,
      blossomKeys?: BlossomKeyMap,
    ): Promise<SubmitQueryOutcome> {
      const query = store.get(id);
      if (!query) return { ok: false, query: null, message: "Query not found" };
      if (query.status !== "pending") return { ok: false, query, message: `Query is ${query.status}, not pending` };
      if (query.expires_at < Date.now()) {
        store.set(id, { ...query, status: "expired", payment_status: "cancelled" });
        return { ok: false, query, message: "Query has expired" };
      }

      const normalizedResult = normalizeQueryResult(result);
      const { passed, attestations, verification } = await verifyWithQuorum(query, normalizedResult, blossomKeys, oracleId);

      if (!passed && attestations.length === 0) {
        // Oracle resolution failed
        return { ok: false, query, message: verification.failures[0] ?? "No oracle available" };
      }

      const newStatus: QueryStatus = passed ? "approved" : "rejected";
      const paymentStatus: PaymentStatus = passed ? "released" : "cancelled";
      const firstOracle = attestations[0]?.oracle_id;
      const updated: Query = {
        ...query,
        status: newStatus,
        submitted_at: Date.now(),
        result: normalizedResult,
        verification,
        submission_meta: submissionMeta,
        payment_status: paymentStatus,
        assigned_oracle_id: firstOracle,
        blossom_keys: blossomKeys,
        attestations: query.quorum ? attestations : undefined,
      };
      store.set(id, updated);

      return {
        ok: passed,
        query: updated,
        message: passed
          ? "Verification passed. Result accepted."
          : `Verification failed: ${verification.failures.join(", ")}`,
      };
    },

    cancelQuery(id: string): CancelQueryOutcome {
      const query = store.get(id);
      if (!query) return { ok: false, message: "Query not found" };
      if (query.status !== "pending") return { ok: false, message: `Query is already ${query.status}` };
      store.set(id, { ...query, status: "rejected", payment_status: "cancelled" });
      return { ok: true, message: "Query cancelled" };
    },

    expireQueries(): number {
      const now = Date.now();
      let count = 0;
      for (const query of store.values()) {
        if (query.status === "pending" && query.expires_at < now) {
          store.set(query.id, { ...query, status: "expired", payment_status: "cancelled" });
          count++;
        }
      }
      return count;
    },

    purgeExpiredFromStore(): Query[] {
      const expired: Query[] = [];
      for (const query of store.values()) {
        if (query.status === "expired") {
          expired.push(query);
          store.delete(query.id);
        }
      }
      return expired;
    },

    clearQueryStore(): void {
      store.clear();
    },

    // --- HTLC lifecycle ---

    recordQuote(queryId: string, quote: QuoteInfo): HtlcOutcome {
      const query = store.get(queryId);
      if (!query) return { ok: false, message: "Query not found" };
      if (!isHtlcQuery(query)) return { ok: false, message: "Not an HTLC query" };
      if (query.status !== "awaiting_quotes") return { ok: false, message: `Query is ${query.status}, not awaiting_quotes` };

      const quotes = [...(query.quotes ?? []), quote];
      store.set(queryId, { ...query, quotes });
      return { ok: true, message: "Quote recorded" };
    },

    selectWorker(queryId: string, workerPubkey: string, htlcToken?: string): HtlcOutcome {
      const query = store.get(queryId);
      if (!query) return { ok: false, message: "Query not found" };
      if (!isHtlcQuery(query)) return { ok: false, message: "Not an HTLC query" };
      if (query.status !== "awaiting_quotes") return { ok: false, message: `Query is ${query.status}, not awaiting_quotes` };

      const htlc: HtlcInfo = {
        ...query.htlc!,
        worker_pubkey: workerPubkey,
        escrow_token: htlcToken ?? query.htlc!.escrow_token,
      };

      store.set(queryId, {
        ...query,
        status: "processing",
        htlc,
        payment_status: htlcToken ? "htlc_swapped" : query.payment_status,
      });
      return { ok: true, message: "Worker selected" };
    },

    recordResult(queryId: string, result: QueryResult, workerPubkey: string, blossomKeys?: BlossomKeyMap): HtlcOutcome {
      const query = store.get(queryId);
      if (!query) return { ok: false, message: "Query not found" };
      if (!isHtlcQuery(query)) return { ok: false, message: "Not an HTLC query" };
      if (query.status !== "processing") return { ok: false, message: `Query is ${query.status}, not processing` };
      if (query.htlc?.worker_pubkey && query.htlc.worker_pubkey !== workerPubkey) {
        return { ok: false, message: "Worker pubkey does not match selected worker" };
      }

      const normalizedResult = normalizeQueryResult(result);
      store.set(queryId, {
        ...query,
        status: "verifying",
        result: normalizedResult,
        submitted_at: Date.now(),
        submission_meta: { executor_type: "human", channel: "worker_api" },
        blossom_keys: blossomKeys,
      });
      return { ok: true, message: "Result recorded, verification in progress" };
    },

    completeVerification(queryId: string, passed: boolean, oracleId?: string): HtlcOutcome {
      const query = store.get(queryId);
      if (!query) return { ok: false, message: "Query not found" };
      if (!isHtlcQuery(query)) return { ok: false, message: "Not an HTLC query" };
      if (query.status !== "verifying") return { ok: false, message: `Query is ${query.status}, not verifying` };

      const newStatus: QueryStatus = passed ? "approved" : "rejected";
      const paymentStatus: PaymentStatus = passed ? "released" : "cancelled";
      store.set(queryId, {
        ...query,
        status: newStatus,
        payment_status: paymentStatus,
        assigned_oracle_id: oracleId,
      });
      return { ok: true, message: passed ? "Verification passed" : "Verification failed" };
    },

    async submitHtlcResult(
      queryId: string,
      result: QueryResult,
      workerPubkey: string,
      oracleId?: string,
      blossomKeys?: BlossomKeyMap,
    ): Promise<HtlcSubmitOutcome> {
      const query = store.get(queryId);
      if (!query) return { ok: false, query: null, message: "Query not found" };
      if (!isHtlcQuery(query)) return { ok: false, query, message: "Not an HTLC query" };
      if (query.status !== "processing") return { ok: false, query, message: `Query is ${query.status}, not processing` };
      if (query.htlc?.worker_pubkey && query.htlc.worker_pubkey !== workerPubkey) {
        return { ok: false, query, message: "Worker pubkey does not match selected worker" };
      }

      // 1. Record result (processing → verifying)
      const normalizedResult = normalizeQueryResult(result);
      const verifyingQuery: Query = {
        ...query,
        status: "verifying",
        result: normalizedResult,
        submitted_at: Date.now(),
        submission_meta: { executor_type: "human", channel: "worker_api" },
        blossom_keys: blossomKeys,
      };
      store.set(queryId, verifyingQuery);

      // 2. Verify with oracle(s)
      const { passed, attestations, verification } = await verifyWithQuorum(
        verifyingQuery,
        normalizedResult,
        blossomKeys,
        oracleId,
      );

      // 3. Complete verification
      const newStatus: QueryStatus = passed ? "approved" : "rejected";
      const paymentStatus: PaymentStatus = passed ? "released" : "cancelled";
      const firstOracle = attestations[0]?.oracle_id;
      const updated: Query = {
        ...verifyingQuery,
        status: newStatus,
        payment_status: paymentStatus,
        verification,
        assigned_oracle_id: firstOracle,
        attestations: verifyingQuery.quorum ? attestations : undefined,
      };
      store.set(queryId, updated);

      // 4. Return preimage on success
      if (passed && preimageStore) {
        const preimage = preimageStore.getPreimage(queryId);
        if (preimage) {
          return {
            ok: true,
            query: updated,
            message: "Verification passed. Preimage revealed for HTLC redemption.",
            preimage,
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
    },
  };
}

// --- Relay publish hook (default for production) ---

function publishQueryToRelay(query: Query): void {
  import("./nostr/client").then(async ({ isNostrEnabled, publishEvent }) => {
    if (!isNostrEnabled()) return;
    const { buildQueryRequestEvent } = await import("./nostr/events");
    const { generateEphemeralIdentity } = await import("./nostr/identity");

    const identity = generateEphemeralIdentity();
    const event = buildQueryRequestEvent(identity, query.id, {
      description: query.description,
      nonce: query.challenge_nonce,
      expires_at: query.expires_at,
      oracle_ids: query.oracle_ids,
      verification_requirements: query.verification_requirements,
      bounty: query.bounty?.cashu_token
        ? { mint: process.env.CASHU_MINT_URL ?? "", token: query.bounty.cashu_token }
        : undefined,
    }, query.location_hint);

    const result = await publishEvent(event);
    if (result.successes.length > 0) {
      console.error(`[relay] Query ${query.id} published to ${result.successes.length} relay(s)`);
    }
  }).catch((err) => {
    console.error("[relay] Failed to publish query:", err);
  });
}

// --- Default singleton service (backward compat) ---

export const defaultService = createQueryService({
  hooks: { onCreated: publishQueryToRelay },
});

export function createQuery(input: QueryInput, options?: CreateQueryOptions): Query {
  return defaultService.createQuery(input, options);
}

export function getQuery(id: string): Query | null {
  return defaultService.getQuery(id);
}

export function listOpenQueries(): Query[] {
  return defaultService.listOpenQueries();
}

export function listAllQueries(): Query[] {
  return defaultService.listAllQueries();
}

export async function submitQueryResult(
  id: string,
  result: QueryResult,
  submissionMeta: SubmissionMeta,
  oracleId?: string,
  blossomKeys?: BlossomKeyMap,
): Promise<SubmitQueryOutcome> {
  return defaultService.submitQueryResult(id, result, submissionMeta, oracleId, blossomKeys);
}

export function cancelQuery(id: string): CancelQueryOutcome {
  return defaultService.cancelQuery(id);
}

export function expireQueries(): number {
  return defaultService.expireQueries();
}

export function purgeExpiredFromStore(): Query[] {
  return defaultService.purgeExpiredFromStore();
}

export function clearQueryStore(): void {
  defaultService.clearQueryStore();
}
