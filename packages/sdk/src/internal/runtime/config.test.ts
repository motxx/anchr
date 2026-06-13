import { afterEach, describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { getRuntimeConfig } from "./config.ts";
import { withEnv } from "../../testing/helpers.ts";

describe("getRuntimeConfig", () => {
  // Save and clear env vars that affect config
  const envKeys = [
    "HTTP_API_PORT",
    "PORT",
    "PREVIEW_MAX_DIMENSION",
    "PREVIEW_JPEG_QUALITY",
    "HTTP_API_KEYS",
    "HTTP_API_KEY",
    "TRUSTED_ORACLE_PUBKEYS",
    "TLSN_VERIFIER_URL",
    "TLSN_PROXY_URL",
  ];

  test("returns default values when env is empty", () => {
    const clear: Record<string, string | undefined> = {};
    for (const k of envKeys) clear[k] = undefined;

    withEnv(clear, () => {
      const config = getRuntimeConfig();
      expect(config.httpApiPort).toBe(3000);
      expect(config.previewMaxDimension).toBe(768);
      expect(config.previewJpegQuality).toBe(75);
      expect(config.httpApiKeys).toEqual([]);
      expect(config.trustedOraclePubkeys).toEqual([]);
    });
  });

  test("reads numeric env vars", () => {
    withEnv({ PORT: "4000", HTTP_API_PORT: undefined }, () => {
      expect(getRuntimeConfig().httpApiPort).toBe(4000);
    });

    withEnv({ HTTP_API_PORT: "5000", PORT: "4000" }, () => {
      // HTTP_API_PORT takes precedence over PORT
      expect(getRuntimeConfig().httpApiPort).toBe(5000);
    });
  });

  test("falls back on invalid numeric values", () => {
    withEnv({ PORT: "not-a-number", HTTP_API_PORT: undefined }, () => {
      expect(getRuntimeConfig().httpApiPort).toBe(3000);
    });

    withEnv({ PORT: "-1", HTTP_API_PORT: undefined }, () => {
      expect(getRuntimeConfig().httpApiPort).toBe(3000);
    });

    withEnv({ PORT: "0", HTTP_API_PORT: undefined }, () => {
      expect(getRuntimeConfig().httpApiPort).toBe(3000);
    });
  });

  test("reads comma-separated string list", () => {
    withEnv({ HTTP_API_KEYS: "key1,key2, key3 " }, () => {
      expect(getRuntimeConfig().httpApiKeys).toEqual(["key1", "key2", "key3"]);
    });
  });

  test("falls back to second env name for string list", () => {
    withEnv({ HTTP_API_KEYS: undefined, HTTP_API_KEY: "single-key" }, () => {
      expect(getRuntimeConfig().httpApiKeys).toEqual(["single-key"]);
    });
  });

  test("filters empty entries from string list", () => {
    withEnv({ HTTP_API_KEYS: "key1,,, key2, " }, () => {
      expect(getRuntimeConfig().httpApiKeys).toEqual(["key1", "key2"]);
    });
  });

  test("reads trusted oracle pubkeys", () => {
    withEnv({ TRUSTED_ORACLE_PUBKEYS: "pub1,pub2" }, () => {
      expect(getRuntimeConfig().trustedOraclePubkeys).toEqual(["pub1", "pub2"]);
    });
  });
});
