/**
 * Public types for the convenience `Anchr` HTTP client surface
 * (`anchr.request()` / `anchr.photo()`). The Customer / Provider API
 * lives in the sibling files.
 */

export interface AnchrConfig {
  /** Anchr server URL (e.g. "http://localhost:3000" or "https://anchr.example.com") */
  serverUrl: string;
  /** API key for write endpoints (optional if server has no auth) */
  apiKey?: string;
  /** Default timeout for requests in seconds (default: 300) */
  defaultTimeoutSeconds?: number;
  /** Polling interval in milliseconds (default: 3000) */
  pollIntervalMs?: number;
}

export interface HttpRequestOptions {
  description: string;
  targetUrl: string;
  conditions?: RequestCondition[];
  maxSats?: number;
  /** Server-side TTL in seconds (minimum 60, default 300) */
  timeoutSeconds?: number;
  /** Client-side polling timeout in seconds (default: same as timeoutSeconds) */
  pollTimeoutSeconds?: number;
  maxAttestationAgeSeconds?: number;
  /**
   * When set, the public request shows only the domain; the full targetUrl
   * (potentially carrying credentials or session IDs) is delivered to the
   * selected Worker via NIP-44 encrypted_context.
   */
  domainHint?: string;
}

export interface RequestCondition {
  type: "contains" | "regex" | "jsonpath";
  expression: string;
  /** Expected value (for jsonpath comparison) */
  expected?: string;
  description?: string;
}

export interface HttpRequestResult {
  verified: boolean;
  /** Server name from the TLS certificate (cryptographically verified) */
  serverName: string;
  /** Response body (cryptographically verified, JSON-parsed when possible) */
  data: unknown;
  rawBody: string;
  /** TLSNotary presentation (base64, for independent verification) */
  proof: string;
  timestamp: number;
  checks: string[];
  satsPaid: number;
  requestId: string;
}

export interface PhotoRequestOptions {
  description: string;
  locationHint?: string;
  expectedGps?: { lat: number; lon: number };
  maxGpsDistanceKm?: number;
  maxSats?: number;
  timeoutSeconds?: number;
}

export interface PhotoResult {
  verified: boolean;
  checks: string[];
  attachments: Array<{ uri: string; mimeType: string }>;
  notes?: string;
  gps?: { lat: number; lon: number };
  requestId: string;
  satsPaid: number;
}

// --- Internal types — used by the client implementation ---

export interface RequestStatusResponse {
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

export interface RequestSummary {
  id: string;
  status: string;
  description: string;
  bounty?: { amount_sats: number };
  expires_at: number;
  tlsn_requirements?: {
    target_url: string;
    domain_hint?: string;
    conditions?: Array<
      {
        type: string;
        expression: string;
        expected?: string;
        description?: string;
      }
    >;
    max_attestation_age_seconds?: number;
  };
  [key: string]: unknown;
}

export interface SubmitResponse {
  ok: boolean;
  message: string;
  verification?: { passed: boolean; checks: string[]; failures: string[] };
  [key: string]: unknown;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
