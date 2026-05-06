/**
 * Oracle service — the host running *as* an oracle node.
 *
 * Hono routes for HTLC + FROST DKG/sign coordination, plus a Nostr
 * listener that turns NIP-90 events into verification + preimage / FROST
 * signature delivery.
 *
 * The customer-side counterpart (registry, HTTP client, discovery) lives
 * in `src/infrastructure/oracle-client/`.
 */

export { buildOracleApp } from "./server.ts";
export { createOracleNostrService, createOracleNostrServiceFromEnv } from "./nostr-service.ts";
export type { OracleNostrServiceConfig, OracleNostrService } from "./nostr-service.ts";
