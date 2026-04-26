/**
 * TLSNotary application-layer types — canonical location for tlsn-toolkit
 * and any host that wires it in.
 *
 * Previously lived in the host shared domain module, but TLSNotary is the
 * package's concern and host servers should import from here.
 */

/** A single condition the verifier evaluates against the revealed body. */
export interface TlsnCondition {
  type: "contains" | "regex" | "jsonpath";
  expression: string;
  expected?: string;
  description?: string;
}

/** Requirements a Requester places on a TLSNotary-backed query. */
export interface TlsnRequirement {
  target_url: string;
  method?: "GET" | "POST";
  conditions?: TlsnCondition[];
  /** Max age of attestation in seconds (default: 300). */
  max_attestation_age_seconds?: number;
  /** Domain hint for public display when actual URL is delivered via encrypted_context. */
  domain_hint?: string;
}

/** Sensitive context encrypted to Worker — never stored publicly. */
export interface TlsnEncryptedContext {
  /** The actual target URL (may contain session IDs). */
  target_url: string;
  /** Custom HTTP headers (e.g., Authorization). */
  headers?: Record<string, string>;
  /** HTTP method override (default: GET). */
  method?: "GET" | "POST";
  /** Request body for POST requests. */
  body?: string;
}

/** Worker-submitted TLSNotary presentation, base64-encoded. */
export interface TlsnAttestation {
  /** Base64-encoded TLSNotary presentation file (.presentation.tlsn). */
  presentation: string;
}

/** Cryptographically verified data extracted from a TLSNotary presentation. */
export interface TlsnVerifiedData {
  server_name: string;
  revealed_body: string;
  revealed_headers?: string;
  /** Session timestamp (unix seconds, from the cryptographic proof). */
  session_timestamp: number;
}
