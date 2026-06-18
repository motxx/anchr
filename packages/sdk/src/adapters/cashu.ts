/**
 * Cashu HTLC client — wraps `@cashu/cashu-ts` v3 for the SDK's
 * Customer / Provider wire flow.
 *
 * The Customer binds funding proofs after selecting a Provider. `bindProvider`
 * swaps the funding proofs into new proofs locked under
 *   hashlock(H) + P2PK(provider) + locktime + refund(customer)
 * so the selected provider can redeem with `preimage + provider sig`
 * and only after locktime can the customer reclaim.
 *
 *   Redemption (`redeemHtlc`):
 *     Provider attaches the preimage to the HTLC witness, signs with
 *     the provider key (P2PK witness), then performs a swap at the
 *     mint to receive plain (unlocked) proofs.
 */

import {
  CheckStateEnum,
  getDecodedToken,
  getEncodedToken,
  hashToCurve,
  Mint,
  type P2PKOptions,
  pointFromHex,
  type Proof,
  type RequestFn,
  signP2PKProofs,
  verifyDLEQProof,
  verifyHTLCHash,
  Wallet,
} from "@cashu/cashu-ts";
import { buildHtlcFinalOptions } from "../payments/cashu/cashu-htlc-options.ts";
import {
  type CashuRedeemSendChain,
  type CashuRedeemWallet,
  redeemSignedProofs,
  type RedeemSwapResult,
} from "../payments/cashu/redeem-swap.ts";
import type {
  BindProviderParams,
  CashuClient,
  CashuProof,
  CashuToken,
  RedeemHtlcParams,
  RedeemResult,
  VerifyProviderPaymentLockParams,
  VerifyProviderPaymentLockResult,
} from "./types.ts";

export type {
  BindProviderParams,
  CashuClient,
  CashuProof,
  CashuToken,
  RedeemHtlcParams,
  RedeemResult,
  VerifyProviderPaymentLockParams,
  VerifyProviderPaymentLockResult,
} from "./types.ts";

/**
 * Minimal cashu-ts surface used by the SDK.
 *
 * Exposed publicly so tests can inject a structural fake without
 * faking the full cashu-ts `Wallet` class (which has private fields).
 * The real `Wallet` from cashu-ts also satisfies this interface.
 */
export type CashuSendChain = CashuRedeemSendChain;

export interface CashuWalletAdapter extends CashuRedeemWallet {
  ops: {
    send(amount: number, proofs: Proof[]): CashuSendChain;
  };
  /**
   * Mint swap fee for the given proofs. Subtracted from the input amount
   * when swapping proofs for new ones (e.g. Provider-bound HTLC bind +
   * Provider HTLC redemption).
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
  /**
   * Optional request dispatcher for all mint HTTP calls. INV-08 does not
   * cover the mint touchpoint; inject a SOCKS5/Tor-routed dispatcher here
   * for IP-level anonymity.
   */
  customRequest?: RequestFn;
}

/** Thrown when the Cashu mint rejects an operation or returns an unexpected result. */
export class CashuMintError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "CashuMintError";
  }
}

/**
 * Thrown when a mint operation may have committed while its response was
 * lost: the inputs are spent (or unknowable) but the outputs could not be
 * recovered. Funds are not necessarily lost — the pre-registered outputs
 * remain restorable via NUT-09 — but the caller must check the mint instead
 * of blindly retrying or treating the redemption as failed.
 */
export class CashuMintUncertainError extends CashuMintError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "CashuMintUncertainError";
  }
}

/** Thrown when CashuClient parameters are structurally invalid. */
export class CashuClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CashuClientError";
  }
}

const MIN_PROVIDER_PAYMENT_LOCK_REMAINING_SECONDS = 10 * 60;

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

function hexToBytesLocal(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new CashuClientError(`Invalid hex string: ${hex}`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function hashProofSecretToCurve(
  secret: string,
): ReturnType<typeof hashToCurve> {
  return Reflect.apply(hashToCurve, undefined, [secret]) as ReturnType<
    typeof hashToCurve
  >;
}

function buildHtlcP2PKOptions(p: BindProviderParams): P2PKOptions {
  return buildHtlcFinalOptions({
    hash: p.hashHex,
    providerPubkey: p.providerPubkey,
    customerRefundPubkey: p.customerPubkey,
    locktimeSeconds: p.locktimeSeconds,
  });
}

function p2pkVariants(pubkey: string): string[] {
  return pubkey.startsWith("02") || pubkey.startsWith("03")
    ? [pubkey]
    : [pubkey, `02${pubkey}`];
}

function findSecretTag(tags: unknown, name: string): string[] | null {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (
      Array.isArray(tag) &&
      tag.length > 0 &&
      tag.every((value) => typeof value === "string") &&
      tag[0] === name
    ) {
      return tag;
    }
  }
  return null;
}

function requireTagValue(
  tags: unknown,
  name: string,
  value: string,
  message: string,
): void {
  const tag = findSecretTag(tags, name);
  if (tag === null || tag[1] !== value) {
    throw new CashuClientError(message);
  }
}

function rejectUnsupportedExtraSignatures(tags: unknown): void {
  const tag = findSecretTag(tags, "n_sigs");
  if (tag !== null && tag[1] !== "1") {
    throw new CashuClientError(
      "verifyProviderPaymentLock: token requires unsupported extra signatures",
    );
  }
}

function validateMinimumProviderLocktime(
  locktimeSeconds: number,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): void {
  validateLocktime(locktimeSeconds, nowSeconds);
  const remainingSeconds = locktimeSeconds - nowSeconds;
  if (remainingSeconds < MIN_PROVIDER_PAYMENT_LOCK_REMAINING_SECONDS) {
    throw new CashuClientError(
      `verifyProviderPaymentLock: token locktime has only ${remainingSeconds}s remaining`,
    );
  }
}

function rejectDuplicateProofs(proofs: Proof[]): void {
  const seenSecrets = new Set<string>();
  for (const proof of proofs) {
    if (seenSecrets.has(proof.secret)) {
      throw new CashuClientError(
        "verifyProviderPaymentLock: token contains duplicate proofs",
      );
    }
    seenSecrets.add(proof.secret);
  }
}

function validateProviderPaymentLockProofs(
  proofs: Proof[],
  params: VerifyProviderPaymentLockParams,
): number {
  if (proofs.length === 0) {
    throw new CashuClientError(
      "verifyProviderPaymentLock: token has no proofs",
    );
  }
  const expectedHash = validateHashHex(params.hashHex);
  validateMinimumProviderLocktime(params.locktimeSeconds);
  rejectDuplicateProofs(proofs);
  const amountSats = sumAmounts(proofs);
  if (amountSats !== params.amountSats) {
    throw new CashuClientError(
      `verifyProviderPaymentLock: token amount ${amountSats} does not match ${params.amountSats}`,
    );
  }

  for (let i = 0; i < proofs.length; i++) {
    const proof = proofs[i]!;
    let secret: unknown;
    try {
      secret = JSON.parse(proof.secret);
    } catch {
      throw new CashuClientError(
        `verifyProviderPaymentLock: proof ${i} has malformed secret`,
      );
    }
    if (!Array.isArray(secret) || secret[0] !== "HTLC") {
      throw new CashuClientError(
        `verifyProviderPaymentLock: proof ${i} is not an HTLC proof`,
      );
    }
    const body = secret[1] as { data?: unknown; tags?: unknown } | undefined;
    if (body?.data !== expectedHash) {
      throw new CashuClientError(
        "verifyProviderPaymentLock: HTLC hash mismatch",
      );
    }
    const tags = body.tags;
    const pubkeyTag = findSecretTag(tags, "pubkeys");
    const providerKeys = p2pkVariants(params.providerPubkey);
    if (
      pubkeyTag === null ||
      !providerKeys.some((key) => pubkeyTag.slice(1).includes(key))
    ) {
      throw new CashuClientError(
        "verifyProviderPaymentLock: token is not locked to the selected provider",
      );
    }
    const refundTag = findSecretTag(tags, "refund");
    const refundKeys = p2pkVariants(params.customerPubkey);
    if (
      refundTag === null ||
      !refundKeys.some((key) => refundTag.slice(1).includes(key))
    ) {
      throw new CashuClientError(
        "verifyProviderPaymentLock: token refund key does not match customer",
      );
    }
    requireTagValue(
      tags,
      "locktime",
      String(params.locktimeSeconds),
      "verifyProviderPaymentLock: token locktime mismatch",
    );
    requireTagValue(
      tags,
      "sigflag",
      "SIG_ALL",
      "verifyProviderPaymentLock: token must require SIG_ALL",
    );
    rejectUnsupportedExtraSignatures(tags);
  }
  return amountSats;
}

async function requireProofsUnspent(
  wallet: CashuWalletAdapter,
  proofs: Proof[],
): Promise<void> {
  if (!wallet.checkProofsStates) {
    throw new CashuClientError(
      "verifyProviderPaymentLock: proof state check unavailable",
    );
  }

  let states: Array<{ state: string }>;
  try {
    states = await wallet.checkProofsStates(proofs);
  } catch (err) {
    throw new CashuMintError(
      "verifyProviderPaymentLock: proof state check failed",
      err,
    );
  }

  if (states.length !== proofs.length) {
    throw new CashuMintError(
      "verifyProviderPaymentLock: proof state check returned an unexpected count",
    );
  }

  const invalid = states.find((state) =>
    state.state !== CheckStateEnum.UNSPENT
  );
  if (invalid !== undefined) {
    throw new CashuClientError(
      `verifyProviderPaymentLock: proof state is ${invalid.state}`,
    );
  }
}

function decodeProofDleq(proof: Proof): { s: Uint8Array; e: Uint8Array } {
  const dleq = proof.dleq;
  if (typeof dleq !== "object" || dleq === null) {
    throw new CashuClientError(
      "verifyProviderPaymentLock: proof is missing DLEQ proof",
    );
  }
  const serialized = dleq as { s?: unknown; e?: unknown };
  if (typeof serialized.s !== "string" || typeof serialized.e !== "string") {
    throw new CashuClientError(
      "verifyProviderPaymentLock: proof has malformed DLEQ proof",
    );
  }
  return {
    s: hexToBytesLocal(serialized.s),
    e: hexToBytesLocal(serialized.e),
  };
}

function requireMintSignatureProofs(
  wallet: CashuWalletAdapter,
  proofs: Proof[],
): void {
  const getKeyset = wallet.getKeyset;
  if (getKeyset === undefined) {
    throw new CashuClientError(
      "verifyProviderPaymentLock: mint keyset lookup unavailable",
    );
  }

  for (const proof of proofs) {
    const keyset = getKeyset(proof.id);
    const amountPublicKey = keyset.keys[proof.amount];
    if (typeof amountPublicKey !== "string") {
      throw new CashuClientError(
        "verifyProviderPaymentLock: mint key for proof amount unavailable",
      );
    }

    try {
      const isValid = verifyDLEQProof(
        decodeProofDleq(proof),
        hashProofSecretToCurve(proof.secret),
        pointFromHex(proof.C),
        pointFromHex(amountPublicKey),
      );
      if (!isValid) {
        throw new CashuClientError(
          "verifyProviderPaymentLock: proof signature is invalid",
        );
      }
    } catch (err) {
      if (err instanceof CashuClientError) throw err;
      throw new CashuClientError(
        "verifyProviderPaymentLock: proof signature verification failed",
      );
    }
  }
}

/**
 * Minimal shape check for a Cashu proof. Catches caller misuse (passing
 * arbitrary objects as `fundingProofs`) before the values reach cashu-ts
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

function mapRedeemFailure(result: RedeemSwapResult): never {
  if (result.ok) {
    throw new CashuMintError("redeemHtlc: unexpected redeem result");
  }
  switch (result.reason) {
    case "fee_exceeds_amount":
      throw new CashuMintError(
        `redeemHtlc: mint fee ${result.fee} exceeds available ${result.totalAmount} sats`,
        result.cause,
      );
    case "mint_error":
      throw new CashuMintError("redeemHtlc: mint swap failed", result.cause);
    case "state_unknown":
      throw new CashuMintUncertainError(
        "redeemHtlc: mint swap failed and the input state could not be checked — keep the token and retry once the mint is reachable",
        result.cause,
      );
    case "inputs_unspent":
      throw new CashuMintError(
        "redeemHtlc: mint swap failed; inputs are unspent — safe to retry with the same token",
        result.cause,
      );
    case "outputs_not_registered":
      throw new CashuMintUncertainError(
        "redeemHtlc: inputs are spent at the mint but no recoverable outputs were registered — check the mint before retrying",
        result.cause,
      );
    case "restore_failed":
      throw new CashuMintUncertainError(
        "redeemHtlc: inputs are spent and NUT-09 restore failed — outputs remain recoverable; check the mint",
        result.cause,
      );
    case "restore_empty":
      throw new CashuMintUncertainError(
        "redeemHtlc: inputs are spent but the mint returned no signatures for the registered outputs — check the mint",
        result.cause,
      );
  }
}

/**
 * Construct a CashuClient bound to a specific mint.
 *
 * Performs a real swap at `mintUrl` using the provided funding proofs.
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
        const mint = options.customRequest !== undefined
          ? new Mint(mintUrl, { customRequest: options.customRequest })
          : mintUrl;
        const wallet = new Wallet(mint, { unit: "sat" });
        await wallet.loadMint();
        return wallet;
      })();
    }
    return walletPromise;
  }

  return {
    mintUrl,

    async bindProvider(p: BindProviderParams): Promise<CashuToken> {
      validateHashHex(p.hashHex);
      validateLocktime(p.locktimeSeconds);
      if (
        !Number.isFinite(p.amountSats) ||
        !Number.isInteger(p.amountSats) ||
        p.amountSats <= 0
      ) {
        throw new CashuClientError("amountSats must be a positive integer");
      }
      if (
        !(p.customerSecretKey instanceof Uint8Array) ||
        p.customerSecretKey.length !== 32
      ) {
        throw new CashuClientError(
          "customerSecretKey must be a 32-byte Uint8Array",
        );
      }
      if (!Array.isArray(p.fundingProofs) || p.fundingProofs.length === 0) {
        throw new CashuClientError("fundingProofs must be a non-empty array");
      }
      for (const proof of p.fundingProofs) {
        if (!isValidProofShape(proof)) {
          throw new CashuClientError(
            "fundingProofs contains a malformed proof",
          );
        }
      }
      const wallet = await getWallet();
      const inputProofs = p.fundingProofs as Proof[];
      const totalAmount = sumAmounts(inputProofs);
      if (totalAmount <= 0) {
        throw new CashuClientError(
          "fundingProofs contains no spendable proofs",
        );
      }

      const fee = wallet.getFeesForProofs(inputProofs);
      const requiredAmount = p.amountSats + fee;
      if (totalAmount < requiredAmount) {
        throw new CashuMintError(
          `bindProvider: mint fee ${fee} leaves ${
            totalAmount - fee
          } sats for ${p.amountSats} sat lock`,
        );
      }

      const phase2 = buildHtlcP2PKOptions(p);
      const customerPrivkeyHex = bytesToHexLocal(p.customerSecretKey);

      let keep: Proof[];
      let send: Proof[];
      try {
        const result = await wallet.ops
          .send(p.amountSats, inputProofs)
          .privkey(customerPrivkeyHex)
          .asP2PK(phase2)
          .run();
        keep = result.keep ?? [];
        send = result.send;
      } catch (err) {
        throw new CashuMintError("bindProvider: mint swap failed", err);
      }
      const token = getEncodedToken({ mint: mintUrl, proofs: send }, {
        version: 4,
      });
      return {
        token,
        amountSats: sumAmounts(send),
        proofs: send as CashuProof[],
        changeProofs: keep as CashuProof[],
      };
    },

    async verifyProviderPaymentLock(
      params: VerifyProviderPaymentLockParams,
    ): Promise<VerifyProviderPaymentLockResult> {
      const wallet = await getWallet();
      const knownKeysets = wallet.keyChain.getAllKeysetIds();
      const decoded = getDecodedToken(params.token, [...knownKeysets]);
      if (decoded.mint !== mintUrl) {
        throw new CashuClientError(
          "verifyProviderPaymentLock: token mint does not match client mint",
        );
      }
      const amountSats = validateProviderPaymentLockProofs(
        decoded.proofs,
        params,
      );
      requireMintSignatureProofs(wallet, decoded.proofs);
      await requireProofsUnspent(wallet, decoded.proofs);
      return {
        proofs: decoded.proofs as CashuProof[],
        amountSats,
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
      const redeem = await redeemSignedProofs({
        wallet,
        signedProofs,
        signingPrivateKey: privkeyHex,
      });
      if (!redeem.ok) mapRedeemFailure(redeem);
      const received = redeem.proofs;
      return {
        proofs: received as CashuProof[],
        amountSats: redeem.amountSats,
      };
    },
  };
}
