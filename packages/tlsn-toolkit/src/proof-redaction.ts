/**
 * Safety checks for public proof publishing.
 *
 * Selective disclosure is handled at the TLSNotary protocol level:
 * the prover's `--redact-sent-header` flag omits sensitive header values
 * from the cryptographic presentation. The verifier renders redacted
 * bytes as [REDACTED].
 *
 * This module provides a post-verification safety net: if credentials
 * somehow survive into the verified output, we block the publish.
 */

/** Header names that should be redacted at the prover level. */
export const SENSITIVE_HEADER_NAMES = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "proxy-authorization",
  "x-csrf-token",
  "x-xsrf-token",
];

/** Patterns that indicate credential leakage in verified output. */
const CREDENTIAL_PATTERNS = [
  /bearer\s+[a-z0-9\-_.]+/i,
  /basic\s+[a-z0-9+/=]+/i,
  /token[=:]\s*[a-z0-9\-_.]+/i,
  /api[_-]?key[=:]\s*[a-z0-9\-_.]+/i,
  /session[_-]?id[=:]\s*[a-z0-9\-_.]+/i,
];

/**
 * Safety net: validate that a text string does not contain credential patterns.
 * Returns an error message if credentials are detected, null if safe.
 *
 * Note: In the current architecture, request-side credential redaction is
 * handled at the TLSNotary protocol level (--redact-sent-header).
 * This function is available for ad-hoc checks but is not used in the
 * publish pipeline since revealed_headers/body are response data.
 */
export function validateNoCredentials(text: string): string | null {
  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(text)) {
      return `Credential pattern detected in verified output: ${pattern.source}`;
    }
  }
  return null;
}
