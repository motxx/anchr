# Single Oracle daemon: Hono surface as optional operator adapter

Created: 2026-06-10
Model: Claude Fable 5
Completed: 2026-06-10

## Priority

maintenance

## Dependencies

Depends on:
- 0108

Blocks:
- 0103

## Summary

Move the Oracle's Nostr coordination (`adapters/nostr/oracle-service.ts`)
onto the engine's DM adapter so one Oracle implementation remains. The Hono
HTTP + FROST signer surface under `adapters/oracle-service/` stays as the
optional operator-facing adapter.

## Rationale

`docs/lifecycle-unification-design.md` step 6. After 0106/0108 the
relay-facing Oracle logic is engine-owned; the standalone
`adapters/nostr/oracle-service.ts` (no production consumer today) either
folds into the engine adapter or is deleted with its tests migrated.

## Acceptance

- One Oracle coordination implementation; the HTTP/FROST routes remain
  reachable as an optional adapter.
- `e2e/frost` and `e2e/relay` buckets green.

## Verification

- `deno task test:e2e:frost`
- `deno task test:all`

## Plan

- Decide fold-in vs delete at resolution time after 0108 lands.

## Resolution

Implemented by updating:

- `packages/sdk/src/adapters/nostr/oracle-service.ts` — folded onto the
  engine: takes a `RelayClient` (no singleton pool, no env-coupled
  transport), an injectable `verify` (the `_setPublishEventForTest` /
  `_setVerifyForTest` seams are deleted), and now embeds the relay-DM hash
  responder (`serveHashRequests`) so one daemon serves hash bootstrap,
  watch, verification, and preimage/rejection/FROST delivery.
  `createOracleNostrServiceFromEnv` constructs the relay client itself.
- `packages/sdk/src/adapters/nostr/proof-publisher.ts` — attestation
  publishing (P6) rides the injected `RelayClient`.
- Deleted `adapters/nostr/transport/client.ts` (+test): the singleton-pool
  transport's last consumers are gone; the barrel no longer re-exports it.
- `oracle-service.test.ts` / `oracle-frost.test.ts` — rewritten onto
  injected capturing relays and verifier doubles.
- The HTTP + FROST signer surface under `adapters/oracle-service/` is
  untouched and remains the optional operator adapter.

Verified with:

- `deno task test:all` (includes `test:e2e:frost`)
- No matches: `rg -n "_set[A-Za-z]+ForTest" packages/sdk/src` — the last
  module-level test seams left with this fold (completes #0110's class).

Harness update:

- None — the daemon now goes through the same `RelayClient` seam the rest
  of the lifecycle is locked against (INV-08 e2e exercises the DM paths).

Review residuals:

- None

Follow-up:

- None
