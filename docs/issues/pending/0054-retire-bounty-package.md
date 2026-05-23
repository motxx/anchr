# Retire bounty package

Created: 2026-05-23
Model: GPT-5

## Priority

maintenance

## Dependencies

Depends on:
- 0046
- 0050
- 0051
- 0052
- 0053
- 0057
- 0058
- 0059
- 0060

Blocks:
- 0047

## Summary

Absorb reusable `packages/bounty/` lifecycle code into SDK paid-request modules
and delete `@anchr/bounty` as a public package and concept.

## Rationale

#0046 deletes `bounty` as a core noun. The current package contains useful
pieces for paid-request lifecycle, proof delivery, attachments, payment release,
Nostr transport, and Oracle integration, but the public surface must become SDK
Customer/Provider/Oracle, payments, proofs, attachments, and adapters.

Relevant current surfaces:

- `packages/bounty/`
- `packages/sdk/`
- `e2e/protocol/`
- `e2e/relay/`
- `e2e/regtest/`
- `e2e/tlsn/`

## Acceptance

- Reusable paid-request lifecycle code lives under SDK modules with Customer,
  Provider, Oracle, payment, proof, attachment, or adapter ownership.
- No public `@anchr/bounty` or `@anchr/sdk/bounty` surface exists.
- Query, claim-gate, and bounty terminology is removed from new SDK public APIs
  unless preserved only in historical tests or issue text.
- Package and e2e code no longer imports from `packages/bounty/src/...`.
- The `packages/bounty/` manifest and directory are deleted once retained code
  has moved.

## Verification

- No matches are expected:
  `rg -n "@anchr/bounty|@anchr/sdk/bounty|packages/bounty/src" packages e2e deno.json`
- `deno task test:unit`
- `deno task test:e2e:protocol`

## Plan

- Resolve #0057 to move paid-request lifecycle domain and service code into
  SDK-owned request modules.
- Resolve #0058 to move Nostr transport and Oracle adapter/service code into
  SDK-owned adapter modules.
- Resolve #0059 to move remaining attachment, escrow, proof, and runtime
  helpers into SDK-owned modules while deleting claim-gate-only surfaces.
- Resolve #0060 to rewrite remaining e2e imports and delete the
  `packages/bounty/` package shell after reusable code has moved.
