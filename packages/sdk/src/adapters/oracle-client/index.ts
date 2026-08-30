/**
 * Oracle client registry and relay discovery helpers.
 *
 * Pulls Oracle definitions from Nostr discovery and exposes a registry the
 * request service can resolve against.
 */

export { createOracleRegistry } from "./registry.ts";
export type { OracleRegistry } from "../../requests/application/ports.ts";
export type {
  Oracle,
  OracleAttestation,
  OracleInfo,
  OracleVerificationDetail,
} from "../../requests/domain/oracle-types.ts";
export {
  discoverOracles,
  parseOracleAnnouncementEvent,
} from "./oracle-discovery.ts";
export type { OracleAnnouncement } from "./oracle-discovery.ts";
