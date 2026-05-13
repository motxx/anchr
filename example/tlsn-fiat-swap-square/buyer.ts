/**
 * TLSN Fiat Swap — Buyer / Provider
 *
 * Provider-side flow: listen for Customer job requests, quote matching
 * Square Sandbox payment predicates, publish a TLSN result after selection,
 * and redeem the HTLC when the Oracle releases the preimage.
 */

import { createProvider } from "anchr-sdk";
import {
  buildFiatSwapResultData,
  FIAT_SWAP_SCHEMA,
  FiatSwapConfigError,
  isFiatSwapPredicate,
  loadBuyerConfig,
  predicateMatchesBuyerConfig,
  readProofBase64,
  tlsnProofCommand,
} from "./fiat-swap.ts";

try {
  const config = loadBuyerConfig();
  const provider = createProvider({
    oracles: [config.oraclePubkey],
    relays: config.relays,
    mint: config.mintUrl,
    privKey: config.providerPrivKey,
    notary: config.notaryUrl,
    selectionTimeoutMs: config.selectionTimeoutMs,
    preimageTimeoutMs: config.preimageTimeoutMs,
  });

  console.log("=== TLSN Fiat Swap Testnet — Buyer / Provider ===\n");
  console.log(`Provider: ${provider.pubkey}`);
  console.log(`Relays:   ${config.relays.join(", ")}`);
  console.log(`Mint:     ${config.mintUrl}`);
  console.log(`Oracle:   ${config.oraclePubkey}`);
  console.log(
    `Accept:   ${config.fiatCurrency} ${
      (config.fiatAmountMinor / 100).toFixed(2)
    } -> ${config.amountSats} sats`,
  );
  console.log();

  if (config.paymentId) {
    console.log("TLSNotary proof command:");
    for (const line of tlsnProofCommand(config.paymentId)) {
      console.log(`  ${line}`);
    }
    console.log();
  } else {
    console.log(
      "Set FIAT_SWAP_PAYMENT_ID after paying the Square Sandbox link to produce proof data.",
    );
    console.log();
  }

  const stop = () => {
    void provider.stop();
  };
  Deno.addSignalListener("SIGINT", stop);
  Deno.addSignalListener("SIGTERM", stop);

  await provider.serve(async (request) => {
    if (request.spec.schema !== FIAT_SWAP_SCHEMA) return null;
    if (!isFiatSwapPredicate(request.spec.predicate)) return null;
    if (!predicateMatchesBuyerConfig(request.spec.predicate, config)) {
      return null;
    }
    if (config.amountSats > request.maxAmountSats) return null;

    console.log(
      `Matched TLSN fiat swap request from ${request.customerPubkey}`,
    );
    console.log(`Quoting ${config.amountSats} sats...`);

    return {
      amountSats: config.amountSats,
      produce: async () => {
        const proof = await readProofBase64(config);
        if (!proof) {
          throw new FiatSwapConfigError(
            "FIAT_SWAP_PROOF_FILE or FIAT_SWAP_PROOF_BASE64 is required after selection",
          );
        }
        return {
          data: buildFiatSwapResultData(config),
          proof,
        };
      },
    };
  });
} catch (err) {
  if (err instanceof FiatSwapConfigError) {
    console.error(`Config error: ${err.message}`);
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  Deno.exit(1);
}
