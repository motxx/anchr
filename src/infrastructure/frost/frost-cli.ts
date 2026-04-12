/**
 * FROST signer CLI wrapper.
 *
 * Delegates all cryptographic operations to the frost-signer Rust binary.
 * TypeScript is glue only -- zero new crypto implementation.
 */

import { statSync } from "node:fs";
import { join } from "node:path";
import { moduleDir, which, spawn } from "../../runtime/mod.ts";

let frostSignerPath: string | null | undefined;

/** Allow tests to override the binary path. */
export function _setFrostSignerPathForTest(path: string | null): void {
  frostSignerPath = path;
}

/** Find the frost-signer binary: project-local first, then PATH. */
export function findFrostSigner(): string | null {
  if (frostSignerPath !== undefined) return frostSignerPath;

  const localPaths = [
    join(moduleDir(import.meta), "../../../crates/frost-signer/target/release/frost-signer"),
    join(moduleDir(import.meta), "../../../crates/frost-signer/target/debug/frost-signer"),
  ];
  for (const p of localPaths) {
    try {
      if (statSync(p).isFile()) {
        frostSignerPath = p;
        console.error(`[frost] Found frost-signer at ${p}`);
        return frostSignerPath;
      }
    } catch { /* not found */ }
  }

  frostSignerPath = which("frost-signer");
  if (frostSignerPath) {
    console.error(`[frost] Found frost-signer at ${frostSignerPath}`);
  }
  return frostSignerPath;
}

export function isFrostSignerAvailable(): boolean {
  return findFrostSigner() !== null;
}

const FROST_TIMEOUT_MS = 30_000;

interface FrostCliResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/** Run a frost-signer subcommand with the given args. */
export async function runFrostCommand(
  subcommand: string,
  args: string[],
): Promise<FrostCliResult> {
  const binPath = findFrostSigner();
  if (!binPath) {
    return { ok: false, error: "frost-signer binary not available" };
  }

  const proc = spawn([binPath, subcommand, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  let timer: ReturnType<typeof setTimeout>;
  const timedOut = await Promise.race([
    proc.exited.then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), FROST_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer!);

  if (timedOut) {
    proc.kill();
    return { ok: false, error: `frost-signer timed out after ${FROST_TIMEOUT_MS / 1000}s` };
  }

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (proc.exitCode !== 0) {
    return { ok: false, error: stderr.trim().slice(0, 500) || "frost-signer exited with error" };
  }

  try {
    const data = JSON.parse(stdout);
    return { ok: true, data };
  } catch {
    return { ok: false, error: "failed to parse frost-signer output" };
  }
}

// --- DKG convenience wrappers ---

export async function dkgRound1(index: number, maxSigners: number, minSigners: number) {
  return runFrostCommand("dkg-round1", [
    "--index", String(index),
    "--max-signers", String(maxSigners),
    "--min-signers", String(minSigners),
  ]);
}

export async function dkgRound2(secretPackage: string, round1Packages: string) {
  return runFrostCommand("dkg-round2", [
    "--secret-package", secretPackage,
    "--round1-packages", round1Packages,
  ]);
}

export async function dkgRound3(
  round2SecretPackage: string,
  round1Packages: string,
  round2Packages: string,
) {
  return runFrostCommand("dkg-round3", [
    "--round2-secret-package", round2SecretPackage,
    "--round1-packages", round1Packages,
    "--round2-packages", round2Packages,
  ]);
}

// --- Signing convenience wrappers ---

export async function signRound1(keyPackage: string) {
  return runFrostCommand("sign-round1", ["--key-package", keyPackage]);
}

export async function signRound2(
  keyPackage: string,
  nonces: string,
  commitments: string,
  message: string,
) {
  return runFrostCommand("sign-round2", [
    "--key-package", keyPackage,
    "--nonces", nonces,
    "--commitments", commitments,
    "--message", message,
  ]);
}

export async function aggregateSignatures(
  groupPubkey: string,
  commitments: string,
  message: string,
  signatureShares: string,
  pubkeyPackage: string,
) {
  return runFrostCommand("aggregate", [
    "--group-pubkey", groupPubkey,
    "--commitments", commitments,
    "--message", message,
    "--signature-shares", signatureShares,
    "--pubkey-package", pubkeyPackage,
  ]);
}

export async function verifySignature(
  groupPubkey: string,
  signature: string,
  message: string,
) {
  return runFrostCommand("verify", [
    "--group-pubkey", groupPubkey,
    "--signature", signature,
    "--message", message,
  ]);
}
