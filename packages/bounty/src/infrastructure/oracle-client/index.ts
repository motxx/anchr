/**
 * Oracle client — the host as a *customer* of oracle services.
 *
 * Pulls oracle definitions from config / Nostr discovery, exposes a
 * registry the QueryService can resolve against, and ships an HTTP
 * adapter for talking to remote oracle nodes.
 *
 * The other half — running this host *as* an oracle node — lives in
 * `src/infrastructure/oracle-service/`.
 */

export { BUILT_IN_ORACLE_ID, builtInOracle } from "./built-in.ts";
export { createHttpOracle } from "./http-oracle.ts";
export type { HttpOracleConfig } from "./http-oracle.ts";
export { createOracleRegistry, getOracle, listOracles, registerOracle, resolveOracle } from "./registry.ts";
export type { OracleRegistry } from "../../application/ports.ts";
export type { Oracle, OracleAttestation, OracleInfo, OracleVerificationDetail } from "../../domain/oracle-types.ts";
export { loadOraclesFromEnv, parseOracleRegistry } from "./config-loader.ts";
export type { OracleConfigEntry } from "./config-loader.ts";
