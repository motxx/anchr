# Reconcile conditional swap spec ownership

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

Decide whether `specs/conditional-swap.md` should remain design material inside
`specs/`, move to docs/archive or roadmap material, or split out any active
public contract that belongs in the v0 Nostr/Cashu spec set.

## Rationale

Commit `151f068` replaced the old transport-neutral protocol contract with
`specs/paid-request-exchange.md` and recorded that Anchr v0 is Nostr-native and
Cashu-settled. `specs/README.md` now labels `specs/conditional-swap.md` as
conditional settlement design material under review.

The protocol conformance audit in `docs/protocol-conformance-audit.md` found
that FROST/P2PK settlement pieces and regtest coverage exist under
`packages/sdk/`, but the conditional swap document still describes broader N:M
swap concepts and historical package surfaces. Leaving that ambiguity in
`specs/` makes it unclear whether the file is retained design material, a
roadmap note, or an active public contract.

## Acceptance

- The repository has a documented decision for whether conditional swap remains
  design material in `specs/`, moves to docs/archive or roadmap material, or is
  split so only an active public contract stays in `specs/`.
- Any stale package references in `specs/conditional-swap.md` and
  `specs/README.md` are removed or redirected to current SDK owners.
- If any conditional-swap material remains active protocol, each normative
  field, state, settlement mode, and release-authority behavior has an
  implementation/test owner or a focused follow-up issue.
- Public-release docs do not imply that removed packages or unimplemented N:M
  APIs are current public SDK surface.

## Verification

- `deno task check`
- `deno task test:unit`
- `deno task test:e2e:frost`
- `deno task test:e2e:regtest`
- Manual check: `docs/protocol-conformance-audit.md` and `specs/README.md`
  agree on the status of `specs/conditional-swap.md`.

## Plan

- Read `specs/conditional-swap.md`, current SDK payment/FROST code, and
  FROST/regtest coverage.
- Make the smallest status decision that removes public-release ambiguity under
  the v0 Nostr/Cashu substrate decision.
- Update docs/specs and tests or file narrower implementation issues as needed.

## Resolution

Implemented by updating:

- `docs/conditional-swap-design.md`
- `docs/README.md`
- `docs/protocol-conformance-audit.md`
- `specs/README.md`
- `docs/issues/pending/0080-prepare-public-release-cleanup.md`

Verified with:

- `deno task check`
- `deno task test:unit`
- `deno task test:e2e:frost`
- `deno task lint:strict`
- `deno task test:e2e:regtest` was skipped at maintainer direction because
  this was a docs-only ownership change. The attempted run failed only because
  regtest infrastructure was not ready.

Harness update:

- None — this is a one-time design placement decision now locked in
  `specs/README.md`, `docs/README.md`, and
  `docs/protocol-conformance-audit.md`.

Review residuals:

- None

Follow-up:

- None
