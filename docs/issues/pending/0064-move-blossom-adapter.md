# Move Blossom adapter

Created: 2026-05-24
Model: GPT-5 Codex

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- 0048

## Summary

Move Blossom-specific attachment storage behavior out of the generic
`@anchr/sdk/attachments` surface and into an SDK adapter owner, while keeping
attachment reference, access, validation, and storage-agnostic helpers under
`packages/sdk/src/attachments/`.

## Rationale

`docs/architecture.md` classifies `@anchr/sdk/attachments` as the owner for
encrypted attachment references and transport helpers, and classifies
`@anchr/sdk/adapters` as the owner for standard Nostr, Cashu, Blossom, Oracle
HTTP, local state, and signer adapters. The current SDK still exports
Blossom-specific server configuration, upload authorization, upload, download,
encryption, and retry behavior from `packages/sdk/src/attachments/blossom.ts`.

Closed issues #0051 and #0059 explain why Blossom code was absorbed into SDK
attachment modules during the package collapse, but no pending issue currently
owns the final SDK-internal split between generic attachment helpers and the
replaceable Blossom storage adapter.

Relevant files:

- `docs/architecture.md`
- `packages/sdk/src/attachments/`
- `packages/sdk/src/adapters/`
- `packages/sdk/deno.json`

## Acceptance

- Blossom-specific storage, auth-event, upload, download, config, retry, and
  manifest behavior lives under an SDK adapter owner such as
  `packages/sdk/src/adapters/blossom/`.
- `@anchr/sdk/attachments` exports only attachment reference, access,
  validation, and storage-agnostic helper APIs, or intentionally narrow helper
  APIs that do not make Blossom the generic attachment owner.
- Existing attachment upload/fetch behavior remains covered by SDK tests after
  imports move to the new owner.
- `docs/architecture.md` and SDK public exports agree about whether Blossom is
  reached through `@anchr/sdk/adapters`, `@anchr/sdk/attachments`, or an
  explicitly documented combination of the two.

## Verification

- No Blossom-specific implementation file is expected directly under
  `packages/sdk/src/attachments/`:
  `find packages/sdk/src/attachments -maxdepth 1 -iname '*blossom*' -print`
- `deno task test:unit`
- `deno task lint:strict`

## Plan

- Re-read the current attachment and adapter exports before moving code, because
  #0063 may rename public attachment helper symbols first.
- Split Blossom-specific behavior from generic attachment helper behavior along
  the architecture boundary.
- Update package exports, imports, and tests so SDK callers use the appropriate
  attachment or adapter subpath.
- If the resolver finds the public API decision is larger than one coherent
  change, split this issue before editing implementation code.
