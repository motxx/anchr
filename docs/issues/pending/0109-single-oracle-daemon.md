# Single Oracle daemon: Hono surface as optional operator adapter

Created: 2026-06-10
Model: Claude Fable 5

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
