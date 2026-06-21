import { Mint, type RequestFn, Wallet } from "@cashu/cashu-ts";
import {
  bindProviderPaymentLock,
  type CashuBindWallet,
} from "./cashu-bind-provider.ts";
import { CashuClientError } from "./cashu-errors.ts";
import type { CashuClient } from "./types.ts";

export interface BrowserCashuClientOptions {
  mintUrl: string;
  wallet?: CashuBindWallet;
  customRequest?: RequestFn;
}

export function createBrowserCashuClient(
  options: BrowserCashuClientOptions,
): CashuClient {
  if (typeof options.mintUrl !== "string" || options.mintUrl.length === 0) {
    throw new CashuClientError("mintUrl must be a non-empty string");
  }
  const mintUrl = options.mintUrl;

  let walletPromise: Promise<CashuBindWallet> | null = null;
  function getWallet(): Promise<CashuBindWallet> {
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
    async bindProvider(params) {
      return await bindProviderPaymentLock({
        mintUrl,
        wallet: await getWallet(),
        bind: params,
      });
    },
    verifyProviderPaymentLock() {
      throw new CashuClientError(
        "browser Cashu client does not verify provider locks",
      );
    },
    redeemHtlc() {
      throw new CashuClientError(
        "browser Cashu client does not redeem HTLCs",
      );
    },
  };
}
