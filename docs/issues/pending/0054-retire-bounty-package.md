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

- Map bounty domain, application, and infrastructure files to SDK role,
  payment, proof, attachment, and adapter modules.
- Move only reusable paid-request behavior; delete claim-gate and bounty-only
  public nouns.
- Rewrite package and e2e imports to SDK or protocol exports.
- Delete `packages/bounty/` once no references remain.
