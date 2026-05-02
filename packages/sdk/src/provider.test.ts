import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  createProvider,
  ProviderConfigError,
  shouldQuote,
  validateProviderOptions,
} from "./provider.ts";

const validOptions = {
  oracles: ["npub1oracle1"],
  relays: ["wss://relay.example.org"],
  mint: "https://mint.example.org",
  privKey: "nsec1providerkey",
};

test("validateProviderOptions accepts a well-formed options object", () => {
  expect(() => validateProviderOptions(validOptions)).not.toThrow();
});

test("validateProviderOptions accepts an optional notary URL", () => {
  expect(() =>
    validateProviderOptions({ ...validOptions, notary: "wss://notary.example.org" })
  ).not.toThrow();
});

test("validateProviderOptions rejects empty oracles array", () => {
  expect(() => validateProviderOptions({ ...validOptions, oracles: [] }))
    .toThrow(ProviderConfigError);
});

test("validateProviderOptions rejects empty relays array", () => {
  expect(() => validateProviderOptions({ ...validOptions, relays: [] }))
    .toThrow(ProviderConfigError);
});

test("validateProviderOptions rejects missing privKey", () => {
  expect(() => validateProviderOptions({ ...validOptions, privKey: "" }))
    .toThrow(ProviderConfigError);
});

test("validateProviderOptions rejects empty-string notary when provided", () => {
  expect(() => validateProviderOptions({ ...validOptions, notary: "" }))
    .toThrow(ProviderConfigError);
});

test("createProvider exposes oracles / relays / mint / notary as readonly", () => {
  const provider = createProvider({ ...validOptions, notary: "wss://notary.example.org" });
  expect([...provider.oracles]).toEqual(validOptions.oracles);
  expect([...provider.relays]).toEqual(validOptions.relays);
  expect(provider.mint).toEqual(validOptions.mint);
  expect(provider.notary).toEqual("wss://notary.example.org");
});

test("createProvider does not require notary (defaults to undefined)", () => {
  const provider = createProvider(validOptions);
  expect(provider.notary).toBe(undefined);
});

test("Provider.serve throws not-implemented when reaching the wire flow", async () => {
  const provider = createProvider(validOptions);
  await expect(provider.serve(async () => null))
    .rejects.toThrow(/not implemented in v0\.0\.1/);
});

test("shouldQuote returns true when oracle is in whitelist", () => {
  expect(shouldQuote(["a", "b", "c"], "b")).toBe(true);
});

test("shouldQuote returns false when oracle is not in whitelist", () => {
  expect(shouldQuote(["a", "b"], "c")).toBe(false);
});

test("shouldQuote returns false on empty whitelist", () => {
  expect(shouldQuote([], "a")).toBe(false);
});
