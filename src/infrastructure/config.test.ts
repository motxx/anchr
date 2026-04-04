import { describe, test, afterEach } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { getRuntimeConfig } from "./config";
import { withEnv } from "../testing/helpers";

describe("getRuntimeConfig", () => {
  // Save and clear env vars that affect config
  const envKeys = [
    "REFERENCE_APP_PORT", "PORT", "QUERY_SWEEP_INTERVAL_MS",
    "PREVIEW_MAX_DIMENSION", "PREVIEW_JPEG_QUALITY",
    "HTTP_API_KEYS", "HTTP_API_KEY",
    "ANTHROPIC_API_KEY", "AI_CONTENT_CHECK",
    "REMOTE_QUERY_API_BASE_URL", "REMOTE_QUERY_API_KEY",
    "TRUSTED_ORACLE_PUBKEYS",
    "TLSN_VERIFIER_URL", "TLSN_PROXY_URL",
  ];

  test("returns default values when env is empty", () => {
    const clear: Record<string, string | undefined> = {};
    for (const k of envKeys) clear[k] = undefined;

    withEnv(clear, () => {
      const config = getRuntimeConfig();
      expect(config.referenceAppPort).toBe(3000);
      expect(config.querySweepIntervalMs).toBe(30_000);
      expect(config.previewMaxDimension).toBe(768);
      expect(config.previewJpegQuality).toBe(75);
      expect(config.httpApiKeys).toEqual([]);
      expect(config.anthropicApiKey).toBeUndefined();
      expect(config.aiContentCheckEnabled).toBe(false);
      expect(config.trustedOraclePubkeys).toEqual([]);
    });
  });

  test("reads numeric env vars", () => {
    withEnv({ PORT: "4000", REFERENCE_APP_PORT: undefined }, () => {
      expect(getRuntimeConfig().referenceAppPort).toBe(4000);
    });

    withEnv({ REFERENCE_APP_PORT: "5000", PORT: "4000" }, () => {
      // REFERENCE_APP_PORT takes precedence over PORT
      expect(getRuntimeConfig().referenceAppPort).toBe(5000);
    });
  });

  test("falls back on invalid numeric values", () => {
    withEnv({ PORT: "not-a-number", REFERENCE_APP_PORT: undefined }, () => {
      expect(getRuntimeConfig().referenceAppPort).toBe(3000);
    });

    withEnv({ PORT: "-1", REFERENCE_APP_PORT: undefined }, () => {
      expect(getRuntimeConfig().referenceAppPort).toBe(3000);
    });

    withEnv({ PORT: "0", REFERENCE_APP_PORT: undefined }, () => {
      expect(getRuntimeConfig().referenceAppPort).toBe(3000);
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

  test("reads boolean AI_CONTENT_CHECK", () => {
    withEnv({ AI_CONTENT_CHECK: "true" }, () => {
      expect(getRuntimeConfig().aiContentCheckEnabled).toBe(true);
    });
    withEnv({ AI_CONTENT_CHECK: "1" }, () => {
      expect(getRuntimeConfig().aiContentCheckEnabled).toBe(true);
    });
    withEnv({ AI_CONTENT_CHECK: "false" }, () => {
      expect(getRuntimeConfig().aiContentCheckEnabled).toBe(false);
    });
  });

  test("reads trusted oracle pubkeys", () => {
    withEnv({ TRUSTED_ORACLE_PUBKEYS: "pub1,pub2" }, () => {
      expect(getRuntimeConfig().trustedOraclePubkeys).toEqual(["pub1", "pub2"]);
    });
  });

  test("trims optional string env vars", () => {
    withEnv({ ANTHROPIC_API_KEY: "  sk-ant-123  " }, () => {
      expect(getRuntimeConfig().anthropicApiKey).toBe("sk-ant-123");
    });

    withEnv({ ANTHROPIC_API_KEY: "  " }, () => {
      expect(getRuntimeConfig().anthropicApiKey).toBeUndefined();
    });
  });
});
