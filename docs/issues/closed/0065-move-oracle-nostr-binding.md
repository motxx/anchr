# Move Oracle Nostr binding

Created: 2026-05-24
Model: GPT-5 Codex
Completed: 2026-05-24

## Priority

maintenance

## Dependencies

Depends on:
- 0058
- 0062

Blocks:
- 0047

## Summary

Move the Oracle actor's Nostr workflow binding under the Nostr adapter owner so
Customer, Provider, and Oracle Nostr flows are discoverable from the same SDK
adapter boundary, while keeping Oracle runtime and route composition under the
Oracle service owner.

## Rationale

#0058 moved reusable Nostr transport and Oracle integration code into SDK
modules. #0062 then renamed the public Nostr adapter Customer/Provider request
API. The remaining layout is still asymmetric: Customer and Provider Nostr
workflow helpers live under `packages/sdk/src/adapters/nostr/`, while the
Oracle Nostr workflow is owned by
`packages/sdk/src/adapters/oracle-service/nostr-service.ts`.

That split is easy to misread. `adapters/nostr/` already owns Nostr-specific
Customer and Provider workflow bindings, and the Oracle's Nostr communication
is part of the same Nostr transport profile. The Oracle service directory should
continue to own the transport-independent Oracle runtime, HTTP routes, FROST
and HTLC route composition, and service assembly.

This issue should not move low-level event or relay helpers out of their
current Nostr subdirectories. `packages/sdk/src/adapters/nostr/events/` should
continue to own Nostr event and DM build/parse helpers, and
`packages/sdk/src/adapters/nostr/transport/` should continue to own relay
publish/subscribe and pool lifecycle code. The new owner should orchestrate
those helpers for the Oracle actor instead of duplicating them.

Relevant files:

- `packages/sdk/src/adapters/nostr/`
- `packages/sdk/src/adapters/nostr/events/`
- `packages/sdk/src/adapters/nostr/transport/`
- `packages/sdk/src/adapters/oracle-service/nostr-service.ts`
- `packages/sdk/src/adapters/oracle-service/nostr-handlers.ts`
- `packages/sdk/src/adapters/oracle-service/index.ts`
- `packages/sdk/src/adapters/mod.ts`
- `e2e/relay/`
- `e2e/regtest/`

## Acceptance

- The Oracle actor's Nostr workflow binding lives under
  `packages/sdk/src/adapters/nostr/` with Customer and Provider Nostr workflow
  bindings.
- `packages/sdk/src/adapters/oracle-service/nostr-service.ts` is deleted
  rather than preserved as a compatibility shim.
- `packages/sdk/src/adapters/oracle-service/` contains only Oracle service
  runtime, HTTP route, FROST/HTLC route, and transport-independent composition
  code after the move.
- Nostr event/DM build and parse helpers remain under
  `packages/sdk/src/adapters/nostr/events/`; relay publish/subscribe helpers
  remain under `packages/sdk/src/adapters/nostr/transport/`.
- Public SDK adapter exports and package/e2e callers use the new owner path
  without importing from the deleted Oracle service Nostr file.

## Verification

- No file should exist:
  `test ! -e packages/sdk/src/adapters/oracle-service/nostr-service.ts`
- No matches are expected:
  `rg -n "oracle-service/nostr-service|\\.\\/nostr-service|from \"\\.\\/nostr-service\\.ts\"|from \"@anchr/sdk/adapters/oracle-service\".*Nostr" packages e2e deno.json`
- `deno task test:unit`
- `deno task test:e2e:protocol`

## Plan

- Inspect the current Oracle Nostr service and handler responsibilities before
  moving code.
- Move only the Oracle Nostr ingress/egress workflow binding into the Nostr
  adapter owner, reusing the existing `events/` and `transport/` helpers.
- Update public adapter barrels, package tests, and e2e imports to the new
  owner path.
- Delete the old `oracle-service/nostr-service.ts` path and avoid adding a
  compatibility re-export.

## Resolution

Implemented by updating:

- `packages/sdk/src/adapters/nostr/oracle-service.ts`
- `packages/sdk/src/adapters/nostr/oracle-handlers.ts`
- `packages/sdk/src/adapters/nostr/oracle-service.test.ts`
- `packages/sdk/src/adapters/nostr/oracle-frost.test.ts`
- `packages/sdk/src/adapters/nostr/mod.ts`
- `packages/sdk/src/adapters/oracle-service/index.ts`
- `packages/sdk/src/adapters/oracle-client/index.ts`

Verified with:

- `test ! -e packages/sdk/src/adapters/oracle-service/nostr-service.ts`
- `rg -n "oracle-service/nostr-service|\\.\\/nostr-service|from \"\\.\\/nostr-service\\.ts\"|from \"@anchr/sdk/adapters/oracle-service\".*Nostr" packages e2e deno.json` returned no matches
- `deno test --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys packages/sdk/src/adapters/nostr/oracle-service.test.ts packages/sdk/src/adapters/nostr/oracle-frost.test.ts packages/sdk/src/adapters/oracle-service/server.test.ts packages/sdk/src/adapters/oracle-service/server-frost.test.ts`
- `deno task test:unit`
- `deno task test:e2e:protocol`
- `deno task lint:strict`
- `check-silent-bypass` review of the moved Oracle Nostr workflow files found
  no silent-bypass patterns

Harness update:

- Oracle Nostr service tests moved with the Nostr adapter owner, and the
  negative old-path check locks the deleted `oracle-service/nostr-service.ts`
  import surface.

Review residuals:

- None

Follow-up:

- None
