import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  createCustomer,
  CustomerConfigError,
  pickOracleForRequest,
  selectCheapestQuote,
  validateCustomerOptions,
} from "./customer.ts";
import { InvalidSchemaUriError } from "./schema.ts";
import type { Quote } from "./types.ts";

const validOptions = {
  oracles: ["npub1oracle1", "npub1oracle2"],
  relays: ["wss://relay.example.org"],
  mint: "https://mint.example.org",
};

test("validateCustomerOptions accepts a well-formed options object", () => {
  expect(() => validateCustomerOptions(validOptions)).not.toThrow();
});

test("validateCustomerOptions rejects empty oracles array", () => {
  expect(() => validateCustomerOptions({ ...validOptions, oracles: [] }))
    .toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects empty oracle entries", () => {
  expect(() => validateCustomerOptions({ ...validOptions, oracles: [""] }))
    .toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects empty relays array", () => {
  expect(() => validateCustomerOptions({ ...validOptions, relays: [] }))
    .toThrow(CustomerConfigError);
});

test("validateCustomerOptions rejects missing mint", () => {
  expect(() => validateCustomerOptions({ ...validOptions, mint: "" }))
    .toThrow(CustomerConfigError);
});

test("createCustomer exposes oracles / relays / mint as readonly copies", () => {
  const customer = createCustomer(validOptions);
  expect([...customer.oracles]).toEqual(validOptions.oracles);
  expect([...customer.relays]).toEqual(validOptions.relays);
  expect(customer.mint).toEqual(validOptions.mint);
});

test("createCustomer copies arrays so mutating the original does not affect the client", () => {
  const oracles = ["npub1a", "npub1b"];
  const customer = createCustomer({ ...validOptions, oracles });
  oracles.push("npub1c");
  expect(customer.oracles).toHaveLength(2);
});

test("Customer.request rejects an invalid schema URI synchronously", async () => {
  const customer = createCustomer(validOptions);
  await expect(
    customer.request({
      spec: { schema: "not-a-valid-uri", predicate: {} },
      payment: { maxAmount: 1000 },
    }),
  ).rejects.toThrow(InvalidSchemaUriError);
});

test("Customer.request rejects non-positive maxAmount", async () => {
  const customer = createCustomer(validOptions);
  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: {} },
      payment: { maxAmount: 0 },
    }),
  ).rejects.toThrow(CustomerConfigError);
});

test("Customer.request throws not-implemented when reaching the wire flow", async () => {
  const customer = createCustomer(validOptions);
  await expect(
    customer.request({
      spec: { schema: "io.anchr.tlsn-https.v1", predicate: { foo: "bar" } },
      payment: { maxAmount: 1000 },
    }),
  ).rejects.toThrow(/not implemented in v0\.0\.1/);
});

test("pickOracleForRequest returns the first oracle by default (v0)", () => {
  expect(pickOracleForRequest(["npub1a", "npub1b"])).toBe("npub1a");
});

test("pickOracleForRequest throws on empty whitelist", () => {
  expect(() => pickOracleForRequest([])).toThrow(CustomerConfigError);
});

test("selectCheapestQuote returns null on empty input", () => {
  expect(selectCheapestQuote([])).toBe(null);
});

test("selectCheapestQuote picks the lowest amount", () => {
  const quotes: Quote[] = [
    { providerPubkey: "a", amountSats: 1000, quoteEventId: "ea", receivedAt: 1 },
    { providerPubkey: "b", amountSats: 500, quoteEventId: "eb", receivedAt: 2 },
    { providerPubkey: "c", amountSats: 750, quoteEventId: "ec", receivedAt: 3 },
  ];
  expect(selectCheapestQuote(quotes)?.providerPubkey).toBe("b");
});
