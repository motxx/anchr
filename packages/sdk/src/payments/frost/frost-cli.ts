/**
 * FROST signer CLI wrapper.
 *
 * Delegates all cryptographic operations to the frost-signer Rust binary.
 * TypeScript is glue only -- zero new crypto implementation.
 */

import { join } from "node:path";

import { getLogger } from "../../internal/runtime/logger.ts";
const log = getLogger(["anchr", "frost"]);

/** Find the frost-signer binary: project-local first, then PATH. */
export function findFrostSigner(): string | null {
  const here = new URL(".", import.meta.url).pathname;
  const localPaths = [
    join(
      here,
      "../../../../../crates/frost-signer/target/release/frost-signer",
    ),
    join(
      here,
      "../../../../../crates/frost-signer/target/debug/frost-signer",
    ),
  ];
  for (const p of localPaths) {
    try {
      if (Deno.statSync(p).isFile) {
        log.error(`Found frost-signer at ${p}`);
        return p;
      }
    } catch { /* not found */ }
  }

  const onPath = findOnPath("frost-signer");
  if (onPath) {
    log.error(`Found frost-signer at ${onPath}`);
  }
  return onPath;
}

export function isFrostSignerAvailable(): boolean {
  return findFrostSigner() !== null;
}

/**
 * Resolve the binary path: an explicit override (a path string, or `null` to
 * force "unavailable") takes precedence; `undefined` falls back to
 * auto-detection.
 */
function resolveFrostSigner(frostSignerPath?: string | null): string | null {
  return frostSignerPath === undefined ? findFrostSigner() : frostSignerPath;
}

const FROST_TIMEOUT_MS = 30_000;

export interface FrostCliResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/** Run a frost-signer subcommand with the given args. */
export async function runFrostCommand(
  subcommand: string,
  args: string[],
  frostSignerPath?: string | null,
): Promise<FrostCliResult> {
  const binPath = resolveFrostSigner(frostSignerPath);
  if (!binPath) {
    return { ok: false, error: "frost-signer binary not available" };
  }

  const proc = new Deno.Command(binPath, {
    args: [subcommand, ...args],
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  let timer: ReturnType<typeof setTimeout>;
  const statusPromise = proc.status;
  const timedOut = await Promise.race([
    statusPromise.then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), FROST_TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer!);

  if (timedOut) {
    proc.kill();
    return {
      ok: false,
      error: `frost-signer timed out after ${FROST_TIMEOUT_MS / 1000}s`,
    };
  }

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  const status = await statusPromise;
  if (status.code !== 0) {
    return {
      ok: false,
      error: stderr.trim().slice(0, 500) || "frost-signer exited with error",
    };
  }

  try {
    const data = JSON.parse(stdout);
    return { ok: true, data };
  } catch {
    return { ok: false, error: "failed to parse frost-signer output" };
  }
}

function findOnPath(name: string): string | null {
  try {
    const cmd = new Deno.Command("which", {
      args: [name],
      stdout: "piped",
      stderr: "null",
    });
    const result = cmd.outputSync();
    if (result.code !== 0) return null;
    return new TextDecoder().decode(result.stdout).trim() || null;
  } catch {
    return null;
  }
}

export async function dkgRound1(
  index: number,
  maxSigners: number,
  minSigners: number,
  frostSignerPath?: string | null,
): Promise<FrostCliResult> {
  return runFrostCommand("dkg-round1", [
    "--index",
    String(index),
    "--max-signers",
    String(maxSigners),
    "--min-signers",
    String(minSigners),
  ], frostSignerPath);
}

export async function dkgRound2(
  secretPackage: string,
  round1Packages: string,
  frostSignerPath?: string | null,
): Promise<FrostCliResult> {
  return runFrostCommand("dkg-round2", [
    "--secret-package",
    secretPackage,
    "--round1-packages",
    round1Packages,
  ], frostSignerPath);
}

export async function dkgRound3(
  round2SecretPackage: string,
  round1Packages: string,
  round2Packages: string,
  frostSignerPath?: string | null,
): Promise<FrostCliResult> {
  return runFrostCommand("dkg-round3", [
    "--round2-secret-package",
    round2SecretPackage,
    "--round1-packages",
    round1Packages,
    "--round2-packages",
    round2Packages,
  ], frostSignerPath);
}

export async function signRound1(
  keyPackage: string,
  frostSignerPath?: string | null,
): Promise<FrostCliResult> {
  return runFrostCommand(
    "sign-round1",
    ["--key-package", keyPackage],
    frostSignerPath,
  );
}

export async function signRound2(
  keyPackage: string,
  nonces: string,
  commitments: string,
  message: string,
  frostSignerPath?: string | null,
): Promise<FrostCliResult> {
  return runFrostCommand("sign-round2", [
    "--key-package",
    keyPackage,
    "--nonces",
    nonces,
    "--commitments",
    commitments,
    "--message",
    message,
  ], frostSignerPath);
}

export async function aggregateSignatures(
  groupPubkey: string,
  commitments: string,
  message: string,
  signatureShares: string,
  pubkeyPackage: string,
  frostSignerPath?: string | null,
): Promise<FrostCliResult> {
  return runFrostCommand("aggregate", [
    "--group-pubkey",
    groupPubkey,
    "--commitments",
    commitments,
    "--message",
    message,
    "--signature-shares",
    signatureShares,
    "--pubkey-package",
    pubkeyPackage,
  ], frostSignerPath);
}

export async function verifySignature(
  groupPubkey: string,
  signature: string,
  message: string,
  frostSignerPath?: string | null,
): Promise<FrostCliResult> {
  return runFrostCommand("verify", [
    "--group-pubkey",
    groupPubkey,
    "--signature",
    signature,
    "--message",
    message,
  ], frostSignerPath);
}
