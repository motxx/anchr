/**
 * TLSNotary presentation verification.
 *
 * Delegates cryptographic verification to the `tlsn-verifier` sidecar binary.
 * All verified data (server_name, revealed_body, timestamp) comes from the
 * cryptographic proof — never from worker self-reports.
 *
 * When the binary is not available, verification FAILS (no fake structural fallback).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleDir, which, writeFile, spawn } from "../runtime/mod.ts";
import type { TlsnAttestation, TlsnCondition, TlsnRequirement, TlsnVerifiedData } from "../domain/types";

/**
 * Detect regex patterns likely to cause catastrophic backtracking (ReDoS).
 * Catches: (a+)+, ((a+))+, (a|a)+, (a{1,5})*, nested groups with quantifiers.
 */
export function isSuspiciousRegex(pattern: string): boolean {
  // Strip character classes [...] to avoid false positives on brackets inside them
  const stripped = pattern.replace(/\[(?:[^\]\\]|\\.)*\]/g, "X");
  // 1. Quantified group containing alternation: (a|b)+ (a|b)* (a|b){
  if (/\([^)]*\|[^)]*\)[+*{]/.test(stripped)) return true;
  // 2. Quantifier followed by close-paren(s) followed by quantifier: ...+)+ or ...+))+ etc.
  //    This catches (a+)+, ((a+))+, (a{1,5})+ and any nesting depth.
  if (/[+*}]\)+[+*{]/.test(stripped)) return true;
  return false;
}

export interface TlsnValidationResult {
  available: boolean;
  signatureValid: boolean;
  serverIdentityValid: boolean;
  conditionResults: Array<{ condition: TlsnCondition; passed: boolean; actual_value?: string }>;
  attestationFresh: boolean;
  /** Verified data extracted from the presentation (null if verification failed). */
  verifiedData?: TlsnVerifiedData;
  checks: string[];
  failures: string[];
}

let tlsnVerifierPath: string | null | undefined;

/** Allow tests to override the verifier path. */
export function _setVerifierPathForTest(path: string | null): void {
  tlsnVerifierPath = path;
}

function findTlsnVerifier(): string | null {
  if (tlsnVerifierPath !== undefined) return tlsnVerifierPath;

  // Check project-local binary first (built from crates/tlsn-verifier)
  const localPaths = [
    join(moduleDir(import.meta), "../../crates/tlsn-verifier/target/release/tlsn-verifier"),
    join(moduleDir(import.meta), "../../crates/tlsn-verifier/target/debug/tlsn-verifier"),
  ];
  for (const p of localPaths) {
    try {
      if (statSync(p).isFile()) {
        tlsnVerifierPath = p;
        console.error(`[tlsn] Found tlsn-verifier at ${p}`);
        return tlsnVerifierPath;
      }
    } catch { /* not found */ }
  }

  // Fall back to PATH
  tlsnVerifierPath = which("tlsn-verifier");
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
      // Guard against catastrophic backtracking (ReDoS)
      const pattern = condition.expression;
      if (pattern.length > 500) {
        return { passed: false, actual_value: "regex pattern too long (max 500 chars)" };
      }
      // Reject patterns with nested quantifiers that cause exponential backtracking.
      // Covers: (a+)+, ((a+))+, (a|a)+, (a{1,5})*, etc.
      if (isSuspiciousRegex(pattern)) {
        return { passed: false, actual_value: "regex rejected: potential ReDoS pattern detected" };
      }
      try {
        const re = new RegExp(pattern);
        const match = re.exec(body);
        return { passed: match !== null, actual_value: match?.[0] };
      } catch {
        return { passed: false, actual_value: "invalid regex pattern" };
      }
    }
    case "jsonpath": {
      try {
        const obj = JSON.parse(body);
        const value = resolveDotPath(obj, condition.expression);
        if (value === undefined) return { passed: false };
        const actual = String(value);
        if (condition.expected !== undefined) {
          return { passed: actual === condition.expected, actual_value: actual };
        }
        return { passed: true, actual_value: actual };
      } catch {
        return { passed: false, actual_value: "invalid JSON" };
      }
    }
    default:
      return { passed: false };
  }
}

/** Blocked property names to prevent prototype chain traversal. */
const BLOCKED_PROPS = new Set(["__proto__", "constructor", "prototype"]);

function resolveDotPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    if (BLOCKED_PROPS.has(part)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export async function validateTlsn(
  attestation: TlsnAttestation,
  requirement: TlsnRequirement,
): Promise<TlsnValidationResult> {
  const checks: string[] = [];
  const failures: string[] = [];
  const maxAgeSeconds = requirement.max_attestation_age_seconds ?? DEFAULT_MAX_AGE_SECONDS;

  const verifierPath = findTlsnVerifier();

  // --- Binary required ---
  if (!verifierPath) {
    failures.push("TLSNotary: tlsn-verifier binary not available — cannot verify presentation");
    return {
      available: false,
      signatureValid: false,
      serverIdentityValid: false,
      conditionResults: [],
      attestationFresh: false,
      checks,
      failures,
    };
  }

  // --- Cryptographic verification ---
  const cryptoResult = await runVerifierBinary(verifierPath, attestation);
  if (!cryptoResult.signatureValid) {
    failures.push(`TLSNotary: presentation signature invalid — ${cryptoResult.error ?? "verification failed"}`);
    return {
      available: true,
      signatureValid: false,
      serverIdentityValid: false,
      conditionResults: [],
      attestationFresh: false,
      checks,
      failures,
    };
  }

  checks.push("TLSNotary: presentation signature valid (cryptographically verified)");

  const verifiedServerName = cryptoResult.verifiedServerName;
  const verifiedBody = cryptoResult.verifiedBody ?? "";
  const verifiedTime = cryptoResult.verifiedTime; // unix seconds

  // --- Server identity / domain matching ---
  let serverIdentityValid = false;
  const expectedHostname = requirement.domain_hint ?? extractHostname(requirement.target_url);
  if (expectedHostname && verifiedServerName === expectedHostname) {
    checks.push(`TLSNotary: server name matches target (${expectedHostname})`);
    serverIdentityValid = true;
  } else if (expectedHostname) {
    failures.push(`TLSNotary: server name "${verifiedServerName ?? "unknown"}" does not match target "${expectedHostname}"`);
  }

  // --- Freshness check (using verified timestamp from the proof) ---
  let attestationFresh = false;
  if (verifiedTime != null) {
    const ageMs = Date.now() - verifiedTime * 1000;
    attestationFresh = ageMs >= 0 && ageMs < maxAgeSeconds * 1000;
    if (attestationFresh) {
      checks.push(`TLSNotary: attestation fresh (${Math.round(ageMs / 1000)}s old, max ${maxAgeSeconds}s)`);
    } else {
      failures.push(`TLSNotary: attestation too old (${Math.round(ageMs / 1000)}s, max ${maxAgeSeconds}s)`);
    }
  } else {
    checks.push("TLSNotary: no timestamp in proof — freshness check skipped");
    attestationFresh = true; // no timestamp to check
  }

  // --- Condition evaluation (using cryptographically verified body) ---
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
    available: true,
    signatureValid: true,
    serverIdentityValid,
    conditionResults,
    attestationFresh,
    verifiedData: {
      server_name: verifiedServerName ?? "",
      revealed_body: verifiedBody,
      revealed_headers: cryptoResult.verifiedHeaders,
      session_timestamp: verifiedTime ?? 0,
    },
    checks,
    failures,
  };
}

// --- Sidecar binary interaction ---

interface VerifierBinaryResult {
  signatureValid: boolean;
  verifiedServerName?: string;
  verifiedBody?: string;
  verifiedHeaders?: string;
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
    const presentationData = Buffer.from(attestation.presentation, "base64");
    await writeFile(presentationPath, presentationData);

    const proc = spawn([verifierPath, "verify", presentationPath], {
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
        revealed_headers?: string;
        time?: number;
        error?: string;
      };
      return {
        signatureValid: result.valid === true,
        verifiedServerName: result.server_name ?? undefined,
        verifiedBody: result.revealed_body ?? undefined,
        verifiedHeaders: result.revealed_headers ?? undefined,
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
