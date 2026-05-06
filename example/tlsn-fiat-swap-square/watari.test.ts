import { expect } from "@std/expect";
import {
  buildWatariPredicate,
  buildWatariResultData,
  buildWatariSpec,
  isWatariPredicate,
  loadBuyerConfig,
  loadSellerConfig,
  predicateMatchesBuyerConfig,
  SQUARE_SANDBOX_HOST,
  WATARI_QUERY_TAG,
  WATARI_SCHEMA,
  WatariConfigError,
} from "./watari.ts";

const proof = { id: "keyset", amount: 1000, secret: "secret", C: "commitment" };

Deno.test("Watari predicate is pinned to Square Sandbox and exact payment fields", () => {
  const predicate = buildWatariPredicate({
    relays: ["ws://localhost:7777"],
    mintUrl: "http://localhost:3338",
    oraclePubkey: "oracle",
    paymentLink: "https://square.link/u/test",
    amountSats: 1_000,
    fiatAmountMinor: 100,
    fiatCurrency: "JPY",
    maxAttestationAgeSeconds: 600,
    locktimeSeconds: 3_600,
  });

  expect(predicate.target_url).toBe(
    `https://${SQUARE_SANDBOX_HOST}/v2/payments/{payment_id}`,
  );
  expect(predicate.domain_hint).toBe(SQUARE_SANDBOX_HOST);
  expect(predicate.conditions).toEqual([
    {
      type: "jsonpath",
      expression: "payment.status",
      expected: "COMPLETED",
      description: "Square payment status is COMPLETED",
    },
    {
      type: "jsonpath",
      expression: "payment.amount_money.amount",
      expected: "100",
      description: "Square amount matches the Watari quote",
    },
    {
      type: "jsonpath",
      expression: "payment.amount_money.currency",
      expected: "JPY",
      description: "Square currency matches the Watari quote",
    },
  ]);
  expect(predicate.watari).toEqual({
    tag: WATARI_QUERY_TAG,
    amount_sats: 1_000,
    fiat_amount_minor: 100,
    fiat_currency: "JPY",
    payment_link: "https://square.link/u/test",
  });
});

Deno.test("Watari predicate can pin Square payment id and seller location", () => {
  const predicate = buildWatariPredicate({
    relays: ["ws://localhost:7777"],
    mintUrl: "http://localhost:3338",
    oraclePubkey: "oracle",
    paymentId: "pay_123",
    amountSats: 1_000,
    fiatAmountMinor: 100,
    fiatCurrency: "JPY",
    squareLocationId: "LOC123",
    maxAttestationAgeSeconds: 600,
    locktimeSeconds: 3_600,
  });

  expect(predicate.target_url).toBe(
    `https://${SQUARE_SANDBOX_HOST}/v2/payments/pay_123`,
  );
  expect(predicate.conditions.at(-1)).toEqual({
    type: "jsonpath",
    expression: "payment.location_id",
    expected: "LOC123",
    description: "Square location matches the seller",
  });
  expect(predicate.watari.square_location_id).toBe("LOC123");
});

Deno.test("Watari spec uses Customer/Provider schema instead of reference-host payload", () => {
  const spec = buildWatariSpec({
    relays: ["ws://localhost:7777"],
    mintUrl: "http://localhost:3338",
    oraclePubkey: "oracle",
    paymentLink: "https://square.link/u/test",
    amountSats: 1_000,
    fiatAmountMinor: 100,
    fiatCurrency: "JPY",
    maxAttestationAgeSeconds: 600,
    locktimeSeconds: 3_600,
  });

  expect(spec.schema).toBe(WATARI_SCHEMA);
  expect(spec.description?.includes(WATARI_QUERY_TAG)).toBe(true);
  expect(isWatariPredicate(spec.predicate)).toBe(true);
  expect(JSON.stringify(spec)).not.toContain("escrow_token");
  expect(JSON.stringify(spec)).not.toContain("requester_pubkey");
});

Deno.test("seller config fails closed without source proofs", () => {
  expect(() =>
    loadSellerConfig({
      SQUARE_PAYMENT_LINK: "https://square.link/u/test",
      WATARI_ORACLE_ENDPOINT: "http://localhost:3001",
      WATARI_ORACLE_PUBKEY: "oracle",
    })
  ).toThrow(WatariConfigError);
});

Deno.test("seller config normalizes operator env", () => {
  const config = loadSellerConfig({
    NOSTR_RELAYS: "ws://localhost:7777, wss://relay.example",
    CASHU_MINT_URL: "http://localhost:3338/",
    WATARI_ORACLE_ENDPOINT: "http://localhost:3001/",
    WATARI_ORACLE_PUBKEY: "oracle-a",
    WATARI_SOURCE_PROOFS_JSON: JSON.stringify([proof]),
    SQUARE_PAYMENT_LINK: "https://square.link/u/test",
    WATARI_FIAT_CURRENCY: "jpy",
    WATARI_AMOUNT_SATS: "2500",
    WATARI_FIAT_AMOUNT_MINOR: "150",
  });

  expect(config.relays).toEqual(["ws://localhost:7777", "wss://relay.example"]);
  expect(config.mintUrl).toBe("http://localhost:3338");
  expect(config.oracleEndpoint).toBe("http://localhost:3001");
  expect(config.oraclePubkey).toBe("oracle-a");
  expect(config.fiatCurrency).toBe("JPY");
  expect(config.amountSats).toBe(2500);
  expect(config.fiatAmountMinor).toBe(150);
  expect(config.sourceProofs).toEqual([proof]);
});

Deno.test("buyer config requires provider primitive key", () => {
  expect(() =>
    loadBuyerConfig({
      WATARI_ORACLE_PUBKEY: "oracle",
    })
  ).toThrow(WatariConfigError);
});

Deno.test("buyer predicate matching rejects mismatched fiat terms", () => {
  const config = loadBuyerConfig({
    WATARI_ORACLE_PUBKEY: "oracle",
    WATARI_PROVIDER_PRIVKEY: "nsec_or_hex",
    WATARI_AMOUNT_SATS: "1000",
    WATARI_FIAT_AMOUNT_MINOR: "100",
    WATARI_FIAT_CURRENCY: "JPY",
  });
  const predicate = buildWatariPredicate({
    ...config,
    fiatAmountMinor: 200,
  });

  expect(predicateMatchesBuyerConfig(predicate, config)).toBe(false);
});

Deno.test("buyer proof result data carries the exact Square payment target", () => {
  const config = loadBuyerConfig({
    WATARI_ORACLE_PUBKEY: "oracle",
    WATARI_PROVIDER_PRIVKEY: "nsec_or_hex",
    WATARI_PAYMENT_ID: "pay_123",
    WATARI_AMOUNT_SATS: "1000",
    WATARI_FIAT_AMOUNT_MINOR: "100",
    WATARI_FIAT_CURRENCY: "JPY",
  });

  expect(buildWatariResultData(config)).toEqual({
    schema: WATARI_SCHEMA,
    target_url: `https://${SQUARE_SANDBOX_HOST}/v2/payments/pay_123`,
    domain: SQUARE_SANDBOX_HOST,
    payment_id: "pay_123",
    expected: {
      status: "COMPLETED",
      amount_money: { amount: 100, currency: "JPY" },
    },
  });
});
