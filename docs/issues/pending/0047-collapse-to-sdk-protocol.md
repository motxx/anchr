# Collapse to SDK protocol

Created: 2026-05-21
Model: GPT-5

## Priority

maintenance

## Dependencies

Depends on:
- 0046

Blocks:
- 0043
- 0048

## Summary

Implement the package collapse decided by #0046. Keep only `packages/sdk/` and
`packages/protocol/` as public packages. Absorb required implementation code
into SDK/protocol internals and delete former package directories that no longer
have an independent public role.

## Rationale

The repository is pre-1.0, so replaced package paths should be deleted rather
than preserved with compatibility shims. A Unix-philosophy shape should make the
composition boundary obvious:

- `@anchr/sdk` does the one thing for app developers: verifiable paid requests.
- `@anchr/protocol` lets other implementations interoperate with that one
  thing.

Former package names such as `core-runtime`, `core-cashu`, `frost-oracle`,
`tlsn-toolkit`, `photo-verification`, `adapters`, and `bounty` are internal
implementation concerns or non-core surfaces after #0046. They should not
remain published packages.

`packages/bounty/` should not survive as a package or as `@anchr/sdk/bounty`.
Treat it as a source of implementation pieces: paid request lifecycle, actor
orchestration, payment/release wiring, proof dispatch, attachments, and concrete
integrations. Delete anything that only preserves the old bounty/query surface.

Relevant files:

- `packages/sdk/`
- `packages/protocol/`
- `packages/customer-sdk/`
- `packages/provider-sdk/`
- `packages/oracle-sdk/`
- `packages/core-runtime/`
- `packages/core-cashu/`
- `packages/frost-oracle/`
- `packages/tlsn-toolkit/`
- `packages/photo-verification/`
- `packages/cashu-conditional-swap/`
- `packages/blossom/`
- `packages/adapters/`
- `packages/bounty/`
- `e2e/`

## Acceptance

- Only `packages/sdk/deno.json` and `packages/protocol/deno.json` remain as
  public Anchr package manifests.
- Package and e2e imports no longer reference deleted Anchr package names.
- `packages/protocol/src/` contains only wire events, schemas, validators, and
  role-neutral protocol types.
- SDK-owned implementation code needed for verifiable paid requests lives under
  `packages/sdk/src/`.
- `packages/bounty/` and `@anchr/sdk/bounty` do not exist as package or public
  module surfaces.
- This issue does not preserve apps/examples by rewriting them; #0049 owns
  pruning or shrinking apps/examples, and #0048 owns final cleanup.

## Verification

- No matches are expected in packages, e2e, or root workspace config:
  `rg -n "@anchr/(customer-sdk|provider-sdk|oracle-sdk|core-runtime|core-cashu|frost-oracle|tlsn-toolkit|photo-verification|cashu-conditional-swap|blossom|adapters|bounty)" packages e2e deno.json`
- `find packages -maxdepth 2 -name deno.json -print | sort`
- `deno task test`

## Plan

- Re-read #0046 and current package exports before moving code.
- Move SDK-facing implementation into `packages/sdk/src/`, preserving only the
  public `@anchr/sdk` exports and subpaths approved by #0046.
- Keep only role-neutral wire events, schemas, validators, and protocol types in
  `packages/protocol/src/`.
- Move adapter capability metadata and checks into SDK unless #0046 records a
  wire-compatibility reason to keep a protocol-owned type.
- Absorb necessary `packages/bounty/` lifecycle code into paid-request,
  Customer, Provider, Oracle, payment, proof, attachment, and adapter modules
  without preserving `bounty` as a public module name.
- Rewrite package and e2e imports to use `@anchr/sdk` or `@anchr/protocol`; do
  not leave imports from deleted package names in the package surface.
- Do not spend effort preserving apps/examples here. If a file under
  `apps/` or `examples/` blocks package tests, make the smallest local update
  and leave final pruning or shrinking to #0049.
- Delete package directories and manifests that #0046 marks as absorbed or
  non-core.
- Run focused checks during migration, then leave final repository-wide
  enforcement to #0048.
