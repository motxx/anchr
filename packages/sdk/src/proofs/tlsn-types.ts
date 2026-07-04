/** A single condition the verifier evaluates against the revealed body. */
export interface TlsnCondition {
  type: "contains" | "regex" | "jsonpath";
  expression: string;
  expected?: string;
  description?: string;
}

/** Requirements a Customer places on a TLSNotary-backed query. */
export interface TlsnRequirement {
  target_url: string;
  method?: "GET" | "POST";
  conditions?: TlsnCondition[];
  /** Max age of attestation in seconds (default: 300). */
  max_attestation_age_seconds?: number;
  /** Domain hint for public display. */
  domain_hint?: string;
}

/** Provider-submitted TLSNotary presentation, base64-encoded. */
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

export interface TlsnExtensionResultEntry {
  type: string;
  part: string;
  value: string;
}

/** TLSNotary browser extension result from an MPC-TLS session. */
export interface TlsnExtensionResult {
  presentation?: string;
  results?: readonly TlsnExtensionResultEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHttpMethod(value: unknown): value is "GET" | "POST" {
  return value === "GET" || value === "POST";
}

export function isTlsnCondition(value: unknown): value is TlsnCondition {
  if (!isRecord(value)) return false;
  if (
    value.type !== "contains" && value.type !== "regex" &&
    value.type !== "jsonpath"
  ) {
    return false;
  }
  if (typeof value.expression !== "string") return false;
  if (value.expected !== undefined && typeof value.expected !== "string") {
    return false;
  }
  if (
    value.description !== undefined && typeof value.description !== "string"
  ) {
    return false;
  }
  return true;
}

export function isTlsnRequirement(value: unknown): value is TlsnRequirement {
  if (!isRecord(value)) return false;
  if (typeof value.target_url !== "string") return false;
  if (value.method !== undefined && !isHttpMethod(value.method)) return false;
  if (
    value.conditions !== undefined &&
    (!Array.isArray(value.conditions) ||
      !value.conditions.every(isTlsnCondition))
  ) {
    return false;
  }
  if (
    value.max_attestation_age_seconds !== undefined &&
    typeof value.max_attestation_age_seconds !== "number"
  ) {
    return false;
  }
  if (
    value.domain_hint !== undefined && typeof value.domain_hint !== "string"
  ) {
    return false;
  }
  return true;
}

export function isTlsnAttestation(value: unknown): value is TlsnAttestation {
  return isRecord(value) && typeof value.presentation === "string";
}

export function isTlsnExtensionResultEntry(
  value: unknown,
): value is TlsnExtensionResultEntry {
  return isRecord(value) &&
    typeof value.type === "string" &&
    typeof value.part === "string" &&
    typeof value.value === "string";
}

export function isTlsnExtensionResult(
  value: unknown,
): value is TlsnExtensionResult {
  if (!isRecord(value)) return false;
  if (
    value.presentation !== undefined && typeof value.presentation !== "string"
  ) {
    return false;
  }
  if (
    value.results !== undefined &&
    (!Array.isArray(value.results) ||
      !value.results.every(isTlsnExtensionResultEntry))
  ) {
    return false;
  }
  return value.presentation !== undefined || value.results !== undefined;
}

export function isTlsnVerifiedData(value: unknown): value is TlsnVerifiedData {
  return isRecord(value) &&
    typeof value.server_name === "string" &&
    typeof value.revealed_body === "string" &&
    (value.revealed_headers === undefined ||
      typeof value.revealed_headers === "string") &&
    typeof value.session_timestamp === "number";
}
