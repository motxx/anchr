# Remove dead code entrypoints

Created: 2026-05-27
Model: GPT-5 Codex

## Priority

maintenance

## Dependencies

Depends on:
- 0082
- 0095

Blocks:
- 0080
- 0085

## Summary

Remove stale code paths, dead entry points, obsolete package references, and
generated/local artifacts identified by the cleanup inventory. The goal is to
make the active codebase match the current `@anchr/sdk` and `@anchr/protocol`
public contract.

## Rationale

Stale files such as old barrels, retired package references, unused scripts, or
generated local artifacts make the repository look less coherent and can hide
broken imports. Cleanup should be direct: pre-1.0 replacements should update or
delete callers rather than leaving compatibility facades.

## Acceptance

- Dead entry points and obsolete active-surface imports identified by #0082 are
  deleted or moved to their current owner.
- No active code imports retired package paths or package-collapse leftovers.
- Generated outputs and local-only artifacts identified as delete candidates are
  removed from tracked source or explicitly ignored if appropriate.
- Public package exports remain limited to documented SDK/protocol subpaths.
- Any deletion that reveals a broader migration creates a new follow-up issue
  instead of stretching this issue.

## Verification

- No matches are expected: `rg -n "@anchr/bounty|@anchr/sdk/bounty|packages/bounty|packages/bounty/src" README.md CLAUDE.md AGENTS.md deno.json packages examples e2e scripts Dockerfile docker-compose.yml fly.toml fly.*.toml`
- `deno task check`
- `deno task test:all`
- `deno task lint:strict`

## Plan

- Start from the delete candidates classified by #0082.
- Remove stale files in coherent batches and update references directly.
- Run focused negative checks before the standard verification commands.
