# Standardize Nostr completion release retry

Created: 2026-05-30
Model: GPT-5 Codex

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0080

## Summary

Standardize the Nostr completion feedback and Oracle release delivery semantics
that are intentionally not part of the current canonical `specs/messaging.md`
profile. The active profile covers kind `5300`, `6300`, offer and selection
feedback, and preimage delivery, but it leaves completion feedback, FROST
release messages, retry requests, and retry-store deletion policy as follow-up
work.

## Rationale

Issue #0092 aligned `specs/messaging.md` to the implemented
`@anchr/protocol/events` surface and removed stronger unimplemented retry-store
claims from the public spec. Before public release, the repository should
decide whether completion and retry semantics are universal Nostr wire
requirements or SDK adapter policy.

Relevant files:

- `specs/messaging.md`
- `packages/protocol/src/events.ts`
- `packages/sdk/src/adapters/nostr/events/dm.ts`
- `packages/sdk/src/adapters/nostr/provider-service.ts`
- `docs/protocol-conformance-audit.md`

## Acceptance

- `specs/messaging.md` defines or explicitly excludes kind `7000`
  `success`/`error` completion feedback from the stable Nostr profile.
- Oracle release delivery covers HTLC preimage and, if still supported, FROST
  group-signature messages with canonical payload fields and parser behavior.
- Retry request shape, retry success criteria, and retry-store deletion policy
  are either standardized with tests or documented as SDK-local policy.
- Public `@anchr/protocol/events` helpers and SDK Nostr adapter behavior match
  the final spec decision.

## Verification

- `deno task check`
- `deno task test:unit`
- `deno task test:e2e:protocol`
- `deno task test:e2e:relay`
- Manual check: `docs/protocol-conformance-audit.md` names the final owner and
  test coverage for completion and release retry behavior.

## Plan

- Re-read the current Provider, Oracle, and protocol event helper behavior.
- Decide whether completion/retry semantics are universal Nostr wire contract
  or SDK adapter policy.
- Update spec, code, and focused tests for the chosen boundary.
