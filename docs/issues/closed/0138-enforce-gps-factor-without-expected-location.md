# Enforce the gps factor when no expected location is set

Created: 2026-06-12
Model: Claude Fable 5 (claude-fable-5)
Completed: 2026-06-13

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

In `packages/sdk/src/proofs/verification/checks/gps.ts` the missing-evidence
failure for the `gps` factor is additionally gated on
`requirement.expected_gps`. A requirement whose factors include `gps` (the
default policy via `DEFAULT_VERIFICATION_FACTORS`) but that lacks an expected
location silently passes a submission with no GPS evidence at all, even
though the enforced branch's own failure message says GPS is "required by
verification policy".

## Rationale

- `checks/gps.ts`: `} else if (!input.gps && requirement.expected_gps &&
  requirement.factors.includes("gps")) {` keys enforcement to an unrelated
  field.
- Found by the `check-silent-bypass` full-file review (Pattern A) on
  2026-06-12. Pre-existing behavior.

## Acceptance

- Either a submission without GPS evidence fails whenever
  `requirement.factors` includes `gps`, regardless of `expected_gps`; or
  presence-only GPS is explicitly documented as advisory and the branch is
  acknowledged with `// allow-bypass: <reason>`.
- The chosen behavior is locked by a test.

## Verification

- `deno task test:unit`

## Plan

- Decide enforce-vs-document with the maintainer if ambiguous; default to
  enforcing the failure whenever the factor is required.

## Resolution

Decision: enforce — a submission without GPS evidence fails whenever the
`gps` factor is required, regardless of `expected_gps`.

Implemented by updating:

- `packages/sdk/src/proofs/verification/checks/gps.ts` — the missing-evidence
  failure no longer keys on `requirement.expected_gps`
- `packages/sdk/src/proofs/verification/verifier-standalone.test.ts` — new
  rejection test without an expected location; C2PA-path fixtures supply body
  GPS (they relied on the bypass)
- `packages/sdk/src/proofs/verification/verifier.test.ts` — same fixture fix

Verified with:

- `deno task test:unit`

Harness update:

- The no-expected-location rejection test in `verifier-standalone.test.ts`
  locks the enforcement.

Review residuals:

- None

Follow-up:

- None
