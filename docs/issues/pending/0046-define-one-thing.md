# Define one thing

Created: 2026-05-21
Model: GPT-5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0043
- 0047
- 0048
- 0049

## Summary

Lock Anchr's Unix-philosophy design contract before moving code. Define the one
thing, the two public packages, the allowed SDK/protocol subpaths, and the
absorb/delete map for all existing public package and app/example concepts.

## Rationale

The project should teach one concept:

```text
Verifiable paid requests.

Customer posts a paid request.
Provider returns work with proof.
Oracle verifies and releases payment.
```

The concept deliberately excludes `bounty` as a core noun. A bounty-style demo
may exist only as a tiny optional example if it teaches the paid-request flow.
It must not exist as `@anchr/bounty`, `@anchr/sdk/bounty`, a package directory,
an architecture layer, or the default repository theme.

The public package rule should be:

- `@anchr/sdk`: the developer-facing tool for building verifiable paid request
  flows.
- `@anchr/protocol`: the wire-contract package for events, schemas,
  validators, and role-neutral protocol types.

Adapter manifests, capability checks, runtime helpers, payment helpers, proof
dispatch, attachment handling, and standard Nostr/Cashu/Blossom integrations
belong to the SDK surface or SDK internals, not to `@anchr/protocol`.

Current surfaces to classify:

- `@anchr/sdk`
- `@anchr/protocol`
- `@anchr/customer-sdk`
- `@anchr/provider-sdk`
- `@anchr/oracle-sdk`
- `@anchr/core-runtime`
- `@anchr/core-cashu`
- `@anchr/frost-oracle`
- `@anchr/tlsn-toolkit`
- `@anchr/photo-verification`
- `@anchr/cashu-conditional-swap`
- `@anchr/blossom`
- `@anchr/adapters`
- `@anchr/bounty`
- `apps/*`
- `examples/*`

## Plan

- Update `docs/architecture.md` with the Unix-philosophy framing, the one-thing
  statement, and the two-package public contract.
- Define the intended `@anchr/sdk` top-level API and any public subpaths.
  Subpaths are allowed only when they help users find the one thing without
  learning internal taxonomy.
- Define the intended `@anchr/protocol` subpaths. Keep it to wire
  compatibility: events, schemas, validators, and role-neutral types.
- Produce an absorption/deletion table for every current package, app, and
  example surface.
- Mark `bounty`, claim-gate, conditional-swap side quests, app/product shells,
  and non-core domain demos for deletion unless the issue documents a concrete
  reason they are required for verifiable paid requests.
- Do not perform broad code moves in this issue; leave implementation to #0047,
  repository pruning to #0049, and final enforcement to #0048.
