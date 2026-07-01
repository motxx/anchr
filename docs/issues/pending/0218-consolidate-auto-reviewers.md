# Consolidate the two auto AI reviewers and align their skip rules

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

Every PR gets two automated AI reviews (CodeRabbit and Claude Code Review) with
inconsistent scope: CodeRabbit auto-reviews all base branches and does not skip
Dependabot, while Claude Code Review skips forks and Dependabot. The result is
duplicate review noise/cost and an undocumented, inconsistent policy on which
PRs get which bot.

## Rationale

- `.coderabbit.yaml` (~lines 17-22): `auto_review.enabled: true`,
  `base_branches: [".*"]`, no dependabot skip.
- `.github/workflows/claude-code-review.yml` (~line 19): skips forks +
  `dependabot[bot]`.

## Acceptance

- One primary auto-reviewer is chosen (or responsibilities are clearly divided),
  and the skip rules (dependabot/forks/drafts) are aligned and documented.

## Verification

- A dependabot PR and a normal PR each receive a consistent, documented set of
  automated reviews.

## Plan

- Pick the primary reviewer; align the skip config in both files.
