import { getEncodedToken, type P2PKOptions, type Proof } from "@cashu/cashu-ts";
import { buildHtlcFinalOptions } from "../payments/cashu/cashu-htlc-options.ts";
import type { BindProviderParams, CashuProof, CashuToken } from "./types.ts";
import { CashuClientError, CashuMintError } from "./cashu-errors.ts";

export interface CashuBindSendChain {
  asP2PK(options: P2PKOptions): CashuBindSendChain;
  privkey(k: string | string[]): CashuBindSendChain;
  includeFees?(on?: boolean): CashuBindSendChain;
  run(): Promise<{ send: Proof[]; keep?: Proof[] }>;
}

export interface CashuBindWallet {
  ops: {
    send(amount: number, proofs: Proof[]): CashuBindSendChain;
  };
  getFeesForProofs(proofs: Proof[]): number;
}

export function validateHashHex(hash: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(hash)) {
    throw new CashuClientError(
      `Invalid hash hex (expected 64-char hex): ${hash}`,
    );
  }
  return hash.toLowerCase();
}

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

export async function bindProviderPaymentLock(params: {
  mintUrl: string;
  wallet: CashuBindWallet;
  bind: BindProviderParams;
}): Promise<CashuToken> {
  const p = params.bind;
  const normalizedHash = validateHashHex(p.hashHex);
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
  const inputProofs = requireFundingProofs(p.fundingProofs);
  const totalAmount = sumAmounts(inputProofs);
  if (totalAmount <= 0) {
    throw new CashuClientError(
      "fundingProofs contains no spendable proofs",
    );
  }

  const fee = params.wallet.getFeesForProofs(inputProofs);
  const requiredAmount = p.amountSats + fee;
  if (totalAmount < requiredAmount) {
    throw new CashuMintError(
      `bindProvider: mint fee ${fee} leaves ${
        totalAmount - fee
      } sats for ${p.amountSats} sat lock`,
    );
  }

  const phase2 = buildHtlcP2PKOptions(p, normalizedHash);
  const customerPrivkeyHex = bytesToHexLocal(p.customerSecretKey);

  let keep: Proof[];
  let send: Proof[];
  try {
    let chain = params.wallet.ops
      .send(p.amountSats, inputProofs)
      .privkey(customerPrivkeyHex)
      .asP2PK(phase2);
    if (chain.includeFees !== undefined) {
      chain = chain.includeFees(true);
    } else if (fee > 0) {
      throw new CashuClientError(
        "bindProvider: wallet send builder cannot include receiver fees",
      );
    }
    const result = await chain.run();
    keep = result.keep ?? [];
    send = result.send;
  } catch (err) {
    if (err instanceof CashuClientError) throw err;
    throw new CashuMintError("bindProvider: mint swap failed", err);
  }

  const token = getEncodedToken({ mint: params.mintUrl, proofs: send }, {
    version: 4,
  });
  return {
    token,
    amountSats: sumAmounts(send) - params.wallet.getFeesForProofs(send),
    proofs: send as CashuProof[],
    changeProofs: keep as CashuProof[],
  };
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

function buildHtlcP2PKOptions(
  p: BindProviderParams,
  hashHex: string,
): P2PKOptions {
  return buildHtlcFinalOptions({
    hash: hashHex,
    providerPubkey: p.providerPubkey,
    customerRefundPubkey: p.customerPubkey,
    locktimeSeconds: p.locktimeSeconds,
  });
}

function requireFundingProofs(proofs: CashuProof[]): Proof[] {
  if (!Array.isArray(proofs) || proofs.length === 0) {
    throw new CashuClientError("fundingProofs must be a non-empty array");
  }
  const checked: Proof[] = [];
  for (const proof of proofs) {
    if (!isValidProofShape(proof)) {
      throw new CashuClientError(
        "fundingProofs contains a malformed proof",
      );
    }
    checked.push(proof);
  }
  return checked;
}

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
