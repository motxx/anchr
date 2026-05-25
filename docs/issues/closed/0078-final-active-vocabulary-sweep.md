# Final active vocabulary sweep

Created: 2026-05-25
Model: GPT-5 Codex
Completed: 2026-05-25

## Priority

maintenance

## Dependencies

Depends on:
- 0073
- 0074
- 0075
- 0076
- 0077

Blocks:
- 0067

## Summary

Perform the final active-surface sweep for parent issue #0067 after the
implementation children close. This child owns residual matches, active
filenames, and the verification rule for non-actor platform terms such as
browser service workers or JavaScript runtime targets.

## Rationale

The initial parent inventory produced more than a thousand matches across SDK,
docs, scripts, and e2e tests. Some matches are actor vocabulary that must be
renamed; others may be platform vocabulary, for example Playwright
`serviceworker` APIs or runtime target strings. The parent's final close needs
one explicit pass that distinguishes those cases instead of leaving an
impossible blind grep.

## Acceptance

- Active source, tests, scripts, examples, README, and non-archive docs contain
  no requester/worker actor vocabulary.
- Active filenames contain no requester/worker actor vocabulary.
- Any remaining lowercase `worker` match is explicitly classified as a
  non-actor platform/API term and the parent verification command is narrowed
  or documented accordingly.
- Parent issue #0067 can be closed immediately after this child if all
  dependencies are closed and no residual actor vocabulary remains.

## Verification

- Run and classify every match:
  `rg -n "requester|Requester|worker|Worker" README.md CLAUDE.md AGENTS.md docs packages examples e2e deno.json scripts --glob '!docs/issues/**' --glob '!docs/archive/**'`
- No matching actor filenames are expected:
  `rg --files README.md docs packages examples e2e scripts | rg -v '^docs/issues/' | rg 'requester|Requester|worker|Worker'`
- `deno task test:unit`
- `deno task lint:strict`

## Plan

- Wait for all vocabulary implementation children to close.
- Run the parent active-surface searches and classify residuals.
- Rename residual actor vocabulary directly, or update the parent issue with
  the exact non-actor platform exception before closing #0067.

## Resolution

Implemented by updating:

- `packages/sdk/src/client.ts`
- `packages/sdk/src/client-types.ts`
- `packages/sdk/src/internal/runtime/config.ts`
- `packages/sdk/src/proofs/tlsn-types.ts`
- `packages/sdk/src/proofs/tlsn-validation.ts`
- `packages/sdk/src/proofs/verification/verifier.ts`
- `packages/sdk/src/proofs/c2pa-validation.test.ts`
- `packages/sdk/src/adapters/oracle-service/server.ts`
- `packages/sdk/src/requests/application/query-service.test.ts`
- `packages/sdk/src/requests/application/query-service-lifecycle.test.ts`
- `packages/sdk/src/requests/domain/query-aggregate.test.ts`
- `docs/issues/pending/0067-retire-requester-worker-vocabulary.md`

Verified with:

- `rg -n "requester|Requester|worker|Worker" README.md CLAUDE.md AGENTS.md docs packages examples e2e deno.json scripts --glob '!docs/issues/**' --glob '!docs/archive/**'`
- `rg --files README.md docs packages examples e2e scripts | rg -v '^docs/issues/' | rg 'requester|Requester|worker|Worker'`
- `deno task check`
- `deno task test:all`

Harness update:

- `docs/issues/pending/0067-retire-requester-worker-vocabulary.md` now documents the allowed non-actor platform/API residuals for the final parent sweep.

Review residuals:

- None

Follow-up:

- #0067 remains pending for the parent close after this child.
