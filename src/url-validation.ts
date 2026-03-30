/**
 * Validates attachment URIs to prevent SSRF attacks.
 *
 * Rejects:
 * - Non-HTTPS schemes (except http://localhost for dev)
 * - Private/internal IP ranges
 */

const PRIVATE_IP_PATTERNS = [
  /^127\./, // loopback
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // link-local
  /^0\./, // 0.0.0.0/8
];

function isPrivateIp(hostname: string): boolean {
  if (hostname === "::1" || hostname === "[::1]") return true;
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) return true;
  }
  return false;
}

/**
 * Validates a URI for safe server-side use (redirect or fetch).
 * Returns null if valid, or an error message string if invalid.
 */
export function validateAttachmentUri(uri: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return "Invalid URL";
  }

  const isLocalhost =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";

  // Allow http only for localhost (dev), otherwise require https
  if (parsed.protocol === "http:" && !isLocalhost) {
    return "Only HTTPS URLs are allowed";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "Only HTTPS URLs are allowed";
  }

  // Reject private/internal IPs (except localhost for dev)
  if (!isLocalhost && isPrivateIp(parsed.hostname)) {
    return "URLs pointing to private/internal networks are not allowed";
  }

  return null;
}
