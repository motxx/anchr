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
- Rewrite repository imports to use `@anchr/sdk` or `@anchr/protocol`; do not
  leave imports from deleted package names.
- Delete package directories and manifests that #0046 marks as absorbed or
  non-core.
- Run focused checks during migration, then leave final repository-wide
  enforcement to #0048.
