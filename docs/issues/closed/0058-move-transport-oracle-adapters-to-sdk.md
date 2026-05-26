# Move transport oracle adapters to SDK

Created: 2026-05-23
Model: GPT-5
Completed: 2026-05-23

## Priority

maintenance

## Dependencies

Depends on:
- 0046
- 0051
- 0057

Blocks:
- 0054

## Summary

Move reusable Nostr transport, requester/provider flow adapters, Oracle
registry/client code, and Oracle service runtime code out of `packages/bounty`
and into SDK-owned adapter modules.

## Rationale

Transport and Oracle integration are SDK implementation concerns for verifiable
paid requests. They should not remain under a public `@anchr/bounty` package or
as local imports from `packages/bounty/src/...`.

Relevant current surfaces:

- `packages/bounty/src/infrastructure/nostr/`
- `packages/bounty/src/infrastructure/oracle-client/`
- `packages/bounty/src/infrastructure/oracle-service/`
- `packages/bounty/src/nostr.ts`
- `packages/bounty/src/oracle-client.ts`
- `packages/bounty/src/oracle-service.ts`
- `packages/sdk/src/adapters/`
- `packages/sdk/src/oracle.ts`

## Acceptance

- Reusable Nostr transport and Oracle integration code lives under SDK adapter
  or Oracle modules.
- E2E tests that exercise relay, Oracle discovery, or Oracle service behavior
  import SDK or protocol exports instead of `packages/bounty/src/...`.
- `packages/bounty/src/infrastructure/nostr/`,
  `packages/bounty/src/infrastructure/oracle-client/`,
  `packages/bounty/src/infrastructure/oracle-service/`, and their bounty barrel
  files are deleted once retained code has moved.
- Protocol remains role-neutral and does not absorb SDK runtime adapters.

## Verification

- No matches are expected:
  `rg -n "packages/bounty/src/(infrastructure/(nostr|oracle-client|oracle-service)|nostr|oracle-client|oracle-service)" packages e2e deno.json`
- `deno task test:unit`
- `deno task test:e2e:protocol`

## Plan

- Map Nostr transport, event publication, requester/provider service, Oracle
  registry/client, and Oracle service files to SDK adapter owners.
- Move retained code and tests into SDK modules without adding protocol runtime
  dependencies.
- Rewrite relay, frost, regtest, tlsn, and protocol e2e imports that depend on
  these adapters.
- Delete obsolete bounty adapter directories and barrel files.

## Resolution

Implemented by updating:

- `packages/sdk/src/adapters/nostr/`
- `packages/sdk/src/adapters/oracle-client/`
- `packages/sdk/src/adapters/oracle-service/`
- `packages/sdk/src/proofs/verification/`
- `packages/sdk/src/attachments/`
- `packages/bounty/src/`
- `e2e/`
- `deno.json`
- `packages/sdk/deno.json`

Verified with:

- `rg -n "packages/bounty/src/(infrastructure/(nostr|oracle-client|oracle-service)|nostr|oracle-client|oracle-service)" packages e2e deno.json`
- `deno task test:unit`
- `deno task test:e2e:protocol`
- `deno task lint:strict`
- `check-silent-bypass` review over moved verification, Oracle service, auth, signer, and validation paths

Harness update:

- SDK unit tests now exercise the moved Nostr, Oracle client, Oracle service,
  attachment, and verification modules under their SDK owner paths; strict
  architecture lint verifies the move does not introduce SDK-to-bounty imports.
- `check-silent-bypass` found and the implementation fixed a FROST delivery
  branch that returned success when relay publish had zero successes.

Review residuals:

- None

Follow-up:

- None
