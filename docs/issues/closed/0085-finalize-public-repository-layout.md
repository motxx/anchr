# Finalize public repository layout

Created: 2026-05-27
Model: GPT-5 Codex
Completed: 2026-06-10

## Priority

maintenance

## Dependencies

Depends on:
- 0082
- 0083
- 0084
- 0089
- 0090
- 0102

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

## Resolution

Final layout pass performed after the lifecycle-unification queue closed:

- Root README: runnable Quick Start (real relay round trip), the API
  sketch on the current default surface (relay-DM oracle bootstrap), the
  examples table with status labels, and a More Detail section that links
  docs/specs; maintainer workflow is reachable only through the docs index
  labeled as maintainer workflow.
- `packages/sdk/README.md`: Customer examples updated to the relay-DM
  default with the HTTP oracle as an explicit per-entry override; no stale
  package-collapse, manifest, or Dvm vocabulary remains in package READMEs
  (verified by grep).
- Top-level directories all carry one current responsibility: packages,
  e2e (5 buckets), examples (2 advertised), crates (4 CLI helpers), specs,
  spec-site, docs, scripts, skills, tools; debris removed earlier (#0082+,
  Phase-0 cleanup).
- `packages/sdk/deno.json` publish allowlist gained `src/identity.ts` and
  `src/relay-wait.ts` — `deno task publish:dry-run` caught that the
  published package would have errored at runtime without them.

Verified with:

- `git status --short` → clean
- `deno task test:all` → All tests passed
- `deno task test:all:docker` → All tests passed (relay, regtest, TLSN)
- `deno task publish:dry-run` → Success
- Manual check: README → SDK/protocol docs path needs no docs/issues read.

Harness update:

- None — layout state; drift in vocabulary/layout is owned by E022/E023/
  E026/E027/E028 and the README-snippets test.

Review residuals:

- None

Follow-up:

- None
