# Move the diff-hash review-gate markers out of version control

Created: 2026-07-02
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

The PreToolUse ship gate blocks `git push` / `gh pr create` until a recorded
`diff_sha256` matches the current `packages/` diff, but the marker files that
hold those hashes are committed. Any real change to the covered files
invalidates the hash, the committed state goes stale immediately, and the
bookkeeping files are a merge-conflict magnet — high-friction gating that forces
re-review on every trivial edit.

## Rationale

- `.arch-lint-llm-verified.json` and `.silent-bypass-verified.json` (fixed
  `reviewed_at` / `diff_sha256`), enforced by `.claude/settings.json`
  PreToolUse hooks (`scripts/arch-lint-llm-verify.ts`,
  `silent-bypass-verify.ts`).

## Acceptance

- The verification markers live outside version control (e.g. under `.git/` or a
  gitignored path), or the gate is diff-scoped so unrelated edits don't
  invalidate a valid review.

## Verification

- Editing an unrelated covered file does not force re-review of the whole diff;
  the marker files no longer appear in `git status` as tracked churn.

## Plan

- Relocate the markers out of the tree (gitignore) or make the gate diff-scoped.
