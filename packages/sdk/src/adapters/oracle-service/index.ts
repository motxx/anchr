/**
 * Oracle service — the host running *as* an oracle node.
 *
 * Hono routes for HTLC + FROST DKG/sign coordination.
 *
 * The customer-side counterpart owns registry, HTTP client, and discovery.
 */

export { buildOracleApp } from "./server.ts";
