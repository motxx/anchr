import { P2PKBuilder, type P2PKOptions } from "@cashu/cashu-ts";

interface HtlcPreselectionLockParams {
  customerPubkey: string;
}

interface HtlcProviderBindParams {
  hash: string;
  providerPubkey: string;
  customerRefundPubkey: string;
  locktimeSeconds: number;
}

export function buildHtlcPreselectionOptions(
  params: HtlcPreselectionLockParams,
): P2PKOptions {
  return new P2PKBuilder()
    .addLockPubkey(params.customerPubkey)
    .requireLockSignatures(1)
    .sigAll()
    .toOptions();
}

export function buildHtlcFinalOptions(
  params: HtlcProviderBindParams,
): P2PKOptions {
  return new P2PKBuilder()
    .addHashlock(params.hash)
    .addLockPubkey(params.providerPubkey)
    .requireLockSignatures(1)
    .lockUntil(params.locktimeSeconds)
    .addRefundPubkey(params.customerRefundPubkey)
    .requireRefundSignatures(1)
    .sigAll()
    .toOptions();
}
