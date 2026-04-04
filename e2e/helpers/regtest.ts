/**
 * Shared E2E helpers for regtest Cashu / Lightning tests.
 */

import { spawn } from "../../src/runtime/mod.ts";
import { Wallet, type Proof, getEncodedToken } from "@cashu/cashu-ts";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Check if the Cashu mint is reachable at the given URL. */
export async function isCashuMintReachable(mintUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${mintUrl}/v1/info`, { signal: AbortSignal.timeout(3000) });
    await res.body?.cancel(); // Consume response body to avoid Deno sanitizer leak
    return res.ok;
  } catch {
    return false;
  }
}

/** Check if lnd-user is reachable via docker compose. */
export async function isLndUserReachable(): Promise<boolean> {
  try {
    const proc = spawn([
      "docker", "compose", "exec", "-T", "lnd-user",
      "lncli", "--network", "regtest", "--rpcserver", "lnd-user:10009",
      "getinfo",
    ], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/** Pay a Lightning invoice via lnd-user. */
export async function payInvoiceViaLndUser(bolt11: string): Promise<boolean> {
  try {
    const proc = spawn([
      "docker", "compose", "exec", "-T", "lnd-user",
      "lncli", "--network", "regtest", "--rpcserver", "lnd-user:10009",
      "payinvoice", "--force", bolt11,
    ], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/** Create and load a Cashu wallet for the given mint URL. */
export async function createWallet(mintUrl: string): Promise<Wallet> {
  const wallet = new Wallet(mintUrl, { unit: "sat" });
  await wallet.loadMint();
  return wallet;
}

/** Mint Cashu proofs via Lightning payment. */
export async function mintProofs(wallet: Wallet, amountSats: number): Promise<Proof[]> {
  const mintQuote = await wallet.createMintQuote(amountSats);
  const paid = await payInvoiceViaLndUser(mintQuote.request);
  if (!paid) throw new Error("Failed to pay Lightning invoice via lnd-user");
  await new Promise(r => setTimeout(r, 2000));
  return wallet.mintProofs(amountSats, mintQuote.quote);
}

/** Global throttle for all Cashu mint operations (mint, swap, send). */
let lastMintOpTime = 0;
const MINT_OP_INTERVAL_MS = 500;

/** Wait until the minimum interval has elapsed since the last mint operation. */
export async function throttleMintOp(): Promise<void> {
  const elapsed = Date.now() - lastMintOpTime;
  if (elapsed < MINT_OP_INTERVAL_MS) await new Promise(r => setTimeout(r, MINT_OP_INTERVAL_MS - elapsed));
  lastMintOpTime = Date.now();
}

/** Retry an async operation on "Rate limit exceeded" with exponential backoff. */
export async function retryOnRateLimit<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= maxRetries || !msg.includes("Rate limit")) throw err;
      const delay = 2000 * 2 ** attempt; // 2s, 4s, 8s
      console.warn(`[regtest] Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

/** Rate-limited wrapper around mintProofs to avoid hitting Nutshell's rate limiter. */
export async function throttledMintProofs(wallet: Wallet, amountSats: number): Promise<Proof[]> {
  await throttleMintOp();
  return retryOnRateLimit(() => mintProofs(wallet, amountSats));
}

/** Generate a nostr keypair (hex secretKey + publicKey). */
export function generateKeypair() {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  return { secretKey: bytesToHex(sk), publicKey: pk };
}

/** Check if both Cashu mint and lnd-user are reachable. Warns on failure. */
export async function checkInfraReady(mintUrl: string): Promise<boolean> {
  const [mintReachable, lndReachable] = await Promise.all([
    isCashuMintReachable(mintUrl),
    isLndUserReachable(),
  ]);
  if (!mintReachable) {
    console.warn(`[e2e] Cashu mint not reachable at ${mintUrl} – tests will be ignored.`);
    console.warn("  Run: docker compose up -d && ./scripts/init-regtest.sh && docker compose restart cashu-mint");
  }
  if (!lndReachable) {
    console.warn("[e2e] lnd-user not reachable – tests will be ignored.");
  }
  return mintReachable && lndReachable;
}
