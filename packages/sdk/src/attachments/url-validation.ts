/**
 * Validates attachment URIs to prevent SSRF attacks.
 *
 * Rejects:
 * - Non-HTTPS schemes (except http to loopback in explicit dev mode)
 * - Loopback hosts, unless `ANCHR_ALLOW_LOCALHOST_ATTACHMENTS=1` opts in
 * - Private/internal IPv4 and IPv6 ranges
 * - IPv6-mapped IPv4 addresses (::ffff:127.0.0.1, hex form included)
 * - URLs with embedded credentials (user:pass@host)
 *
 * The guard is default-secure: loopback targets are rejected unless the
 * Deno-native dev opt-in is set; no NODE_ENV-style production switch.
 */

const PRIVATE_IPV4_PATTERNS = [
  /^127\./, // loopback
  /^10\./, // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./, // 192.168.0.0/16
  /^169\.254\./, // link-local
  /^0\./, // 0.0.0.0/8
];

/** Strip square brackets from IPv6 hostnames for uniform checking. */
function stripBrackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function isPrivateIp(hostname: string): boolean {
  const raw = stripBrackets(hostname);

  // IPv6 loopback
  if (raw === "::1") return true;

  // IPv6 private ranges: link-local (fe80::), unique-local (fc00::/fd00::)
  const lower = raw.toLowerCase();
  if (lower.startsWith("fe80:")) return true;
  if (lower.startsWith("fc00:") || lower.startsWith("fd00:")) return true;

  // IPv6-mapped IPv4: browsers/runtimes may normalize ::ffff:A.B.C.D to ::ffff:XXYY:ZZWW (hex).
  // Check both dotted-decimal and hex forms.
  const v4DottedMapped = lower.match(
    /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/,
  );
  if (v4DottedMapped) {
    const ipv4 = v4DottedMapped[1]!;
    for (const pattern of PRIVATE_IPV4_PATTERNS) {
      if (pattern.test(ipv4)) return true;
    }
    return false;
  }
  // Hex form: ::ffff:XXYY:ZZWW — convert to dotted decimal and check
  const v4HexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4HexMapped) {
    const hi = parseInt(v4HexMapped[1]!, 16);
    const lo = parseInt(v4HexMapped[2]!, 16);
    const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${
      lo & 0xff
    }`;
    for (const pattern of PRIVATE_IPV4_PATTERNS) {
      if (pattern.test(ipv4)) return true;
    }
    return false;
  }

  // Plain IPv4 private ranges
  for (const pattern of PRIVATE_IPV4_PATTERNS) {
    if (pattern.test(raw)) return true;
  }

  return false;
}

/** Loopback hosts in every spelling the URL parser can hand us. */
function isLoopback(hostname: string): boolean {
  const raw = stripBrackets(hostname).toLowerCase();
  if (raw === "localhost" || raw === "::1") return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(raw)) return true;
  if (/^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(raw)) return true;
  // Hex-mapped ::ffff:7fXX:YYYY (127.x.y.z)
  if (/^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(raw)) return true;
  return false;
}

function loopbackAllowed(): boolean {
  return Deno.env.get("ANCHR_ALLOW_LOCALHOST_ATTACHMENTS") === "1";
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

  // Reject URLs with embedded credentials
  if (parsed.username || parsed.password) {
    return "URLs with embedded credentials are not allowed";
  }

  const loopback = isLoopback(parsed.hostname);

  // Default-secure: loopback targets need the explicit dev opt-in.
  if (loopback && !loopbackAllowed()) {
    return "URLs pointing to localhost are not allowed " +
      "(set ANCHR_ALLOW_LOCALHOST_ATTACHMENTS=1 for local development)";
  }

  // Allow http only toward loopback in dev mode; otherwise require https
  if (parsed.protocol === "http:" && !loopback) {
    return "Only HTTPS URLs are allowed";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "Only HTTPS URLs are allowed";
  }

  // Reject private/internal IPs (loopback handled above)
  if (!loopback && isPrivateIp(parsed.hostname)) {
    return "URLs pointing to private/internal networks are not allowed";
  }

  return null;
}
