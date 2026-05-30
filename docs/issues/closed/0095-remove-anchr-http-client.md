# Remove Anchr HTTP client

Created: 2026-05-30
Model: GPT-5 Codex
Completed: 2026-05-30

## Priority

maintenance

## Dependencies

Depends on:
- 0087

Blocks:
- 0080
- 0083
- 0085
- 0090

## Summary

Delete the obsolete `Anchr` class and its `/queries` HTTP client surface from
`@anchr/sdk`. The current public SDK contract is the Customer, Provider, and
Oracle actor API with explicit ports and adapters, not a hosted REST client or
default server facade.

## Rationale

The SDK dogfood in #0087 used public actor imports and did not need the
`Anchr` class. Current docs say Anchr has no default hosted server or mandatory
REST API, while `packages/sdk/src/client.ts` still exposes a server-shaped
client with `serverUrl`, `/queries`, `request()`, `photo()`,
`createTlsnRequest()`, `listOpenRequests()`, and `submitPresentation()`.

This conflicts with the single-purpose architecture in `docs/architecture.md`:
`@anchr/sdk` should orchestrate Customer, Provider, and Oracle roles through
explicit ports and standard adapters. A concrete app-owned HTTP gateway client
should not be the root default export of the SDK. There are no external users
to preserve compatibility for, so remove the surface directly instead of
renaming it or keeping a shim.

## Acceptance

- `packages/sdk/src/client.ts` and `packages/sdk/src/client-types.ts` are
  deleted unless the resolver finds a still-current, documented owner for them.
- Root `@anchr/sdk` exports no `Anchr` class and has no default export pointing
  at a hosted HTTP client.
- Package publish includes and tests no longer reference the deleted client
  files or HTTP client types.
- README and package README continue to teach the actor SDK path first and do
  not advertise a mandatory hosted REST server.
- If a future app-owned HTTP gateway client is still desired, it is captured as
  a separate issue with a non-root name and an explicit owner boundary.

## Verification

- No matches are expected: `rg -n "new Anchr|export default Anchr|createTlsnRequest|submitPresentation|serverUrl|client-types|src/client\\.ts|/queries" README.md packages/sdk docs/architecture.md examples`
- `deno task check`
- `deno task test:unit`
- `deno task test:examples`
- `deno task publish:dry-run`

## Plan

- Remove the `Anchr` class, its types, root/default exports, package publish
  includes, and constructor smoke tests.
- Re-run public import and README checks so the SDK entry point is the actor
  API: `createCustomer`, `createProvider`, `createHttpOracleClient`,
  `createRelayClient`, and `createCashuClient`.
- Leave app-owned HTTP gateway work out of this issue unless the resolver files
  a separate follow-up with a current owner and examples.

## Resolution

Implemented by updating:

- `packages/sdk/src/index.ts`
- `packages/sdk/src/index.test.ts`
- `packages/sdk/deno.json`
- `packages/sdk/README.md`
- `packages/sdk/src/attachments/access.ts`
- `packages/sdk/src/attachments/blossom.ts`
- `packages/sdk/src/attachments/provider-upload.ts`
- `packages/sdk/src/adapters/nostr/provider-service.ts`
- `packages/sdk/src/requests/domain/types.ts`
- `docs/issues/pending/0080-prepare-public-release-cleanup.md`
- `docs/issues/pending/0083-remove-dead-code-entrypoints.md`
- `docs/issues/pending/0085-finalize-public-repository-layout.md`
- `docs/issues/pending/0090-finish-active-vocabulary-cleanup.md`

Deleted:

- `packages/sdk/src/client.ts`
- `packages/sdk/src/client-types.ts`
- `packages/sdk/src/errors.ts`

Verified with:

- `rg -n "new Anchr|export default Anchr|createTlsnRequest|submitPresentation|serverUrl|client-types|src/client\\.ts|/queries" README.md packages/sdk docs/architecture.md examples`
- `deno task check`
- `deno task test:unit`
- `deno task test:examples`
- `deno task publish:dry-run`
- `deno task test:all`

Harness update:

- `packages/sdk/src/index.test.ts` now locks the root SDK surface to actor setup
  helpers and asserts that no root hosted HTTP client/default export is exposed.

Review residuals:

- None.

Follow-up:

- None.
