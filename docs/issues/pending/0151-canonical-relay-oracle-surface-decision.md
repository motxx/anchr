# Decide: relay-only Oracle is canonical; settle the HTTP surface's fate

Created: 2026-06-12
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0116
- 0142

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
