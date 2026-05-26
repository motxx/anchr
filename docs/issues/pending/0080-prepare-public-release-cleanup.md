# Prepare public release cleanup

Created: 2026-05-27
Model: GPT-5 Codex

## Priority

maintenance

## Dependencies

Depends on:
- 0081
- 0082
- 0083
- 0084
- 0085
- 0086
- 0087
- 0088

Blocks:
- None

## Summary

Prepare the repository for external public presentation without losing the
internal issue-driven development workflow. The cleanup should make the current
SDK/protocol product shape obvious, remove stale code and entry points, and
separate public documentation from maintainer or agent work queues.

## Rationale

The repository has accumulated useful but noisy development artifacts: many
closed issue files, agent-oriented skills, internal review harness notes, old
entry points, and directory structure left over from previous package-collapse
work. Those are valuable for maintenance but can distract external readers if
they appear before the current product contract.

This parent issue tracks the public-release cleanup sequence. The resolver
should not implement the whole parent directly unless every child has already
closed and only the final parent close remains.

## Acceptance

- Full CI and local verification are green or any remaining external blocker is
  explicitly documented.
- Protocol conformance gaps after the large rewrite have been audited and
  either fixed or tracked.
- The public SDK API has been dogfooded without internal imports.
- Public examples that are restored before release are verified by smoke tests
  or CI coverage.
- Root files, docs, skills, examples, scripts, generated artifacts, and local
  artifacts have been classified as keep, internal, archive, or delete.
- Stale code, dead entry points, and obsolete references are removed.
- Maintainer-only docs/issues/skills remain available for development but are
  not presented as the public product surface.
- Public repository layout exposes the current SDK/protocol contract first.

## Verification

- `git status --short`
- `deno task test:all`
- `deno task test:all:docker`
- Manual check: README and primary docs do not present internal issue queues as
  product roadmap.

## Plan

- Resolve the dependency issues in order, starting with full CI confirmation,
  protocol conformance, SDK dogfooding, and verified examples before broad
  cleanup inventory.
- Close this parent only after the cleanup children have been resolved and the
  final public layout pass is complete.
