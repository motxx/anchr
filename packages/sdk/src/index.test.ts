import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  createCashuClient,
  createCustomer,
  createHttpOracleClient,
  createProvider,
  createRelayClient,
} from "./index.ts";
import * as sdk from "./index.ts";

describe("Anchr SDK", () => {
  test("root surface exposes actor setup helpers", () => {
    expect(createCustomer).toBeInstanceOf(Function);
    expect(createProvider).toBeInstanceOf(Function);
    expect(createHttpOracleClient).toBeInstanceOf(Function);
    expect(createRelayClient).toBeInstanceOf(Function);
    expect(createCashuClient).toBeInstanceOf(Function);
  });

  test("root surface does not expose a hosted HTTP client", () => {
    expect(Object.hasOwn(sdk, "Anchr")).toBe(false);
    expect(Object.hasOwn(sdk, "default")).toBe(false);
  });
});
