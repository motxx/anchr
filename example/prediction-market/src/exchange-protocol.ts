/**
 * P2P Token Exchange Protocol — trustless token creation and verification.
 *
 * In the non-custodial prediction market, users create their own P2PK-locked
 * tokens in the browser. The matchmaker only announces matches; it never
 * touches tokens. This module provides:
 *
 *   - createLockedToken: Create a P2PK-locked token for exchange phase
 *   - verifyReceivedToken: Verify a received token has correct conditions
 *   - createMarketToken: Replace short-locktime exchange token with long-locktime
 *
 * Token flow:
 *   1. User bets -> matchmaker returns counterparty pubkey + group pubkeys
 *   2. User creates P2PK-locked token (short locktime for exchange)
 *   3. Counterparty verifies and accepts (or short locktime expires -> refund)
 *   4. After exchange confirmed, replace with long-locktime market token
 */

import {
  P2PKBuilder,
  type Proof,
  type P2PKOptions,
  getEncodedToken,
  getDecodedToken,
  type Wallet,
} from "@cashu/cashu-ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExchangeConfig {
  mintUrl: string;
  marketGroupPubkeyYes: string;
  marketGroupPubkeyNo: string;
  myPubkey: string;
  mySide: "yes" | "no";
  counterpartyPubkey: string;
  amountSats: number;
  /** Short locktime for exchange phase (e.g., now + 10 min). */
  exchangeLocktime: number;
  /** Long locktime for market duration (e.g., deadline + 1h). */
  marketLocktime: number;
}

export interface TokenResult {
  /** cashuB-encoded token string. */
  token: string;
  /** The P2PK-locked proofs. */
  proofs: Proof[];
}

export interface VerificationResult {
  valid: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// P2PK condition builders (exchange phase — short locktime)
// ---------------------------------------------------------------------------

/**
 * Build P2PK options for a YES bettor's exchange token.
 *
 * YES bettor's token is redeemable by NO bettor if NO wins:
 * Lock: P2PK([group_no, counterparty], n_sigs=2), refund: myPubkey
 *
 * YES bettor's counterparty is the NO bettor.
 */
function buildExchangeOptionsYes(config: ExchangeConfig, locktime: number): P2PKOptions {
  return new P2PKBuilder()
    .addLockPubkey([config.marketGroupPubkeyNo, config.counterpartyPubkey])
    .requireLockSignatures(2)
    .lockUntil(locktime)
    .addRefundPubkey(config.myPubkey)
    .requireRefundSignatures(1)
    .sigAll()
    .toOptions();
}

/**
 * Build P2PK options for a NO bettor's exchange token.
 *
 * NO bettor's token is redeemable by YES bettor if YES wins:
 * Lock: P2PK([group_yes, counterparty], n_sigs=2), refund: myPubkey
 *
 * NO bettor's counterparty is the YES bettor.
 */
function buildExchangeOptionsNo(config: ExchangeConfig, locktime: number): P2PKOptions {
  return new P2PKBuilder()
    .addLockPubkey([config.marketGroupPubkeyYes, config.counterpartyPubkey])
    .requireLockSignatures(2)
    .lockUntil(locktime)
    .addRefundPubkey(config.myPubkey)
    .requireRefundSignatures(1)
    .sigAll()
    .toOptions();
}

/**
 * Build P2PK options based on side and locktime.
 */
function buildOptionsForSide(config: ExchangeConfig, locktime: number): P2PKOptions {
  return config.mySide === "yes"
    ? buildExchangeOptionsYes(config, locktime)
    : buildExchangeOptionsNo(config, locktime);
}

// ---------------------------------------------------------------------------
// Token creation
// ---------------------------------------------------------------------------

/**
 * Create a P2PK-locked token for the exchange phase.
 *
 * Uses a short locktime (e.g., 10 minutes) so if the counterparty
 * never shows up, the token refunds quickly.
 *
 * @param wallet - Cashu wallet instance (works in browser)
 * @param proofs - Plain proofs to lock
 * @param config - Exchange configuration with pubkeys and locktimes
 */
export async function createLockedToken(
  wallet: Wallet,
  proofs: Proof[],
  config: ExchangeConfig,
): Promise<TokenResult> {
  const options = buildOptionsForSide(config, config.exchangeLocktime);

  await wallet.loadMint();
  const { send } = await wallet.ops
    .send(config.amountSats, proofs)
    .asP2PK(options)
    .run();

  return {
    token: getEncodedToken({ mint: config.mintUrl, proofs: send }),
    proofs: send,
  };
}

/**
 * Create a long-locktime replacement token after exchange is confirmed.
 *
 * After both parties have exchanged short-locktime tokens and verified them,
 * each party creates a new token with the market locktime (deadline + buffer).
 *
 * In practice, this means:
 * 1. Receive short-locktime token from counterparty
 * 2. Swap it at the mint for plain proofs (using privkey for P2PK unlock)
 * 3. Re-lock with long market locktime
 *
 * For the demo flow where the server relays tokens, this step happens
 * automatically — the server verifies short-locktime tokens and the
 * client creates market-duration tokens.
 *
 * @param wallet - Cashu wallet instance
 * @param proofs - Plain proofs to lock with market locktime
 * @param config - Exchange configuration
 */
export async function createMarketToken(
  wallet: Wallet,
  proofs: Proof[],
  config: ExchangeConfig,
): Promise<TokenResult> {
  const options = buildOptionsForSide(config, config.marketLocktime);

  await wallet.loadMint();
  const { send } = await wallet.ops
    .send(config.amountSats, proofs)
    .asP2PK(options)
    .run();

  return {
    token: getEncodedToken({ mint: config.mintUrl, proofs: send }),
    proofs: send,
  };
}

// ---------------------------------------------------------------------------
// Token verification
// ---------------------------------------------------------------------------

/**
 * Verify that a received P2PK-locked token has the correct conditions.
 *
 * Checks:
 * 1. Token decodes successfully
 * 2. Total amount matches expected
 * 3. Each proof's secret is a valid P2PK secret
 * 4. Lock pubkeys include the expected group pubkey and my pubkey
 * 5. n_sigs = 2
 * 6. Locktime >= minLocktime
 *
 * @param token - cashuB-encoded token string
 * @param expected - Expected conditions to verify against
 */
export function verifyReceivedToken(
  token: string,
  expected: {
    groupPubkey: string;
    myPubkey: string;
    amount: number;
    minLocktime: number;
  },
): VerificationResult {
  // 1. Decode token
  let decoded;
  try {
    decoded = getDecodedToken(token);
  } catch {
    return { valid: false, error: "Failed to decode cashu token" };
  }

  const proofs = decoded.proofs;
  if (!proofs || proofs.length === 0) {
    return { valid: false, error: "Token contains no proofs" };
  }

  // 2. Verify total amount
  const totalAmount = proofs.reduce((sum: number, p: Proof) => sum + p.amount, 0);
  if (totalAmount < expected.amount) {
    return {
      valid: false,
      error: `Insufficient amount: got ${totalAmount}, need ${expected.amount}`,
    };
  }

  // 3-6. Verify each proof's P2PK conditions
  for (const proof of proofs) {
    const secretResult = parseP2PKSecret(proof.secret);
    if (!secretResult.valid) {
      return { valid: false, error: `Invalid P2PK secret: ${secretResult.error}` };
    }

    const { pubkeys, nSigs, locktime } = secretResult;

    // 4. Check lock pubkeys include group pubkey AND my pubkey
    if (!pubkeys.includes(expected.groupPubkey)) {
      return {
        valid: false,
        error: `Missing group pubkey in lock conditions: ${expected.groupPubkey}`,
      };
    }
    if (!pubkeys.includes(expected.myPubkey)) {
      return {
        valid: false,
        error: `Missing my pubkey in lock conditions: ${expected.myPubkey}`,
      };
    }

    // 5. Check n_sigs = 2
    if (nSigs !== 2) {
      return {
        valid: false,
        error: `Expected n_sigs=2, got n_sigs=${nSigs}`,
      };
    }

    // 6. Check locktime
    if (locktime !== undefined && locktime < expected.minLocktime) {
      return {
        valid: false,
        error: `Locktime too short: ${locktime} < ${expected.minLocktime}`,
      };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// P2PK secret parsing
// ---------------------------------------------------------------------------

interface P2PKParseResult {
  valid: boolean;
  error?: string;
  pubkeys: string[];
  nSigs: number;
  locktime?: number;
}

/**
 * Parse a NUT-11 P2PK secret and extract relevant fields.
 *
 * NUT-11 secrets are JSON arrays: ["P2PK", { data, nonce, tags }]
 * Tags include: ["pubkeys", ...], ["n_sigs", "N"], ["locktime", "T"], ["sigflag", ...]
 */
function parseP2PKSecret(secret: string): P2PKParseResult {
  try {
    const parsed = JSON.parse(secret);
    if (!Array.isArray(parsed) || parsed[0] !== "P2PK") {
      return { valid: false, error: "Not a P2PK secret", pubkeys: [], nSigs: 0 };
    }

    const payload = parsed[1];
    if (!payload || typeof payload !== "object") {
      return { valid: false, error: "Invalid P2PK payload", pubkeys: [], nSigs: 0 };
    }

    const tags = payload.tags || [];
    let pubkeys: string[] = [];
    let nSigs = 1;
    let locktime: number | undefined;

    // The primary pubkey from the data field
    if (payload.data) {
      pubkeys.push(payload.data);
    }

    for (const tag of tags) {
      if (!Array.isArray(tag) || tag.length < 2) continue;
      const [key, ...values] = tag;

      switch (key) {
        case "pubkeys":
          pubkeys = pubkeys.concat(values);
          break;
        case "n_sigs":
          nSigs = parseInt(values[0], 10) || 1;
          break;
        case "locktime":
          locktime = parseInt(values[0], 10) || undefined;
          break;
      }
    }

    return { valid: true, pubkeys, nSigs, locktime };
  } catch {
    return { valid: false, error: "Failed to parse secret JSON", pubkeys: [], nSigs: 0 };
  }
}
