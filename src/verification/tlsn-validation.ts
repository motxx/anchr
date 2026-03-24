/**
 * TLSNotary attestation validation.
 *
 * In production, delegates cryptographic verification to a `tlsn-verifier` sidecar binary.
 * When the binary is not available, performs structural validation (notary trust, freshness,
 * domain matching, condition evaluation) — crypto verification is deferred.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TlsnAttestation, TlsnCondition, TlsnRequirement } from "../types";

export interface TlsnValidationResult {
  available: boolean;
  signatureValid: boolean;
  notaryTrusted: boolean;
  serverIdentityValid: boolean;
  conditionResults: Array<{ condition: TlsnCondition; passed: boolean; actual_value?: string }>;
  attestationFresh: boolean;
  checks: string[];
  failures: string[];
}

let tlsnVerifierPath: string | null | undefined;

function findTlsnVerifier(): string | null {
  if (tlsnVerifierPath !== undefined) return tlsnVerifierPath;

  // Check project-local binary first (built from crates/tlsn-verifier)
  const localPaths = [
    join(import.meta.dir, "../../.local/bin/tlsn-verifier"),
    join(import.meta.dir, "../../crates/tlsn-verifier/target/release/tlsn-verifier"),
    join(import.meta.dir, "../../crates/tlsn-verifier/target/debug/tlsn-verifier"),
  ];
  for (const p of localPaths) {
    if (Bun.which(p) || (typeof Bun.file === "function" && Bun.file(p).size > 0)) {
      try {
        const stat = require("node:fs").statSync(p);
        if (stat.isFile()) {
          tlsnVerifierPath = p;
          console.error(`[tlsn] Found tlsn-verifier at ${p}`);
          return tlsnVerifierPath;
        }
      } catch { /* not found */ }
    }
  }

  // Fall back to PATH
  tlsnVerifierPath = Bun.which("tlsn-verifier");
  if (tlsnVerifierPath) {
    console.error(`[tlsn] Found tlsn-verifier at ${tlsnVerifierPath}`);
  }
  return tlsnVerifierPath;
}

export function isTlsnVerifierAvailable(): boolean {
  return findTlsnVerifier() !== null;
}

/** Default max attestation age: 5 minutes. */
const DEFAULT_MAX_AGE_SECONDS = 300;

/**
 * Extract the hostname from a URL string.
 */
function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Evaluate a single condition against the revealed body.
 */
export function evaluateCondition(
  condition: TlsnCondition,
  body: string,
): { passed: boolean; actual_value?: string } {
  switch (condition.type) {
    case "contains": {
      const passed = body.includes(condition.expression);
      return { passed, actual_value: passed ? condition.expression : undefined };
    }
    case "regex": {
      const re = new RegExp(condition.expression);
      const match = re.exec(body);
      return { passed: match !== null, actual_value: match?.[0] };
    }
    case "jsonpath": {
      // Simple dot-notation path evaluation (no external deps)
      try {
        const obj = JSON.parse(body);
        const value = resolveDotPath(obj, condition.expression);
        if (value === undefined) {
          return { passed: false };
        }
        const actual = String(value);
        if (condition.expected !== undefined) {
          return { passed: actual === condition.expected, actual_value: actual };
        }
        // No expected value — just check existence
        return { passed: true, actual_value: actual };
      } catch {
        return { passed: false, actual_value: "invalid JSON" };
      }
    }
    default:
      return { passed: false };
  }
}

/**
 * Resolve a dot-notation path against an object.
 * E.g. "bitcoin.usd" on { bitcoin: { usd: 42000 } } → 42000
 */
function resolveDotPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export async function validateTlsn(
  attestation: TlsnAttestation,
  requirement: TlsnRequirement,
  trustedNotaryPubkeys: string[],
): Promise<TlsnValidationResult> {
  const checks: string[] = [];
  const failures: string[] = [];
  const maxAgeSeconds = requirement.max_attestation_age_seconds ?? DEFAULT_MAX_AGE_SECONDS;

  const verifierPath = findTlsnVerifier();

  let signatureValid = false;
  let notaryTrusted = false;
  let serverIdentityValid = false;

  // --- Cryptographic verification via sidecar binary ---
  // When the binary is available, it provides cryptographically verified server_name
  // and revealed_body that override the self-reported values from the attestation.
  let verifiedBody = attestation.revealed_body;
  let verifiedServerName = attestation.server_name;

  if (verifierPath) {
    const cryptoResult = await runVerifierBinary(verifierPath, attestation);
    signatureValid = cryptoResult.signatureValid;
    if (signatureValid) {
      checks.push("TLSNotary: presentation signature valid (cryptographically verified)");
      // Use cryptographically verified values instead of self-reported ones
      if (cryptoResult.verifiedServerName) {
        verifiedServerName = cryptoResult.verifiedServerName;
      }
      if (cryptoResult.verifiedBody) {
        verifiedBody = cryptoResult.verifiedBody;
      }
    } else {
      failures.push(`TLSNotary: presentation signature invalid — ${cryptoResult.error ?? "verification failed"}`);
    }
  } else {
    checks.push("TLSNotary: tlsn-verifier not available — crypto verification deferred");
  }

  // --- Notary trust check ---
  if (trustedNotaryPubkeys.length === 0) {
    checks.push("TLSNotary: no trusted notary pubkeys configured — trust check skipped");
    notaryTrusted = true;
  } else if (trustedNotaryPubkeys.includes(attestation.notary_pubkey)) {
    checks.push("TLSNotary: notary pubkey is trusted");
    notaryTrusted = true;
  } else {
    failures.push("TLSNotary: notary pubkey not in trusted set");
  }

  // --- Server identity / domain matching ---
  // Use cryptographically verified server name when available
  const expectedHostname = extractHostname(requirement.target_url);
  if (expectedHostname && verifiedServerName === expectedHostname) {
    checks.push(`TLSNotary: server name matches target (${expectedHostname})`);
    serverIdentityValid = true;
  } else if (expectedHostname) {
    failures.push(`TLSNotary: server name "${verifiedServerName}" does not match target "${expectedHostname}"`);
  }

  // --- Freshness check ---
  const ageMs = Date.now() - attestation.session_timestamp;
  const attestationFresh = ageMs >= 0 && ageMs < maxAgeSeconds * 1000;
  if (attestationFresh) {
    checks.push(`TLSNotary: attestation fresh (${Math.round(ageMs / 1000)}s old, max ${maxAgeSeconds}s)`);
  } else {
    failures.push(`TLSNotary: attestation too old (${Math.round(ageMs / 1000)}s, max ${maxAgeSeconds}s)`);
  }

  // --- Condition evaluation ---
  // Use cryptographically verified body when available
  const conditionResults: TlsnValidationResult["conditionResults"] = [];
  if (requirement.conditions) {
    for (const condition of requirement.conditions) {
      const result = evaluateCondition(condition, verifiedBody);
      conditionResults.push({ condition, ...result });
      const label = condition.description ?? `${condition.type}:${condition.expression}`;
      if (result.passed) {
        checks.push(`TLSNotary condition passed: ${label}`);
      } else {
        failures.push(`TLSNotary condition failed: ${label}`);
      }
    }
  }

  return {
    available: verifierPath !== null,
    signatureValid,
    notaryTrusted,
    serverIdentityValid,
    conditionResults,
    attestationFresh,
    checks,
    failures,
  };
}

// --- Sidecar binary interaction ---

interface VerifierBinaryResult {
  signatureValid: boolean;
  /** Server name extracted from the cryptographic proof (if available). */
  verifiedServerName?: string;
  /** HTTP response body extracted from the revealed transcript. */
  verifiedBody?: string;
  /** Session timestamp from the proof (unix seconds). */
  verifiedTime?: number;
  error?: string;
}

async function runVerifierBinary(
  verifierPath: string,
  attestation: TlsnAttestation,
): Promise<VerifierBinaryResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "anchr-tlsn-"));
  const presentationPath = join(tempDir, "presentation.tlsn");

  try {
    // Write base64-decoded presentation to temp file
    const presentationData = Buffer.from(attestation.attestation_doc, "base64");
    await Bun.write(presentationPath, presentationData);

    const proc = Bun.spawn([verifierPath, "verify", presentationPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    if (proc.exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      return { signatureValid: false, error: stderr.trim().slice(0, 200) };
    }

    const stdout = await new Response(proc.stdout).text();
    try {
      const result = JSON.parse(stdout) as {
        valid?: boolean;
        server_name?: string;
        revealed_body?: string;
        time?: number;
        error?: string;
      };
      return {
        signatureValid: result.valid === true,
        verifiedServerName: result.server_name ?? undefined,
        verifiedBody: result.revealed_body ?? undefined,
        verifiedTime: result.time ?? undefined,
        error: result.error ?? undefined,
      };
    } catch {
      return { signatureValid: false, error: "failed to parse verifier output" };
    }
  } catch (err) {
    return { signatureValid: false, error: String(err) };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
