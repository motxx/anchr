/**
 * Cashu HTLC client — wraps `@cashu/cashu-ts` v3 for the SDK's
 * Customer / Provider wire flow.
 *
 * Two-phase HTLC pattern (mirrors `@anchr/core-cashu/src/escrow.ts`):
 *
 *   Phase 1 (initial lock — provider unknown):
 *     The customer holds raw proofs locally; no on-chain (mint-side)
 *     lock yet. `buildHtlcLock` tokenizes the source proofs into a
 *     transferable Cashu token string so the provider sees the bounty
 *     amount in the kind 5300 event but cannot spend it (no preimage,
 *     no P2PK signature on these plain proofs).
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
  Wallet,
  P2PKBuilder,
  type Proof,
  type P2PKOptions,
  getDecodedToken,
  getEncodedToken,
  signP2PKProofs,
  verifyHTLCHash,
} from "@cashu/cashu-ts";

/**
 * A Cashu proof — typed as `unknown` so downstream cashu-ts types do not
 * leak through SDK consumers. Internally narrowed to cashu-ts `Proof`
 * before any operation that depends on its shape.
 */
export type CashuProof = unknown;

/** Parameters for the Phase-1 HTLC lock (provider unknown yet). */
export interface BuildHtlcLockParams {
  /** Amount in sats to lock. */
  amountSats: number;
  /** Hex hash `H` whose preimage `S` the oracle will release on a valid proof. */
  hashHex: string;
  /** Hex pubkey of the customer (refund recipient after locktime). */
  customerPubkey: string;
  /** Locktime as Unix timestamp (seconds). */
  locktimeSeconds: number;
  /** Source proofs to lock from (the customer's wallet supplies these). */
  sourceProofs: CashuProof[];
}

/** Parameters for the Phase-2 swap that binds a selected provider to the lock. */
export interface BindProviderParams {
  /**
   * Phase-1 proofs (returned by `buildHtlcLock` as `proofs`). Passed
   * directly rather than via the encoded token to sidestep the V4
   * cashu-ts encoding which truncates keyset IDs to a short form that
   * requires wallet keychain access to map back on decode.
   */
  initialProofs: CashuProof[];
  /** Hex pubkey of the selected provider. */
  providerPubkey: string;
  /** Hash `H` whose preimage `S` the oracle releases on a valid proof. */
  hashHex: string;
  /** Locktime as Unix timestamp (seconds). After this, customer can refund. */
  locktimeSeconds: number;
  /** Customer's hex pubkey (refund recipient). */
  customerPubkey: string;
  /**
   * Customer's secret key (32 bytes). Required because Phase-1 proofs are
   * P2PK-locked to `customerPubkey`; the swap to the Phase-2 lock can only
   * be authorised by a signature from this key.
   */
  customerSecretKey: Uint8Array;
}

/** Parameters for redeeming an HTLC token at the mint (provider side). */
export interface RedeemHtlcParams {
  /** The Phase-2 (provider-bound) token to redeem. */
  token: string;
  /** Hex preimage `S` such that `sha256(S) = H`, delivered by the oracle. */
  preimageHex: string;
  /** Provider's secret key (32 bytes) used to satisfy the P2PK requirement. */
  providerSecretKey: Uint8Array;
}

/** Result of redeeming an HTLC token. */
export interface RedeemResult {
  /** Net proofs received after redemption (provider's spendable wallet state). */
  proofs: CashuProof[];
  /** Total amount in sats. */
  amountSats: number;
}

/** Result of building / binding an HTLC token. */
export interface CashuToken {
  /** Encoded Cashu token string (cashuB...). */
  token: string;
  /** Total amount in sats locked. */
  amountSats: number;
  /** Raw proofs (opaque to the SDK, used by the next phase). */
  proofs: CashuProof[];
}

/**
 * Public-facing CashuClient interface.
 *
 * Customer-side methods: `buildHtlcLock`, `bindProvider`.
 * Provider-side method:  `redeemHtlc`.
 */
export interface CashuClient {
  /** Phase 1: build the initial HTLC lock with no provider bound yet. */
  buildHtlcLock(params: BuildHtlcLockParams): Promise<CashuToken>;
  /** Phase 2: swap to add the selected provider's pubkey to the lock. */
  bindProvider(params: BindProviderParams): Promise<CashuToken>;
  /** Provider-side: redeem an HTLC token using preimage + provider signature. */
  redeemHtlc(params: RedeemHtlcParams): Promise<RedeemResult>;
  /** Mint URL the client is configured to talk to. */
  readonly mintUrl: string;
}

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
    throw new CashuClientError(`Invalid hash hex (expected 64-char hex): ${hash}`);
  }
  return hash.toLowerCase();
}

/**
 * Validates that a locktime is a future Unix timestamp (seconds).
 * Returns the locktime on success; throws on failure.
 */
export function validateLocktime(locktimeSeconds: number, nowSeconds: number = Math.floor(Date.now() / 1000)): number {
  if (!Number.isInteger(locktimeSeconds)) {
    throw new CashuClientError(`Locktime must be an integer: ${locktimeSeconds}`);
  }
  if (locktimeSeconds <= nowSeconds) {
    throw new CashuClientError(
      `Locktime must be in the future (got ${locktimeSeconds}, now ${nowSeconds})`,
    );
  }
  return locktimeSeconds;
}

/** Sum the `amount` fields of an array of proofs. */
function sumAmounts(proofs: Proof[]): number {
  return proofs.reduce((acc, p) => acc + p.amount, 0);
}

/** Encode a Uint8Array secret key as lowercase hex (no `0x` prefix). */
function bytesToHexLocal(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

/**
 * Phase-1 P2PK options: lock to the customer's pubkey only. The bounty
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
  return new P2PKBuilder()
    .addLockPubkey(customerPubkey)
    .requireLockSignatures(1)
    .sigAll()
    .toOptions();
}

/** Phase-2 P2PK options: hashlock + provider P2PK + locktime + refund(customer). */
function buildHtlcP2PKOptions(p: BindProviderParams): P2PKOptions {
  return new P2PKBuilder()
    .addHashlock(p.hashHex)
    .addLockPubkey(p.providerPubkey)
    .requireLockSignatures(1)
    .lockUntil(p.locktimeSeconds)
    .addRefundPubkey(p.customerPubkey)
    .requireRefundSignatures(1)
    .sigAll()
    .toOptions();
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

/** Attach the HTLC preimage witness, then sign each proof with the provider's privkey. */
function prepareHtlcRedemption(proofs: Proof[], preimageHex: string, privkeyHex: string): Proof[] {
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

  // Lazily construct the wallet so tests that don't actually exercise
  // mint operations don't open a live connection.
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

      // Phase 1: swap the caller's source proofs at the mint for new
      // proofs locked to the customer's pubkey (P2PK only — no hashlock
      // yet, see `buildPhase1P2PKOptions` for why). The kind 5300 event
      // can then carry this token in the open without exposing a
      // bearer instrument: a Nostr-relay subscriber sees the token but
      // cannot spend it without the customer's signature, which is
      // only supplied during Phase 2 (`bindProvider`).
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
        const result = await wallet.ops.send(swapAmount, sourceProofs).asP2PK(phase1).run();
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
      if (!(p.customerSecretKey instanceof Uint8Array) || p.customerSecretKey.length !== 32) {
        throw new CashuClientError("customerSecretKey must be a 32-byte Uint8Array");
      }
      if (!Array.isArray(p.initialProofs) || p.initialProofs.length === 0) {
        throw new CashuClientError("initialProofs must be a non-empty array");
      }
      for (const proof of p.initialProofs) {
        if (!isValidProofShape(proof)) {
          throw new CashuClientError("initialProofs contains a malformed proof");
        }
      }
      const wallet = await getWallet();
      const sourceProofs = p.initialProofs as Proof[];
      const totalAmount = sumAmounts(sourceProofs);
      if (totalAmount <= 0) {
        throw new CashuClientError("initialProofs contains no spendable proofs");
      }

      // Mint swap fees are taken from the input proofs. We swap ALL the
      // input into HTLC-locked output proofs, so the output amount is
      // `totalAmount - fee` (matches core-cashu's computeNetAmount).
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
        // Phase-1 proofs are P2PK-locked to the customer; provide the
        // customer's privkey to satisfy the input lock, while applying
        // the Phase-2 (hashlock + provider P2PK + locktime + refund)
        // conditions to the output proofs.
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
      // Pass the wallet's known keyset IDs so V4 cashuB tokens (which
      // truncate keyset IDs to a short form on encode) can be mapped
      // back to their full IDs on decode.
      const knownKeysets = wallet.keyChain.getAllKeysetIds();
      const decoded = getDecodedToken(p.token, [...knownKeysets]);
      const proofs = decoded.proofs;
      if (proofs.length === 0) {
        throw new CashuClientError("redeemHtlc: token has no proofs");
      }

      // Defense in depth: verify the preimage matches each proof's
      // hashlock locally before submitting to the mint. The mint also
      // enforces NUT-14, but failing fast here means a malicious oracle
      // delivering a bogus preimage surfaces as a clear SDK error
      // instead of a noisy mint round-trip.
      for (let i = 0; i < proofs.length; i++) {
        const proof = proofs[i]!;
        let secret: unknown;
        try {
          secret = JSON.parse(proof.secret);
        } catch {
          throw new CashuClientError(`redeemHtlc: proof ${i} has malformed secret`);
        }
        if (!Array.isArray(secret) || secret[0] !== "HTLC") {
          throw new CashuClientError(`redeemHtlc: proof ${i} is not an HTLC proof`);
        }
        const expectedHash = (secret[1] as { data?: unknown } | undefined)?.data;
        if (typeof expectedHash !== "string") {
          throw new CashuClientError(`redeemHtlc: proof ${i} has no hashlock data`);
        }
        if (!verifyHTLCHash(p.preimageHex, expectedHash)) {
          throw new CashuClientError(
            `redeemHtlc: preimage does not match proof ${i}'s hashlock`,
          );
        }
      }

      const privkeyHex = bytesToHexLocal(p.providerSecretKey);
      const signedProofs = prepareHtlcRedemption(proofs, p.preimageHex, privkeyHex);
      const totalAmount = sumAmounts(signedProofs);

      // Mint swap fee comes out of the input proofs (same accounting as
      // bindProvider above).
      const fee = wallet.getFeesForProofs(signedProofs);
      const swapAmount = totalAmount - fee;
      if (swapAmount <= 0) {
        throw new CashuMintError(
          `redeemHtlc: mint fee ${fee} exceeds available ${totalAmount} sats`,
        );
      }

      let received: Proof[];
      try {
        // Spend the HTLC-locked + provider-signed proofs at the mint
        // and receive fresh, unlocked proofs of the same amount minus
        // mint swap fees. (Equivalent to a "receive" but works through
        // the send builder so we can attach the provider privkey for
        // the P2PK witness.)
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
