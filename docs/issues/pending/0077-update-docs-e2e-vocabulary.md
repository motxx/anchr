# Update docs e2e vocabulary

Created: 2026-05-25
Model: GPT-5 Codex

## Priority

maintenance

## Dependencies

Depends on:
- 0074
- 0076

Blocks:
- 0067

## Summary

Update active docs, threat-model invariants, invariant lint fixtures, and e2e
tests from requester/worker terminology to Customer/Provider terminology after
the SDK lifecycle and payment names are settled.

## Rationale

Parent issue #0067 found active terminology in `docs/threat-model.md`,
`docs/review-harness.md`, `scripts/lint-invariants.test.ts`, e2e protocol
tests, e2e regtest tests, e2e TLSN tests, and e2e FROST tests. Several of
these references call SDK lifecycle and payment APIs or quote test names that
must change together with #0074 and #0076.

Threat-model invariant text is hash-guarded, so this child must update the lock
file with a clear justification when invariant wording changes.

## Acceptance

- Active docs and e2e test descriptions use Customer/Provider terminology.
- E2E tests compile against the renamed SDK lifecycle and payment APIs.
- `docs/threat-model.lock.json` is updated when threat-model invariant text
  changes.
- Invariant lint fixtures in `scripts/lint-invariants.test.ts` match the new
  threat-model and test wording.

## Verification

- No matches are expected in active docs and e2e surfaces except documented
  non-actor platform terms:
  `rg -n "requester|Requester|worker|Worker" docs e2e scripts --glob '!docs/issues/**' --glob '!docs/archive/**'`
- `deno task lint:invariants`
- `deno task test:e2e:protocol`
- `deno task test:unit`
- `deno task lint:strict`

## Plan

- Wait for the lifecycle and payment vocabulary children to close.
- Update docs, invariant names, e2e descriptions, variables, and comments to
  Customer/Provider terminology.
- Regenerate or update threat-model lock hashes with a justification for the
  vocabulary-only invariant wording changes.
