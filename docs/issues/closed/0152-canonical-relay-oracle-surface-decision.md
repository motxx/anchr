# Decide: relay-only Oracle is canonical; settle the HTTP surface's fate

Created: 2026-06-12
Model: Claude Fable 5
Completed: 2026-06-13

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0116
- 0143

## Summary

The SDK ships two parallel Oracle transports with duplicated logic and split
ownership:

- **Relay path** — `adapters/nostr/oracle-service.ts` +
  `oracle-handlers.ts` (NIP-44 DM bootstrap, INV-08's relay-only guarantee;
  correctness fixes tracked by 0116).
- **HTTP path** — `adapters/oracle-service/` (Hono server, `Deno.serve`,
  API-key auth, HTLC + FROST routes) and `adapters/oracle-client/`
  (HTTP client, discovery, config loader, built-in registry whitelist).

Both implement preimage issuance (drift already tracked by 0140) and escrow
verification. Decide which surface is canonical for v0 and what happens to
the other. Proposed direction, per the P2P and privacy premises: the relay
path is canonical; the HTTP server moves out of `packages/` (example or
separate deployment artifact) or is deleted, and the `oracle-client`
discovery/built-in whitelist is reduced to relay-based discovery
(kind 30088 registry per `specs/oracle-registry.md`).

## Rationale

- A required HTTP endpoint contradicts INV-08 (exchange completes
  relay-only) and reintroduces the IP-exposure class that 0124 mitigates for
  mint/Blossom.
- The built-in Oracle whitelist (`adapters/oracle-client/built-in.ts`) is an
  application opinion inside the SDK; P2P discovery belongs to the Nostr
  registry spec.
- Double ownership is the root cause of the 0140 preimage-issuance drift and
  part of the 0139 escrow-lifecycle drift; choosing one owner is the durable
  fix.
- 0116's "fix or remove" choice for the relay path should be made with this
  decision in hand (hence this issue blocks 0116). FROST HTTP routes in the
  same directory follow 0117's outcome.

## Acceptance

- A written decision records the canonical Oracle transport for v0, the fate
  of `adapters/oracle-service/` and `adapters/oracle-client/`, and how
  Oracle discovery works (registry events vs static config).
- `docs/architecture.md` adapter rows match the decision.
- Follow-up implementation issues exist for whichever surface moves or
  is deleted.

## Verification

- `docs/architecture.md` and this issue's resolution state the same single
  canonical surface.
- After implementation follow-ups close: duplicated preimage issuance has
  one owner (`rg -l "preimage" packages/sdk/src/adapters/` names one
  directory).

## Plan

- Confirm with the maintainer that relay-only is the v0 trust/transport
  model (human universal decision).
- Sequence against 0116 (relay correctness) and 0117 (FROST routes).
- File implementation children for the move/delete and for relay-based
  discovery.

## Resolution

Decision: the relay path in `adapters/nostr` is the canonical v0 Oracle
transport for the Customer/Provider/Oracle exchange. The HTTP Oracle exchange
surface is deleted from the SDK package surface by follow-up issue 0156:
HTLC `/hash`, `/hash/:queryId`, `/verify`, HTTP Oracle client, and HTTP config
loader stop owning exchange behavior. FROST Oracle-to-Oracle coordination keeps
a home as a reduced FROST-only peer endpoint module because 0117 kept FROST and
`test:e2e:frost` depends on that coordination surface; 0153 owns the injectable
peer transport. Oracle discovery is relay-based through kind 30088 registry
events with `supported_schemas` and `s` tags containing exact schema URL
capability keys; the built-in Oracle whitelist is application policy and is
deleted by follow-up issue 0157.

Implemented by updating:

- `docs/architecture.md`
- `docs/issues/SEQUENCE`
- `docs/issues/pending/0143-premise-alignment-restructuring-plan.md`
- `docs/issues/pending/0146-schema-scoped-payloads-in-contract-and-query.md`
- `docs/issues/pending/0147-move-gps-into-schema-owned-verification.md`
- `docs/issues/pending/0148-runtime-schema-registration-and-reference-adapters.md`
- `docs/issues/pending/0149-runtime-ports-for-config-persistence-sidecars.md`
- `docs/issues/pending/0153-frost-peer-transport-injection.md`
- `docs/issues/pending/0156-delete-http-oracle-exchange-surface.md`
- `docs/issues/pending/0157-migrate-oracle-discovery-to-schema-urls.md`
- `docs/issues/closed/0152-canonical-relay-oracle-surface-decision.md`

Verified with:

- `deno task lint:strict`

Harness update:

- None — human universal decision locked in docs; child issues carry implementation drift locks.

Review residuals:

- None

Follow-up:

- 0156
- 0157
