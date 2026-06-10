/**
 * Cashu HTLC client — wraps `@cashu/cashu-ts` v3 for the SDK's
 * Customer / Provider wire flow.
 *
 * Two-phase HTLC pattern using the SDK payment preselection-transfer model:
 *
 *   Phase 1 (initial lock — provider unknown):
 *     `buildHtlcLock` swaps the source proofs into P2PK(customer) proofs.
 *     The resulting token can appear in the kind 5300 event so providers
 *     see the payment_lock amount, but relay observers cannot spend it.
 *
 *   Phase 2 (swap to bind provider after selection):
 *     `bindProvider` swaps the held proofs at the mint into new proofs
 *     locked under
 *       hashlock(H) + P2PK(provider) + locktime + refund(customer)
 *     so the selected provider can redeem with `preimage + provider sig`
 *     and only after locktime can the customer reclaim.
 *
 *   Redemption (`redeemHtlc`):
 *     Provider attaches the preimage to the HTLC witness, signs with
 *     the provider key (P2PK witness), then performs a swap at the
 *     mint to receive plain (unlocked) proofs.
 */

import {
  getDecodedToken,
  getEncodedToken,
  type P2PKOptions,
  type Proof,
  signP2PKProofs,
  verifyHTLCHash,
  Wallet,
} from "@cashu/cashu-ts";
import {
  buildHtlcFinalOptions,
  buildHtlcPreselectionOptions,
} from "../payments/cashu-htlc-options.ts";
import type {
  BindProviderParams,
  BuildHtlcLockParams,
  CashuClient,
  CashuProof,
  CashuToken,
  RedeemHtlcParams,
  RedeemResult,
} from "./types.ts";

export type {
  BindProviderParams,
  BuildHtlcLockParams,
  CashuClient,
  CashuProof,
  CashuToken,
  RedeemHtlcParams,
  RedeemResult,
} from "./types.ts";

/**
 * Minimal cashu-ts surface used by the SDK.
 *
 * Exposed publicly so tests can inject a structural fake without
 * faking the full cashu-ts `Wallet` class (which has private fields).
 * The real `Wallet` from cashu-ts also satisfies this interface.
 */
export interface CashuSendChain {
  asP2PK(options: P2PKOptions): CashuSendChain;
  privkey(k: string | string[]): CashuSendChain;
  run(): Promise<{ send: Proof[] }>;
}

export interface CashuWalletAdapter {
  ops: {
    send(amount: number, proofs: Proof[]): CashuSendChain;
  };
  /**
   * Mint swap fee for the given proofs. Subtracted from the input amount
   * when swapping all proofs for new ones (e.g. Phase-2 HTLC bind +
   * provider HTLC redemption).
   */
  getFeesForProofs(proofs: Proof[]): number;
  /**
   * Keychain accessor — exposes the wallet's known keyset IDs. Required
   * to decode V4 cashuB tokens that carry truncated (V2 short) keyset
   * IDs back to their full form. Mirrors the real cashu-ts `Wallet`
   * shape (`wallet.keyChain.getAllKeysetIds()`).
   */
  keyChain: {
    getAllKeysetIds(): readonly string[];
  };
}

/** Construction options for {@link createCashuClient}. */
export interface CashuClientOptions {
  /** Cashu mint URL (must support NUT-11 P2PK + NUT-14 HTLC). */
  mintUrl: string;
  /** Optional: pre-built wallet adapter (tests inject a fake here). */
  wallet?: CashuWalletAdapter;
}

/** Thrown when the Cashu mint rejects an operation or returns an unexpected result. */
export class CashuMintError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CashuMintError";
  }
}

/** Thrown when CashuClient parameters are structurally invalid. */
export class CashuClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CashuClientError";
  }
}

/**
 * Validates that a hex hash is the right shape for a Cashu HTLC.
 * Returns the lowercased hash on success; throws on failure.
 */
export function validateHashHex(hash: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(hash)) {
    throw new CashuClientError(
      `Invalid hash hex (expected 64-char hex): ${hash}`,
    );
  }
  return hash.toLowerCase();
}

/**
 * Validates that a locktime is a future Unix timestamp (seconds).
 * Returns the locktime on success; throws on failure.
 */
export function validateLocktime(
  locktimeSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): number {
  if (!Number.isInteger(locktimeSeconds)) {
    throw new CashuClientError(
      `Locktime must be an integer: ${locktimeSeconds}`,
    );
  }
  if (locktimeSeconds <= nowSeconds) {
    throw new CashuClientError(
      `Locktime must be in the future (got ${locktimeSeconds}, now ${nowSeconds})`,
    );
  }
  return locktimeSeconds;
}

function sumAmounts(proofs: Proof[]): number {
  return proofs.reduce((acc, p) => acc + p.amount, 0);
}

function bytesToHexLocal(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s;
}

/**
 * Phase-1 P2PK options: lock to the customer's pubkey only. The payment_lock
 * token is broadcast in the kind 5300 event, so the lock prevents any
 * Nostr-relay subscriber from spending the proofs as bearer tokens —
 * spending requires the customer's signature, which only Phase 2
 * (`bindProvider`) supplies.
 *
 * Hashlock is intentionally NOT applied in Phase 1: the customer needs
 * to swap these proofs in Phase 2, and a hashlock would require the
 * preimage (which only the oracle holds) to spend before locktime.
 */
function buildPhase1P2PKOptions(customerPubkey: string): P2PKOptions {
  return buildHtlcPreselectionOptions({ customerPubkey });
}

function buildHtlcP2PKOptions(p: BindProviderParams): P2PKOptions {
  return buildHtlcFinalOptions({
    hash: p.hashHex,
    providerPubkey: p.providerPubkey,
    customerRefundPubkey: p.customerPubkey,
    locktimeSeconds: p.locktimeSeconds,
  });
}

/**
 * Minimal shape check for a Cashu proof. Catches caller misuse (passing
 * arbitrary objects as `sourceProofs`) before the values reach cashu-ts
 * and produce confusing mint errors.
 */
function isValidProofShape(p: unknown): p is Proof {
  if (typeof p !== "object" || p === null) return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.amount === "number" &&
    Number.isFinite(o.amount) &&
    o.amount > 0 &&
    typeof o.secret === "string" &&
    typeof o.C === "string"
  );
}

function prepareHtlcRedemption(
  proofs: Proof[],
  preimageHex: string,
  privkeyHex: string,
): Proof[] {
  const withPreimage = proofs.map((p) => ({
    ...p,
    witness: JSON.stringify({ preimage: preimageHex, signatures: [] }),
  }));
  return signP2PKProofs(withPreimage, privkeyHex);
}

/**
 * Construct a CashuClient bound to a specific mint.
 *
 * Performs a real swap at `mintUrl` using the provided source proofs.
 * Tests can pass `options.wallet` to inject a Wallet stub instead of
 * opening a live mint connection.
 */
export function createCashuClient(options: CashuClientOptions): CashuClient {
  if (typeof options.mintUrl !== "string" || options.mintUrl.length === 0) {
    throw new CashuClientError("mintUrl must be a non-empty string");
  }
  const mintUrl = options.mintUrl;

  // Lazy wallet construction — keeps tests that never call the mint offline.
  let walletPromise: Promise<CashuWalletAdapter> | null = null;
  function getWallet(): Promise<CashuWalletAdapter> {
    if (options.wallet !== undefined) return Promise.resolve(options.wallet);
    if (walletPromise === null) {
      walletPromise = (async () => {
        const wallet = new Wallet(mintUrl, { unit: "sat" });
        await wallet.loadMint();
        return wallet;
      })();
    }
    return walletPromise;
  }

  return {
    mintUrl,

    async buildHtlcLock(p: BuildHtlcLockParams): Promise<CashuToken> {
      validateHashHex(p.hashHex);
      validateLocktime(p.locktimeSeconds);
      if (typeof p.amountSats !== "number" || p.amountSats <= 0) {
        throw new CashuClientError("amountSats must be a positive number");
      }
      if (!Array.isArray(p.sourceProofs) || p.sourceProofs.length === 0) {
        throw new CashuClientError("sourceProofs must be a non-empty array");
      }
      for (const proof of p.sourceProofs) {
        if (!isValidProofShape(proof)) {
          throw new CashuClientError("sourceProofs contains a malformed proof");
        }
      }

      const wallet = await getWallet();
      const sourceProofs = p.sourceProofs as Proof[];
      const fee = wallet.getFeesForProofs(sourceProofs);
      const swapAmount = p.amountSats - fee;
      if (swapAmount <= 0) {
        throw new CashuMintError(
          `buildHtlcLock: mint fee ${fee} exceeds requested ${p.amountSats} sats`,
        );
      }

      const phase1 = buildPhase1P2PKOptions(p.customerPubkey);
      let send: Proof[];
      try {
        const result = await wallet.ops.send(swapAmount, sourceProofs).asP2PK(
          phase1,
        ).run();
        send = result.send;
      } catch (err) {
        throw new CashuMintError("buildHtlcLock: mint swap failed", err);
      }
      const token = getEncodedToken({ mint: mintUrl, proofs: send });
      return {
        token,
        amountSats: sumAmounts(send),
        proofs: send as CashuProof[],
      };
    },

    async bindProvider(p: BindProviderParams): Promise<CashuToken> {
      validateHashHex(p.hashHex);
      validateLocktime(p.locktimeSeconds);
      if (
        !(p.customerSecretKey instanceof Uint8Array) ||
        p.customerSecretKey.length !== 32
      ) {
        throw new CashuClientError(
          "customerSecretKey must be a 32-byte Uint8Array",
        );
      }
      if (!Array.isArray(p.initialProofs) || p.initialProofs.length === 0) {
        throw new CashuClientError("initialProofs must be a non-empty array");
      }
      for (const proof of p.initialProofs) {
        if (!isValidProofShape(proof)) {
          throw new CashuClientError(
            "initialProofs contains a malformed proof",
          );
        }
      }
      const wallet = await getWallet();
      const sourceProofs = p.initialProofs as Proof[];
      const totalAmount = sumAmounts(sourceProofs);
      if (totalAmount <= 0) {
        throw new CashuClientError(
          "initialProofs contains no spendable proofs",
        );
      }

      const fee = wallet.getFeesForProofs(sourceProofs);
      const swapAmount = totalAmount - fee;
      if (swapAmount <= 0) {
        throw new CashuMintError(
          `bindProvider: mint fee ${fee} exceeds available ${totalAmount} sats`,
        );
      }

      const phase2 = buildHtlcP2PKOptions(p);
      const customerPrivkeyHex = bytesToHexLocal(p.customerSecretKey);

      let send: Proof[];
      try {
        const result = await wallet.ops
          .send(swapAmount, sourceProofs)
          .privkey(customerPrivkeyHex)
          .asP2PK(phase2)
          .run();
        send = result.send;
      } catch (err) {
        throw new CashuMintError("bindProvider: mint swap failed", err);
      }
      const token = getEncodedToken({ mint: mintUrl, proofs: send });
      return {
        token,
        amountSats: sumAmounts(send),
        proofs: send as CashuProof[],
      };
    },

    async redeemHtlc(p: RedeemHtlcParams): Promise<RedeemResult> {
      const wallet = await getWallet();
      // Pass known keyset IDs to map V4 cashuB tokens' truncated IDs back to full form.
      const knownKeysets = wallet.keyChain.getAllKeysetIds();
      const decoded = getDecodedToken(p.token, [...knownKeysets]);
      const proofs = decoded.proofs;
      if (proofs.length === 0) {
        throw new CashuClientError("redeemHtlc: token has no proofs");
      }

      // Defense in depth: NUT-14 hashlock check locally so a bogus oracle
      // preimage surfaces as a clean SDK error before the mint round-trip.
      for (let i = 0; i < proofs.length; i++) {
        const proof = proofs[i]!;
        let secret: unknown;
        try {
          secret = JSON.parse(proof.secret);
        } catch {
          throw new CashuClientError(
            `redeemHtlc: proof ${i} has malformed secret`,
          );
        }
        if (!Array.isArray(secret) || secret[0] !== "HTLC") {
          throw new CashuClientError(
            `redeemHtlc: proof ${i} is not an HTLC proof`,
          );
        }
        const expectedHash = (secret[1] as { data?: unknown } | undefined)
          ?.data;
        if (typeof expectedHash !== "string") {
          throw new CashuClientError(
            `redeemHtlc: proof ${i} has no hashlock data`,
          );
        }
        if (!verifyHTLCHash(p.preimageHex, expectedHash)) {
          throw new CashuClientError(
            `redeemHtlc: preimage does not match proof ${i}'s hashlock`,
          );
        }
      }

      const privkeyHex = bytesToHexLocal(p.providerSecretKey);
      const signedProofs = prepareHtlcRedemption(
        proofs,
        p.preimageHex,
        privkeyHex,
      );
      const totalAmount = sumAmounts(signedProofs);

      const fee = wallet.getFeesForProofs(signedProofs);
      const swapAmount = totalAmount - fee;
      if (swapAmount <= 0) {
        throw new CashuMintError(
          `redeemHtlc: mint fee ${fee} exceeds available ${totalAmount} sats`,
        );
      }

      let received: Proof[];
      try {
        const result = await wallet.ops
          .send(swapAmount, signedProofs)
          .privkey(privkeyHex)
          .run();
        received = result.send;
      } catch (err) {
        throw new CashuMintError("redeemHtlc: mint swap failed", err);
      }
      return {
        proofs: received as CashuProof[],
        amountSats: sumAmounts(received),
      };
    },
  };
}
