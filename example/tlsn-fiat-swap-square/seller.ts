/**
 * TLSN Fiat Swap — Seller / Customer
 *
 * Customer-side flow: lock Cashu proofs, publish a Nostr job request, select
 * a Provider quote, and wait for the Provider's Square Sandbox TLSN result.
 */

import { createCustomer, createHttpOracleClient } from "anchr-sdk";
import {
  buildFiatSwapSpec,
  FiatSwapConfigError,
  loadSellerConfig,
  type SellerConfig,
} from "./fiat-swap.ts";

function printConfig(config: SellerConfig) {
  console.log("=== TLSN Fiat Swap Testnet — Seller / Customer ===\n");
  console.log(`Relays:   ${config.relays.join(", ")}`);
  console.log(`Mint:     ${config.mintUrl}`);
  console.log(`Oracle:   ${config.oraclePubkey}`);
  console.log(`Payment:  ${config.paymentLink}`);
  console.log(
    `Quote:    ${config.fiatCurrency} ${
      (config.fiatAmountMinor / 100).toFixed(2)
    } -> ${config.amountSats} sats`,
  );
  if (config.providerPubkey) console.log(`Provider: ${config.providerPubkey}`);
  console.log();
}

try {
  const config = loadSellerConfig();
  printConfig(config);

  const oracleClient = createHttpOracleClient({
    endpoint: config.oracleEndpoint,
    oraclePubkey: config.oraclePubkey,
    apiKey: config.oracleApiKey,
  });
  const customer = createCustomer({
    oracles: [config.oraclePubkey],
    relays: config.relays,
    mint: config.mintUrl,
    oracleClient,
    quoteWindowMs: config.quoteWindowMs,
    resultTimeoutMs: config.resultTimeoutMs,
  });

  console.log(
    "Publishing TLSN fiat swap request and waiting for Provider quotes...",
  );
  const result = await customer.request({
    spec: buildFiatSwapSpec(config),
    payment: {
      maxAmount: config.amountSats,
      locktimeSeconds: config.locktimeSeconds,
    },
    sourceProofs: config.sourceProofs,
    provider: config.providerPubkey,
  });

  console.log("\nOrder completed.");
  console.log(`Provider: ${result.providerPubkey}`);
  console.log(`Schema:   ${result.schema}`);
  console.log("Data:");
  console.log(JSON.stringify(result.data, null, 2));
  console.log(
    `Proof:    ${
      typeof result.proof === "string"
        ? `${result.proof.length} base64 chars`
        : `${result.proof.byteLength} bytes`
    }`,
  );
} catch (err) {
  if (err instanceof FiatSwapConfigError) {
    console.error(`Config error: ${err.message}`);
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  Deno.exit(1);
}
