/**
 * 渡(Watari) — Seller
 *
 * Customer-side flow: lock Cashu proofs, publish a Nostr job request, select
 * a Provider quote, and wait for the Provider's Square Sandbox TLSN result.
 */

import { createCustomer, createHttpOracleClient } from "anchr-sdk";
import {
  buildWatariSpec,
  loadSellerConfig,
  type SellerConfig,
  WatariConfigError,
} from "./watari.ts";

function printConfig(config: SellerConfig) {
  console.log("=== 渡(Watari) Testnet — Seller / Customer ===\n");
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

  console.log("Publishing Watari request and waiting for Provider quotes...");
  const result = await customer.request({
    spec: buildWatariSpec(config),
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
  if (err instanceof WatariConfigError) {
    console.error(`Config error: ${err.message}`);
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  Deno.exit(1);
}
