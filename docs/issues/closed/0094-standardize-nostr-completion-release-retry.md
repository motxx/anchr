# Standardize Nostr completion release retry

Created: 2026-05-30
Model: GPT-5 Codex
Completed: 2026-06-03

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

## Resolution

Implemented by updating:

- `specs/messaging.md`
- `specs/README.md`
- `docs/protocol-conformance-audit.md`
- `docs/issues/pending/0080-prepare-public-release-cleanup.md`
- `docs/issues/pending/0102-align-sdk-adapter-boundary.md`

Verified with:

- `deno task check`
- `deno task lint:strict`
- `deno task test:unit` skipped at maintainer direction because this was a docs-only boundary change.
- `deno task test:e2e:protocol` skipped at maintainer direction because this was a docs-only boundary change.
- `deno task test:e2e:relay` skipped at maintainer direction because this was a docs-only boundary change.
- Manual audit: `docs/protocol-conformance-audit.md` now names completion feedback, FROST release DMs, and retry-store semantics as SDK-local policy rather than stable v0 protocol gaps.

Harness update:

- Spec edit: `specs/messaging.md` now explicitly excludes kind `7000` completion feedback from the stable v0 Nostr profile, keeps HTLC preimage delivery as the stable release contract, and assigns FROST release DMs plus retry-store deletion policy to SDK-local behavior. No code harness was added because the public `@anchr/protocol/events` helper surface did not change.

Review residuals:

- None

Follow-up:

- #0102 continues broader SDK adapter boundary cleanup after #0097; no new issue was created for #0094.
