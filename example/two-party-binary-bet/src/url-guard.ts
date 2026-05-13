/**
 * URL validation for two-party-binary-bet truth sources.
 *
 * Wraps `validateAttachmentUri` from src/infrastructure with stricter rules:
 *   - **Always** rejects loopback / private / link-local addresses, even in
 *     development mode. A truth source for a two-party binary bet is by definition
 *     a public-internet HTTPS endpoint — pointing at `127.0.0.1` is either an
 *     SSRF attempt or a misconfiguration.
 *   - Allows http://localhost only when `ALLOW_LOCAL_TRUTH_SOURCES=1` (e.g.
 *     for tests with a mock server). The env var must be set explicitly so
 *     production deploys can't accidentally allow it.
 */
import { validateAttachmentUri } from "@anchr/bounty/url-validation";

const PRIVATE_HOST_RE = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
];

function isPrivateOrLoopbackHost(hostname: string): boolean {
  if (hostname === "localhost") return true;
  if (hostname === "::1" || hostname === "[::1]") return true;
  const lower = hostname.toLowerCase();
  if (
    lower.startsWith("fe80:") || lower.startsWith("fc00:") ||
    lower.startsWith("fd00:")
  ) {
    return true;
  }
  if (
    lower.startsWith("[fe80:") || lower.startsWith("[fc00:") ||
    lower.startsWith("[fd00:")
  ) {
    return true;
  }
  for (const re of PRIVATE_HOST_RE) {
    if (re.test(hostname)) return true;
  }
  return false;
}

/**
 * Validate a URL operator-supplied as a market truth source. Returns null
 * on success, error message on failure.
 */
export function validateTruthSourceUrl(uri: string): string | null {
  const baseError = validateAttachmentUri(uri);
  if (baseError) return baseError;

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return "Invalid URL";
  }

  const allowLocal = Deno.env.get("ALLOW_LOCAL_TRUTH_SOURCES") === "1";

  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    if (!allowLocal) {
      return "Truth source must be a public host (set ALLOW_LOCAL_TRUTH_SOURCES=1 to override for tests)";
    }
  }

  // TLSNotary requires HTTPS so the resolution path can later be proved.
  if (parsed.protocol !== "https:" && !allowLocal) {
    return "Truth source URL must use https://";
  }

  return null;
}
