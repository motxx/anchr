import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  createCashuClient,
  createCustomer,
  createNostrOracleClient,
  createProvider,
  createRelayClient,
  ProofSchema,
} from "./index.ts";
import * as sdk from "./index.ts";

describe("Anchr SDK", () => {
  test("root surface exposes actor setup helpers", () => {
    expect(createCustomer).toBeInstanceOf(Function);
    expect(createProvider).toBeInstanceOf(Function);
    expect(createNostrOracleClient).toBeInstanceOf(Function);
    expect(createRelayClient).toBeInstanceOf(Function);
    expect(createCashuClient).toBeInstanceOf(Function);
    expect(ProofSchema.TlsnV1).toBe(
      "https://anchr-spec.org/spec/proof/tlsn/v1",
    );
  });

  test("root surface does not expose a hosted HTTP client", () => {
    expect(Object.hasOwn(sdk, "Anchr")).toBe(false);
    expect(Object.hasOwn(sdk, "default")).toBe(false);
  });
});
