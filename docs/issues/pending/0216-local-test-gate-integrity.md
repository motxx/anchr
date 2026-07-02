# Fix local test-gate integrity: tree-keyed pre-push marker and honest `deno task test`

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

Two local test-gate weaknesses let a green signal come from code that was never
tested. The pre-push "2-hour pass marker" records only a timestamp in a
`$HOME`-global file, so running `test:all` on branch A lets any push from branch
B within 2h bypass the gauntlet. Separately, `deno task test` is a second,
weaker "local test sequence" that omits the Rust gate and frost e2e yet is
documented as a dev convenience, so it can drift from the real gate.

## Rationale

- `scripts/git-hooks/pre-push` (~lines 19-92): `MARKER` stores only
  `date +%s`, not the commit/tree, and is `$HOME`-global.
- `deno.json` (~line 56): `test` composite omits the Rust gate + frost e2e;
  `scripts/test-all.sh` invokes the sub-tasks directly, so `deno task test` is
  not the pre-push equivalent.

## Acceptance

- The pre-push marker is keyed to the exact tree/commit that passed (and stored
  per-repo), so the bypass applies only to that tree.
- `deno task test` either points at the real local gate or is clearly scoped as
  a fast subset (not documented as the pre-push equivalent).

## Verification

- Passing `test:all` on one commit does not satisfy the pre-push gate for a
  different commit.
- `deno task test` and the pre-push gate are consistent or clearly labelled.

## Plan

- Key the marker to `git rev-parse HEAD` (or a worktree hash), stored under
  `.git/`; reconcile `deno task test` with the real gate.
