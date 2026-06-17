/**
 * In-memory CashuClient fake for tests, examples, and simulations: no mint
 * round-trips, deterministic tokens, and recorded calls for assertions.
 */

import type {
  BindProviderParams,
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
  const binds: BindProviderParams[] = [];
  const redeems: RedeemHtlcParams[] = [];

  return {
    mintUrl,
    binds,
    redeems,
    bindProvider(params) {
      binds.push(params);
      return Promise.resolve({
        token: "cashuB-in-memory-bound",
        amountSats: params.amountSats,
        proofs: [],
      });
    },
    redeemHtlc(params): Promise<RedeemResult> {
      redeems.push(params);
      return Promise.resolve({ proofs: [], amountSats });
    },
  };
}
