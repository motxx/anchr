import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  toYesFrostNodeConfig,
  toNoFrostNodeConfig,
} from "./market-frost-config.ts";
import type { MarketFrostNodeConfig } from "./market-frost-config.ts";

function makeMockConfig(): MarketFrostNodeConfig {
  return {
    signer_index: 1,
    total_signers: 3,
    threshold: 2,
    key_package: { yes_key: "yes_secret_share" },
    pubkey_package: { yes_pubkey: "yes_pubkey_package" },
    group_pubkey: "aa".repeat(32),
    peers: [
      { signer_index: 1, endpoint: "http://localhost:4001" },
      { signer_index: 2, endpoint: "http://localhost:4002" },
      { signer_index: 3, endpoint: "http://localhost:4003" },
    ],
    key_package_no: { no_key: "no_secret_share" },
    pubkey_package_no: { no_pubkey: "no_pubkey_package" },
    group_pubkey_no: "bb".repeat(32),
  };
}

test("toYesFrostNodeConfig extracts YES group fields", () => {
  const config = makeMockConfig();
  const yesConfig = toYesFrostNodeConfig(config);

  expect(yesConfig.signer_index).toBe(1);
  expect(yesConfig.total_signers).toBe(3);
  expect(yesConfig.threshold).toBe(2);
  expect(yesConfig.key_package).toEqual({ yes_key: "yes_secret_share" });
  expect(yesConfig.pubkey_package).toEqual({ yes_pubkey: "yes_pubkey_package" });
  expect(yesConfig.group_pubkey).toBe("aa".repeat(32));
  expect(yesConfig.peers.length).toBe(3);
});

test("toNoFrostNodeConfig extracts NO group fields", () => {
  const config = makeMockConfig();
  const noConfig = toNoFrostNodeConfig(config);

  expect(noConfig.signer_index).toBe(1);
  expect(noConfig.total_signers).toBe(3);
  expect(noConfig.threshold).toBe(2);
  expect(noConfig.key_package).toEqual({ no_key: "no_secret_share" });
  expect(noConfig.pubkey_package).toEqual({ no_pubkey: "no_pubkey_package" });
  expect(noConfig.group_pubkey).toBe("bb".repeat(32));
  expect(noConfig.peers.length).toBe(3);
});

test("YES and NO configs have different group pubkeys", () => {
  const config = makeMockConfig();
  const yesConfig = toYesFrostNodeConfig(config);
  const noConfig = toNoFrostNodeConfig(config);

  expect(yesConfig.group_pubkey).not.toBe(noConfig.group_pubkey);
});

test("YES and NO configs share the same peer list", () => {
  const config = makeMockConfig();
  const yesConfig = toYesFrostNodeConfig(config);
  const noConfig = toNoFrostNodeConfig(config);

  expect(yesConfig.peers).toEqual(noConfig.peers);
});

test("MarketFrostNodeConfig preserves signer identity across groups", () => {
  const config = makeMockConfig();
  const yesConfig = toYesFrostNodeConfig(config);
  const noConfig = toNoFrostNodeConfig(config);

  // Same signer in both groups
  expect(yesConfig.signer_index).toBe(noConfig.signer_index);
  expect(yesConfig.threshold).toBe(noConfig.threshold);
  expect(yesConfig.total_signers).toBe(noConfig.total_signers);
});
