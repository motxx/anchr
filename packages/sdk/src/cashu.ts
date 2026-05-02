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
  /** The Phase-1 token returned by `buildHtlcLock`. */
  initialToken: string;
  /** Hex pubkey of the selected provider. */
  providerPubkey: string;
  /** Same hash from Phase 1 (must match). */
  hashHex: string;
  /** Same locktime from Phase 1 (must match). */
  locktimeSeconds: number;
  /** Customer's refund pubkey (must match Phase 1). */
  customerPubkey: string;
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

/** Build the Phase-2 P2PK options for the HTLC bind step. */
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
      // Phase 1: tokenize the customer's source proofs without any
      // mint-side lock. Provider only sees the encoded bearer token in
      // the kind 5300 event but cannot spend it (no preimage, no P2PK
      // signature on these proofs). The actual HTLC lock happens in
      // Phase 2 (`bindProvider`) once a provider is selected.
      const proofs = p.sourceProofs as Proof[];
      const token = getEncodedToken({ mint: mintUrl, proofs });
      return {
        token,
        amountSats: p.amountSats,
        proofs: proofs as CashuProof[],
      };
    },

    async bindProvider(p: BindProviderParams): Promise<CashuToken> {
      validateHashHex(p.hashHex);
      validateLocktime(p.locktimeSeconds);
      const wallet = await getWallet();
      const decoded = getDecodedToken(p.initialToken);
      const sourceProofs = decoded.proofs;
      const totalAmount = sumAmounts(sourceProofs);
      if (totalAmount <= 0) {
        throw new CashuClientError("initialToken contains no spendable proofs");
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

      const p2pk = buildHtlcP2PKOptions(p);

      let send: Proof[];
      try {
        const result = await wallet.ops.send(swapAmount, sourceProofs).asP2PK(p2pk).run();
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
      const decoded = getDecodedToken(p.token);
      const proofs = decoded.proofs;
      if (proofs.length === 0) {
        throw new CashuClientError("redeemHtlc: token has no proofs");
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
