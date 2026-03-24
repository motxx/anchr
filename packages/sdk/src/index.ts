/**
 * Anchr SDK — Buy cryptographically verified data with sats.
 *
 * @example
 * ```typescript
 * import { Anchr } from "anchr-sdk";
 *
 * const anchr = new Anchr({ serverUrl: "https://anchr.example.com" });
 *
 * const result = await anchr.query({
 *   description: "BTC price from CoinGecko",
 *   targetUrl: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
 *   conditions: [{ type: "jsonpath", expression: "bitcoin.usd" }],
 *   maxSats: 21,
 * });
 *
 * console.log(result.data);    // { bitcoin: { usd: 71000 } }
 * console.log(result.verified); // true
 * ```
 */

// --- Types ---

export interface AnchrConfig {
  /** Anchr server URL (e.g. "http://localhost:3000" or "https://anchr.example.com") */
  serverUrl: string;
  /** API key for write endpoints (optional if server has no auth) */
  apiKey?: string;
  /** Default timeout for queries in seconds (default: 300) */
  defaultTimeoutSeconds?: number;
  /** Polling interval in milliseconds (default: 3000) */
  pollIntervalMs?: number;
}

export interface QueryOptions {
  /** Human-readable description of what to verify */
  description: string;
  /** Target HTTPS URL to fetch and prove */
  targetUrl: string;
  /** Conditions the response must satisfy */
  conditions?: QueryCondition[];
  /** Maximum sats to pay for this query */
  maxSats?: number;
  /** Server-side TTL in seconds (minimum 60, default 300) */
  timeoutSeconds?: number;
  /** Client-side polling timeout in seconds (how long to wait for result, default: same as timeoutSeconds) */
  pollTimeoutSeconds?: number;
  /** Maximum allowed age of attestation in seconds (default: 300) */
  maxAttestationAgeSeconds?: number;
}

export interface QueryCondition {
  /** Condition type */
  type: "contains" | "regex" | "jsonpath";
  /** Expression to evaluate against the response body */
  expression: string;
  /** Expected value (for jsonpath comparison) */
  expected?: string;
  /** Human-readable description */
  description?: string;
}

export interface QueryResult {
  /** Whether the cryptographic verification passed */
  verified: boolean;
  /** Server name from the TLS certificate (cryptographically verified) */
  serverName: string;
  /** Response body (cryptographically verified) */
  data: unknown;
  /** Raw response body string */
  rawBody: string;
  /** TLSNotary presentation (base64, for independent verification) */
  proof: string;
  /** Verification timestamp (unix seconds) */
  timestamp: number;
  /** Verification checks that passed */
  checks: string[];
  /** Sats paid */
  satsPaid: number;
  /** Query ID */
  queryId: string;
}

export interface PhotoQueryOptions {
  /** Human-readable description of what to photograph */
  description: string;
  /** Location hint for workers */
  locationHint?: string;
  /** Expected GPS coordinates */
  expectedGps?: { lat: number; lon: number };
  /** Max distance from expected GPS in km (default: 50) */
  maxGpsDistanceKm?: number;
  /** Maximum sats to pay */
  maxSats?: number;
  /** Timeout in seconds */
  timeoutSeconds?: number;
}

export interface PhotoResult {
  verified: boolean;
  checks: string[];
  attachments: Array<{ uri: string; mimeType: string }>;
  notes?: string;
  gps?: { lat: number; lon: number };
  queryId: string;
  satsPaid: number;
}

// --- Errors ---

export class AnchrError extends Error {
  constructor(message: string, public code: string, public details?: unknown) {
    super(message);
    this.name = "AnchrError";
  }
}

export class QueryTimeoutError extends AnchrError {
  constructor(queryId: string, timeoutSeconds: number) {
    super(`Query ${queryId} timed out after ${timeoutSeconds}s`, "TIMEOUT", { queryId, timeoutSeconds });
  }
}

export class VerificationFailedError extends AnchrError {
  constructor(queryId: string, failures: string[]) {
    super(`Verification failed: ${failures.join(", ")}`, "VERIFICATION_FAILED", { queryId, failures });
  }
}

// --- SDK ---

export class Anchr {
  private config: Required<AnchrConfig>;

  constructor(config: AnchrConfig) {
    this.config = {
      serverUrl: config.serverUrl.replace(/\/$/, ""),
      apiKey: config.apiKey ?? "",
      defaultTimeoutSeconds: config.defaultTimeoutSeconds ?? 300,
      pollIntervalMs: config.pollIntervalMs ?? 3000,
    };
  }

  /**
   * Query verified web data via TLSNotary.
   *
   * Creates a query, waits for a Worker to fulfill it with a cryptographic
   * proof, verifies the proof, and returns the verified data.
   *
   * @example
   * ```typescript
   * const result = await anchr.query({
   *   description: "BTC price",
   *   targetUrl: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
   *   conditions: [{ type: "jsonpath", expression: "bitcoin.usd" }],
   *   maxSats: 21,
   * });
   * ```
   */
  async query(options: QueryOptions): Promise<QueryResult> {
    // 1. Create query
    const queryId = await this.createQuery(options);

    // 2. Wait for worker to submit result
    const pollTimeout = options.pollTimeoutSeconds ?? options.timeoutSeconds ?? this.config.defaultTimeoutSeconds;
    const deadline = Date.now() + pollTimeout * 1000;

    while (Date.now() < deadline) {
      const status = await this.getQueryStatus(queryId);

      if (status.status === "approved") {
        return this.buildQueryResult(status, options);
      }

      if (status.status === "rejected") {
        throw new VerificationFailedError(
          queryId,
          status.verification?.failures ?? ["Unknown verification failure"],
        );
      }

      if (status.status === "expired") {
        throw new AnchrError(`Query ${queryId} expired`, "EXPIRED");
      }

      await sleep(this.config.pollIntervalMs);
    }

    throw new QueryTimeoutError(queryId, pollTimeout);
  }

  /**
   * Query a verified photo via C2PA.
   *
   * Creates a photo query, waits for a Worker to photograph the location,
   * verifies the C2PA signature and GPS proximity, and returns the result.
   */
  async photo(options: PhotoQueryOptions): Promise<PhotoResult> {
    const queryId = await this.createPhotoQuery(options);
    const photoTimeout = options.timeoutSeconds ?? this.config.defaultTimeoutSeconds;
    const deadline = Date.now() + photoTimeout * 1000;

    while (Date.now() < deadline) {
      const status = await this.getQueryStatus(queryId);

      if (status.status === "approved") {
        return {
          verified: true,
          checks: status.verification?.checks ?? [],
          attachments: status.result?.attachments ?? [],
          notes: status.result?.notes,
          gps: status.result?.gps,
          queryId,
          satsPaid: options.maxSats ?? 0,
        };
      }

      if (status.status === "rejected") {
        throw new VerificationFailedError(queryId, status.verification?.failures ?? []);
      }

      if (status.status === "expired") {
        throw new AnchrError(`Query ${queryId} expired`, "EXPIRED");
      }

      await sleep(this.config.pollIntervalMs);
    }

    throw new QueryTimeoutError(queryId, photoTimeout);
  }

  /**
   * Create a TLSNotary query without waiting for completion.
   * Use `getQueryStatus()` to poll or `waitForQuery()` to block.
   */
  async createTlsnQuery(options: QueryOptions): Promise<string> {
    return this.createQuery(options);
  }

  /**
   * Get the current status of a query.
   */
  async getQueryStatus(queryId: string): Promise<QueryStatusResponse> {
    const res = await this.fetch(`/queries/${queryId}`);
    if (!res.ok) throw new AnchrError(`Failed to get query ${queryId}`, "API_ERROR", { status: res.status });
    return res.json();
  }

  /**
   * List open queries (useful for Workers).
   */
  async listOpenQueries(options?: { lat?: number; lon?: number; maxDistanceKm?: number }): Promise<QuerySummary[]> {
    const params = new URLSearchParams();
    if (options?.lat != null) params.set("lat", String(options.lat));
    if (options?.lon != null) params.set("lon", String(options.lon));
    if (options?.maxDistanceKm != null) params.set("max_distance_km", String(options.maxDistanceKm));
    const qs = params.toString();
    const res = await this.fetch(`/queries${qs ? `?${qs}` : ""}`);
    if (!res.ok) throw new AnchrError("Failed to list queries", "API_ERROR");
    return res.json();
  }

  /**
   * Submit a TLSNotary presentation for a query (Worker API).
   */
  async submitPresentation(queryId: string, presentationBase64: string): Promise<SubmitResponse> {
    const res = await this.fetch(`/queries/${queryId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tlsn_presentation: presentationBase64 }),
    });
    if (!res.ok && res.status >= 500) throw new AnchrError("Submit failed", "API_ERROR");
    return res.json();
  }

  // --- Internal ---

  private async createQuery(options: QueryOptions): Promise<string> {
    const body: Record<string, unknown> = {
      description: options.description,
      verification_requirements: ["tlsn"],
      tlsn_requirements: {
        target_url: options.targetUrl,
        ...(options.conditions?.length && {
          conditions: options.conditions.map((c) => ({
            type: c.type,
            expression: c.expression,
            ...(c.expected !== undefined && { expected: c.expected }),
            ...(c.description && { description: c.description }),
          })),
        }),
        ...(options.maxAttestationAgeSeconds && {
          max_attestation_age_seconds: options.maxAttestationAgeSeconds,
        }),
      },
      ttl_seconds: options.timeoutSeconds ?? this.config.defaultTimeoutSeconds,
    };

    if (options.maxSats) {
      body.bounty = { amount_sats: options.maxSats };
    }

    const res = await this.fetch("/queries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new AnchrError(
        (err as Record<string, string>).error ?? `Failed to create query (${res.status})`,
        "API_ERROR",
        err,
      );
    }

    const data = (await res.json()) as { query_id: string };
    return data.query_id;
  }

  private async createPhotoQuery(options: PhotoQueryOptions): Promise<string> {
    const body: Record<string, unknown> = {
      description: options.description,
      location_hint: options.locationHint,
      expected_gps: options.expectedGps,
      max_gps_distance_km: options.maxGpsDistanceKm,
      ttl_seconds: options.timeoutSeconds ?? this.config.defaultTimeoutSeconds,
    };

    if (options.maxSats) {
      body.bounty = { amount_sats: options.maxSats };
    }

    const res = await this.fetch("/queries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new AnchrError("Failed to create photo query", "API_ERROR");
    const data = (await res.json()) as { query_id: string };
    return data.query_id;
  }

  private buildQueryResult(status: QueryStatusResponse, options: QueryOptions): QueryResult {
    const verified = status.verification?.tlsn_verified;
    const rawBody = verified?.revealed_body ?? "";

    let data: unknown = rawBody;
    try {
      data = JSON.parse(rawBody);
    } catch {
      // not JSON, keep as string
    }

    return {
      verified: status.verification?.passed ?? false,
      serverName: verified?.server_name ?? "",
      data,
      rawBody,
      proof: status.result?.tlsn_attestation?.presentation ?? "",
      timestamp: verified?.session_timestamp ?? 0,
      checks: status.verification?.checks ?? [],
      satsPaid: options.maxSats ?? 0,
      queryId: status.id,
    };
  }

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string>),
    };
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }
    return globalThis.fetch(`${this.config.serverUrl}${path}`, { ...init, headers });
  }
}

// --- Internal types ---

interface QueryStatusResponse {
  id: string;
  status: string;
  description: string;
  verification?: {
    passed: boolean;
    checks: string[];
    failures: string[];
    tlsn_verified?: {
      server_name: string;
      revealed_body: string;
      session_timestamp: number;
    };
  };
  result?: {
    attachments: Array<{ uri: string; mime_type: string }>;
    notes?: string;
    gps?: { lat: number; lon: number };
    tlsn_attestation?: { presentation: string };
  };
  [key: string]: unknown;
}

interface QuerySummary {
  id: string;
  status: string;
  description: string;
  bounty?: { amount_sats: number };
  expires_at: number;
  tlsn_requirements?: { target_url: string };
  [key: string]: unknown;
}

interface SubmitResponse {
  ok: boolean;
  message: string;
  verification?: { passed: boolean; checks: string[]; failures: string[] };
  [key: string]: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Re-export worker
export { AnchrWorker, type AnchrWorkerConfig, type FulfilledEvent } from "./worker";

// Default export
export default Anchr;
