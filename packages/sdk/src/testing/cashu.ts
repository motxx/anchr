/**
 * In-memory CashuClient fake for tests, examples, and simulations: no mint
 * round-trips, deterministic tokens, and recorded calls for assertions.
 */

import type {
  BindProviderParams,
  BuildHtlcLockParams,
  CashuClient,
  RedeemHtlcParams,
  RedeemResult,
} from "../adapters/types.ts";

export interface InMemoryCashuClientOptions {
  mintUrl?: string;
  /** Amount echoed by bindProvider/redeemHtlc results (default 100). */
  amountSats?: number;
}

export interface InMemoryCashuClient extends CashuClient {
  /** buildHtlcLock calls, in order. */
  readonly locks: BuildHtlcLockParams[];
  /** bindProvider calls, in order. */
  readonly binds: BindProviderParams[];
  /** redeemHtlc calls, in order. */
  readonly redeems: RedeemHtlcParams[];
}

export function createInMemoryCashuClient(
  options: InMemoryCashuClientOptions = {},
): InMemoryCashuClient {
  const mintUrl = options.mintUrl ?? "https://mint.test.example";
  const amountSats = options.amountSats ?? 100;
  const locks: BuildHtlcLockParams[] = [];
  const binds: BindProviderParams[] = [];
  const redeems: RedeemHtlcParams[] = [];

  return {
    mintUrl,
    locks,
    binds,
    redeems,
    buildHtlcLock(params) {
      locks.push(params);
      return Promise.resolve({
        token: "cashuB-in-memory-initial",
        amountSats: params.amountSats,
        proofs: params.sourceProofs,
      });
    },
    bindProvider(params) {
      binds.push(params);
      return Promise.resolve({
        token: "cashuB-in-memory-bound",
        amountSats,
        proofs: params.initialProofs,
      });
    },
    redeemHtlc(params): Promise<RedeemResult> {
      redeems.push(params);
      return Promise.resolve({ proofs: [], amountSats });
    },
  };
}
