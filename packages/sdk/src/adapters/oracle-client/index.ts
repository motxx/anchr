/**
 * Oracle client — the host as a *customer* of oracle services.
 *
 * Pulls oracle definitions from config / Nostr discovery, exposes a
 * registry the request service can resolve against, and ships an HTTP
 * adapter for talking to remote oracle nodes.
 *
 * The other half runs this host as an Oracle node through the Oracle service
 * adapter.
 */

export { createHttpOracle } from "./http-oracle.ts";
export type { HttpOracleConfig } from "./http-oracle.ts";
export {
  createOracleRegistry,
  getOracle,
  listOracles,
  registerOracle,
  resolveOracle,
} from "./registry.ts";
export type { OracleRegistry } from "../../requests/application/ports.ts";
export type {
  Oracle,
  OracleAttestation,
  OracleInfo,
  OracleVerificationDetail,
} from "../../requests/domain/oracle-types.ts";
export { loadOraclesFromEnv, parseOracleRegistry } from "./config-loader.ts";
export type { OracleConfigEntry } from "./config-loader.ts";
export {
  discoverOracles,
  parseOracleAnnouncementEvent,
} from "./oracle-discovery.ts";
export type { OracleAnnouncement } from "./oracle-discovery.ts";
