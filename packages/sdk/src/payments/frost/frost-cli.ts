/**
 * FROST signer CLI wrapper.
 *
 * Delegates all cryptographic operations to the frost-signer Rust binary.
 * TypeScript is glue only -- zero new crypto implementation.
 */

import { join } from "node:path";

import {
  serverSidecarExecutor,
  type SidecarExecutor,
} from "../../internal/runtime/mod.ts";
import { getLogger } from "../../internal/runtime/logger.ts";
const log = getLogger(["anchr", "frost"]);

/** Find the frost-signer binary: project-local first, then PATH. */
export function findFrostSigner(
  executor: SidecarExecutor = serverSidecarExecutor,
): string | null {
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
    if (executor.isFile(p)) {
      log.debug(`Found frost-signer at ${p}`);
      return p;
    }
  }

  const onPath = executor.which("frost-signer");
  if (onPath) {
    log.debug(`Found frost-signer at ${onPath}`);
  }
  return onPath;
}

export function isFrostSignerAvailable(
  executor: SidecarExecutor = serverSidecarExecutor,
): boolean {
  return findFrostSigner(executor) !== null;
}

/**
 * Resolve the binary path: an explicit override (a path string, or `null` to
 * force "unavailable") takes precedence; `undefined` falls back to
 * auto-detection.
 */
function resolveFrostSigner(
  frostSignerPath: string | null | undefined,
  executor: SidecarExecutor,
): string | null {
  return frostSignerPath === undefined
    ? findFrostSigner(executor)
    : frostSignerPath;
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
  executor: SidecarExecutor = serverSidecarExecutor,
): Promise<FrostCliResult> {
  const binPath = resolveFrostSigner(frostSignerPath, executor);
  if (!binPath) {
    return { ok: false, error: "frost-signer binary not available" };
  }

  const proc = executor.spawn([binPath, subcommand, ...args], {
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
    return {
      ok: false,
      error: `frost-signer timed out after ${FROST_TIMEOUT_MS / 1000}s`,
    };
  }

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  if (proc.exitCode !== 0) {
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

export async function dkgRound1(
  index: number,
  maxSigners: number,
  minSigners: number,
  frostSignerPath?: string | null,
  executor?: SidecarExecutor,
): Promise<FrostCliResult> {
  return runFrostCommand(
    "dkg-round1",
    [
      "--index",
      String(index),
      "--max-signers",
      String(maxSigners),
      "--min-signers",
      String(minSigners),
    ],
    frostSignerPath,
    executor,
  );
}

export async function dkgRound2(
  secretPackage: string,
  round1Packages: string,
  frostSignerPath?: string | null,
  executor?: SidecarExecutor,
): Promise<FrostCliResult> {
  return runFrostCommand(
    "dkg-round2",
    [
      "--secret-package",
      secretPackage,
      "--round1-packages",
      round1Packages,
    ],
    frostSignerPath,
    executor,
  );
}

export async function dkgRound3(
  round2SecretPackage: string,
  round1Packages: string,
  round2Packages: string,
  frostSignerPath?: string | null,
  executor?: SidecarExecutor,
): Promise<FrostCliResult> {
  return runFrostCommand(
    "dkg-round3",
    [
      "--round2-secret-package",
      round2SecretPackage,
      "--round1-packages",
      round1Packages,
      "--round2-packages",
      round2Packages,
    ],
    frostSignerPath,
    executor,
  );
}

export async function signRound1(
  keyPackage: string,
  frostSignerPath?: string | null,
  executor?: SidecarExecutor,
): Promise<FrostCliResult> {
  return runFrostCommand(
    "sign-round1",
    ["--key-package", keyPackage],
    frostSignerPath,
    executor,
  );
}

export async function signRound2(
  keyPackage: string,
  nonces: string,
  commitments: string,
  message: string,
  frostSignerPath?: string | null,
  executor?: SidecarExecutor,
): Promise<FrostCliResult> {
  return runFrostCommand(
    "sign-round2",
    [
      "--key-package",
      keyPackage,
      "--nonces",
      nonces,
      "--commitments",
      commitments,
      "--message",
      message,
    ],
    frostSignerPath,
    executor,
  );
}

export async function aggregateSignatures(
  groupPubkey: string,
  commitments: string,
  message: string,
  signatureShares: string,
  pubkeyPackage: string,
  frostSignerPath?: string | null,
  executor?: SidecarExecutor,
): Promise<FrostCliResult> {
  return runFrostCommand(
    "aggregate",
    [
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
    ],
    frostSignerPath,
    executor,
  );
}

export async function verifySignature(
  groupPubkey: string,
  signature: string,
  message: string,
  frostSignerPath?: string | null,
  executor?: SidecarExecutor,
): Promise<FrostCliResult> {
  return runFrostCommand(
    "verify",
    [
      "--group-pubkey",
      groupPubkey,
      "--signature",
      signature,
      "--message",
      message,
    ],
    frostSignerPath,
    executor,
  );
}
