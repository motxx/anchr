# Finalize public repository layout

Created: 2026-05-27
Model: GPT-5 Codex

## Priority

maintenance

## Dependencies

Depends on:
- 0082
- 0083
- 0084
- 0089
- 0090
- 0091

Blocks:
- 0080

## Summary

Perform the final public repository layout pass after CI, inventory, dead-code
removal, and docs/skills pruning are complete. The repository should present
`@anchr/sdk` and `@anchr/protocol` first, with maintainer workflow still
available but not mistaken for product roadmap.

## Rationale

External public release needs a coherent first impression. The repository
should not lead with internal issue queues, agent workflow, obsolete examples,
or retired package surfaces. This final pass should verify the resulting layout
as a whole rather than reopening individual cleanup decisions.

## Acceptance

- Root README and package READMEs describe the current SDK/protocol public
  surface without stale package-collapse vocabulary.
- Top-level directories have clear current responsibilities or are removed.
- Public docs and specs are reachable from the README.
- Maintainer-only issue and skill workflows are labeled or unlinked so they are
  not presented as the product roadmap.
- Final local and Docker-backed verification pass from a clean worktree.

## Verification

- `git status --short`
- `deno task test:all`
- `deno task test:all:docker`
- `deno task publish:dry-run`
- Manual check: fresh-reader path from README to SDK/protocol docs is clear and
  does not require reading `docs/issues`.

## Plan

- Re-read the root README, package READMEs, architecture docs, specs index, and
  top-level directory listing after #0083 and #0084 close.
- Fix only final layout and public-navigation gaps.
- Run the final verification commands and record any residual release risk.
