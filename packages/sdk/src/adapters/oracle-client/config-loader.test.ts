import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { parseOracleRegistry } from "./config-loader.ts";
import { createOracleRegistry } from "./registry.ts";
import { loadOraclesFromEnv } from "./config-loader.ts";

describe("parseOracleRegistry", () => {
  test("parses single entry without API key", () => {
    const entries = parseOracleRegistry(
      "ext1:https://oracle1.example.com:50000",
    );
    expect(entries.length).toBe(1);
    expect(entries[0]!.id).toBe("ext1");
    expect(entries[0]!.endpoint).toBe("https://oracle1.example.com");
    expect(entries[0]!.fee_ppm).toBe(50000);
    expect(entries[0]!.apiKey).toBeUndefined();
  });

  test("parses single entry with API key", () => {
    const entries = parseOracleRegistry(
      "ext1:https://oracle1.example.com:50000:sk-xxx",
    );
    expect(entries.length).toBe(1);
    expect(entries[0]!.id).toBe("ext1");
    expect(entries[0]!.endpoint).toBe("https://oracle1.example.com");
    expect(entries[0]!.fee_ppm).toBe(50000);
    expect(entries[0]!.apiKey).toBe("sk-xxx");
  });

  test("parses multiple entries", () => {
    const entries = parseOracleRegistry(
      "ext1:https://oracle1.example.com:50000:key1,ext2:https://oracle2.example.com:30000",
    );
    expect(entries.length).toBe(2);
    expect(entries[0]!.id).toBe("ext1");
    expect(entries[1]!.id).toBe("ext2");
    expect(entries[1]!.fee_ppm).toBe(30000);
    expect(entries[1]!.apiKey).toBeUndefined();
  });

  test("handles URL with port", () => {
    const entries = parseOracleRegistry(
      "ext1:https://oracle1.example.com:8080:50000",
    );
    expect(entries.length).toBe(1);
    expect(entries[0]!.endpoint).toBe("https://oracle1.example.com:8080");
    expect(entries[0]!.fee_ppm).toBe(50000);
  });

  test("handles API key containing colons", () => {
    const entries = parseOracleRegistry(
      "ext1:https://oracle1.example.com:8080:50000:sk:key:with:colons",
    );
    expect(entries.length).toBe(1);
    expect(entries[0]!.endpoint).toBe("https://oracle1.example.com:8080");
    expect(entries[0]!.fee_ppm).toBe(50000);
    expect(entries[0]!.apiKey).toBe("sk:key:with:colons");
  });

  test("skips empty entries", () => {
    const entries = parseOracleRegistry(
      "ext1:https://oracle1.example.com:50000,,",
    );
    expect(entries.length).toBe(1);
  });
});

describe("loadOraclesFromEnv", () => {
  test("registers oracles from env var", () => {
    const originalEnv = Deno.env.get("ORACLE_REGISTRY");
    Deno.env.set("ORACLE_REGISTRY", "ext1:https://oracle1.example.com:50000");

    const registry = createOracleRegistry();
    const count = loadOraclesFromEnv(registry);

    expect(count).toBe(1);
    const oracles = registry.list();
    expect(oracles.length).toBe(1);
    expect(oracles[0]!.id).toBe("ext1");

    if (originalEnv !== undefined) Deno.env.set("ORACLE_REGISTRY", originalEnv);
    else Deno.env.delete("ORACLE_REGISTRY");
  });

  test("returns 0 when no env var set", () => {
    const originalEnv = Deno.env.get("ORACLE_REGISTRY");
    Deno.env.delete("ORACLE_REGISTRY");

    const registry = createOracleRegistry();
    const count = loadOraclesFromEnv(registry);
    expect(count).toBe(0);

    if (originalEnv !== undefined) Deno.env.set("ORACLE_REGISTRY", originalEnv);
  });
});
