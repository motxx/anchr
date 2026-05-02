/**
 * Cashu HTLC client — abstracts the Customer / Provider interactions
 * with a Cashu mint that supports NUT-14 (HTLC) and NUT-11 (P2PK).
 *
 * The two operations the SDK needs:
 *   - Customer side: build an HTLC-locked token. Phase 1 locks against
 *     just `hashlock(H) + locktime + refund(customerPubkey)`; Phase 2
 *     swaps to add a provider pubkey once a quote is selected.
 *   - Provider side: redeem an HTLC-locked token using the preimage `S`
 *     (delivered by the oracle via NIP-44 DM) plus the provider's own
 *     P2PK signature.
 *
 * Like {@link OracleClient}, the SDK does not bake in a single mint
 * implementation — it accepts a CashuClient and lets the caller wire
 * up `@cashu/cashu-ts`, `@anchr/core-cashu`, or any compatible
 * adapter. The default `createCashuClient` ships in a follow-up chunk;
 * for this milestone the interface is stable so consumers can
 * implement adapters and write integration tests against them.
 */

/** A Cashu proof — keep the shape opaque so downstream `cashu-ts` types do not leak through. */
export type CashuProof = Record<string, unknown>;

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

/** Construction options for {@link createCashuClient}. */
export interface CashuClientOptions {
  /** Cashu mint URL (must support NUT-11 P2PK + NUT-14 HTLC). */
  mintUrl: string;
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
 * Construct a CashuClient bound to a specific mint.
 *
 * **Status (v0.0.1):** the wire-level mint integration is implemented
 * incrementally. The constructor and `mintUrl` getter are stable; the
 * operation methods throw a clear "not yet implemented" error so
 * consumers can already wire CashuClient into Customer / Provider and
 * provide custom adapters via dependency injection while the default
 * implementation lands.
 */
export function createCashuClient(options: CashuClientOptions): CashuClient {
  if (typeof options.mintUrl !== "string" || options.mintUrl.length === 0) {
    throw new CashuClientError("mintUrl must be a non-empty string");
  }
  const mintUrl = options.mintUrl;

  const notImplementedError = (op: string): CashuMintError =>
    new CashuMintError(
      `CashuClient.${op}: default mint integration not implemented in v0.0.1. ` +
        "Pass a custom CashuClient implementation via dependency injection " +
        "(or wait for the next SDK milestone).",
    );

  return {
    mintUrl,
    buildHtlcLock(_params: BuildHtlcLockParams): Promise<CashuToken> {
      return Promise.reject(notImplementedError("buildHtlcLock"));
    },
    bindProvider(_params: BindProviderParams): Promise<CashuToken> {
      return Promise.reject(notImplementedError("bindProvider"));
    },
    redeemHtlc(_params: RedeemHtlcParams): Promise<RedeemResult> {
      return Promise.reject(notImplementedError("redeemHtlc"));
    },
  };
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
