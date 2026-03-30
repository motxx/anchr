import { normalizeQueryResult } from "./attachments";
import { getDecodedToken } from "@cashu/cashu-ts";
import { verifyToken } from "./cashu/wallet";
import { verifyHtlcProofs } from "./cashu/escrow";
import type { WalletStore } from "./cashu/wallet-store";
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
  walletStore?: WalletStore;
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
  selectWorker(queryId: string, workerPubkey: string, htlcToken?: string): Promise<HtlcOutcome>;
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
  const { randomBytes } = require("node:crypto");
  return `query_${Date.now()}_${randomBytes(8).toString("hex")}`;
}

/** Minimum HTLC locktime in seconds (10 minutes). */
export const MIN_HTLC_LOCKTIME_SECS = 600;

export function createQueryService(deps?: QueryServiceDeps): QueryService {
  const store = deps?.store ?? createQueryStore();
  const registry = deps?.oracleRegistry;
  const preimageStore = deps?.preimageStore;
  const hooks = deps?.hooks;
  const walletStore = deps?.walletStore;

  function doResolveOracle(oracleId: string | undefined, acceptableIds: string[] | undefined) {
    return registry
      ? registry.resolve(oracleId, acceptableIds)
      : resolveOracle(oracleId, acceptableIds);
  }

  /** Valid state transitions for HTLC queries. */
  const HTLC_TRANSITIONS: Record<string, QueryStatus[]> = {
    awaiting_quotes: ["processing"],
    processing: ["verifying"],
    verifying: ["approved", "rejected"],
  };

  function validateTransition(from: QueryStatus, to: QueryStatus): boolean {
    return HTLC_TRANSITIONS[from]?.includes(to) ?? false;
  }

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
    // CTF-1: When query has no acceptable oracle list, ignore worker-supplied oracleId.
    // Otherwise a worker can register a malicious oracle and force its use.
    const effectiveOracleId = query.oracle_ids?.length ? oracleId : undefined;

    if (!query.quorum) {
      // Single oracle — backward compatible
      const oracle = doResolveOracle(effectiveOracleId, query.oracle_ids);
      if (!oracle) {
        return {
          passed: false,
          attestations: [],
          verification: {
            passed: false,
            checks: [],
            failures: [effectiveOracleId
              ? `Oracle "${effectiveOracleId}" is not available or not accepted for this query`
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

      // CTF-3: Enforce minimum HTLC locktime to prevent immediate-refund race attacks.
      if (options?.htlc?.locktime) {
        const nowSecs = Math.floor(now / 1000);
        if (options.htlc.locktime - nowSecs < MIN_HTLC_LOCKTIME_SECS) {
          throw new Error(
            `HTLC locktime must be at least ${MIN_HTLC_LOCKTIME_SECS}s in the future (got ${options.htlc.locktime - nowSecs}s)`,
          );
        }
      }

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

      // Lock bounty proofs from requester wallet → escrow
      if (walletStore && options?.bounty?.amount_sats && options.htlc?.requester_pubkey) {
        const sats = options.bounty.amount_sats;
        const pub = options.htlc.requester_pubkey;
        const locked = walletStore.lockForQuery("requester", pub, query.id, sats);
        if (!locked) {
          throw new Error(`Insufficient balance: Requester ${pub} cannot lock ${sats} sats`);
        }
      }

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
      const cancellableStatuses: QueryStatus[] = ["pending", "awaiting_quotes", "worker_selected", "processing"];
      if (!cancellableStatuses.includes(query.status)) {
        return { ok: false, message: `Query is already ${query.status}` };
      }
      store.set(id, { ...query, status: "rejected", payment_status: "cancelled" });
      // Refund locked proofs to requester
      if (walletStore && query.htlc?.requester_pubkey) {
        walletStore.unlockForQuery("requester", query.htlc.requester_pubkey, id);
      }
      return { ok: true, message: "Query cancelled" };
    },

    expireQueries(): number {
      const now = Date.now();
      let count = 0;
      const expirableStatuses: QueryStatus[] = ["pending", "awaiting_quotes", "worker_selected", "processing"];
      for (const query of store.values()) {
        if (expirableStatuses.includes(query.status) && query.expires_at < now) {
          store.set(query.id, { ...query, status: "expired", payment_status: "cancelled" });
          if (walletStore && query.htlc?.requester_pubkey) {
            walletStore.unlockForQuery("requester", query.htlc.requester_pubkey, query.id);
          }
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

    async selectWorker(queryId: string, workerPubkey: string, htlcToken?: string): Promise<HtlcOutcome> {
      const query = store.get(queryId);
      if (!query) return { ok: false, message: "Query not found" };
      if (!isHtlcQuery(query)) return { ok: false, message: "Not an HTLC query" };
      if (!validateTransition(query.status, "processing")) return { ok: false, message: `Query is ${query.status}, not awaiting_quotes` };

      // Verify HTLC token amount matches bounty — queries Cashu mint for proof state
      const tokenToVerify = htlcToken ?? query.htlc!.escrow_token;
      const expectedSats = query.bounty?.amount_sats;
      let verifiedEscrowSats: number | undefined;
      if (tokenToVerify && expectedSats) {
        const check = await verifyToken(tokenToVerify, expectedSats);
        if (!check.valid) {
          return { ok: false, message: `Escrow token verification failed: ${check.error}` };
        }
        verifiedEscrowSats = check.amountSats;
      }

      // CTF-2: Verify HTLC token P2PK lock target and hashlock.
      // Without this, a requester could submit a token locked to their own key
      // instead of the worker's, then redeem after preimage is revealed.
      if (tokenToVerify && query.htlc?.hash) {
        try {
          const decoded = getDecodedToken(tokenToVerify);
          for (const proof of decoded.proofs) {
            let secret: unknown;
            try { secret = JSON.parse(proof.secret); } catch { continue; }
            if (!Array.isArray(secret) || secret[0] !== "HTLC") continue;

            // Verify hashlock matches query hash
            if (secret[1]?.data !== query.htlc.hash) {
              return { ok: false, message: "HTLC hash mismatch: token hashlock does not match query" };
            }

            // Verify P2PK lock includes worker pubkey
            const tags: string[][] | undefined = secret[1]?.tags;
            const pubkeyTag = tags?.find((t: string[]) => t[0] === "pubkeys");
            if (pubkeyTag) {
              const lockedKeys = pubkeyTag.slice(1);
              // Accept both compressed (02/03-prefixed) and raw hex
              const workerHex = workerPubkey.startsWith("02") || workerPubkey.startsWith("03")
                ? workerPubkey
                : `02${workerPubkey}`;
              if (!lockedKeys.includes(workerPubkey) && !lockedKeys.includes(workerHex)) {
                return { ok: false, message: "HTLC token not locked to selected worker" };
              }
            }
          }
        } catch {
          // Token decode failed — non-fatal, amount check already passed
        }
      }

      const htlc: HtlcInfo = {
        ...query.htlc!,
        worker_pubkey: workerPubkey,
        escrow_token: tokenToVerify,
        verified_escrow_sats: verifiedEscrowSats,
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
      if (!validateTransition(query.status, "verifying")) return { ok: false, message: `Query is ${query.status}, not processing` };
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
      const verifyTarget: QueryStatus = passed ? "approved" : "rejected";
      if (!validateTransition(query.status, verifyTarget)) return { ok: false, message: `Query is ${query.status}, not verifying` };

      const newStatus: QueryStatus = verifyTarget;
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
      if (!validateTransition(query.status, "verifying")) return { ok: false, query, message: `Query is ${query.status}, not processing` };
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

      // 3. Complete verification + wallet settlement
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

      // 4. Return preimage on success (look up by HTLC hash)
      // Server-side HTLC verification: verify preimage matches hash before revealing.
      // IMPORTANT: Read locked proofs BEFORE wallet settlement to avoid VULN-1
      // (transferLocked deletes proofs from pending, making getLockedProofs return []).
      if (passed && preimageStore && query.htlc?.hash) {
        const preimage = preimageStore.getPreimage(query.htlc.hash);
        if (preimage) {
          if (!walletStore) {
            return {
              ok: false,
              query: updated,
              message: "HTLC preimage cannot be revealed without walletStore",
            };
          }
          // Serialize wallet mutations to prevent concurrent double-spend
          const settlementResult = await walletStore.withLock(
            "requester", query.htlc.requester_pubkey, () => {
              // Read proofs BEFORE transfer (they're deleted from pending on transfer)
              const lockedProofs = walletStore.getLockedProofs(
                "requester", query.htlc!.requester_pubkey, queryId,
              );
              // Only verify proofs that are actually HTLC-formatted (Phase 2 swapped proofs).
              const htlcProofs = lockedProofs.filter((p) => {
                try { const s = JSON.parse(p.secret); return Array.isArray(s) && s[0] === "HTLC"; } catch { return false; }
              });
              if (htlcProofs.length > 0) {
                const htlcError = verifyHtlcProofs(htlcProofs, query.htlc!.hash, preimage);
                if (htlcError) {
                  console.error(`[htlc] HTLC proof verification failed: ${htlcError}`);
                  walletStore.unlockForQuery("requester", query.htlc!.requester_pubkey, queryId);
                  return { ok: false as const, message: `HTLC proof verification failed: ${htlcError}` };
                }
              }
              walletStore.transferLocked(
                "requester", query.htlc!.requester_pubkey, queryId,
                "worker", workerPubkey,
              );
              return { ok: true as const };
            },
          );
          if (!settlementResult.ok) {
            return { ok: false, query: updated, message: settlementResult.message };
          }
          preimageStore.delete(query.htlc.hash);
          return {
            ok: true,
            query: updated,
            message: "Verification passed. Preimage revealed for HTLC redemption.",
            preimage,
          };
        }
      }

      // Settle wallet for non-preimage paths (no preimage store, or preimage not found)
      if (walletStore && query.htlc?.requester_pubkey) {
        await walletStore.withLock("requester", query.htlc.requester_pubkey, () => {
          if (passed) {
            walletStore.transferLocked(
              "requester", query.htlc!.requester_pubkey, queryId,
              "worker", workerPubkey,
            );
          } else {
            walletStore.unlockForQuery("requester", query.htlc!.requester_pubkey, queryId);
          }
        });
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
