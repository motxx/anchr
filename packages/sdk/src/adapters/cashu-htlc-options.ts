import { P2PKBuilder, type P2PKOptions } from "@cashu/cashu-ts";

interface HtlcPreselectionLockParams {
  requesterPubkey: string;
}

interface HtlcWorkerBindParams {
  hash: string;
  workerPubkey: string;
  requesterRefundPubkey: string;
  locktimeSeconds: number;
}

export function buildHtlcPreselectionOptions(
  params: HtlcPreselectionLockParams,
): P2PKOptions {
  return new P2PKBuilder()
    .addLockPubkey(params.requesterPubkey)
    .requireLockSignatures(1)
    .sigAll()
    .toOptions();
}

export function buildHtlcFinalOptions(
  params: HtlcWorkerBindParams,
): P2PKOptions {
  return new P2PKBuilder()
    .addHashlock(params.hash)
    .addLockPubkey(params.workerPubkey)
    .requireLockSignatures(1)
    .lockUntil(params.locktimeSeconds)
    .addRefundPubkey(params.requesterRefundPubkey)
    .requireRefundSignatures(1)
    .sigAll()
    .toOptions();
}
