# Remove dead code entrypoints

Created: 2026-05-27
Model: GPT-5 Codex
Completed: 2026-06-03

## Priority

maintenance

## Dependencies

Depends on:
- 0082

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

## Resolution

Implemented by updating:

- `.github/workflows/ci.yml`
- `.github/workflows/deploy.yml`
- `.github/workflows/publish.yml`
- `.github/CODEOWNERS`
- `.github/dependabot.yml`
- `.gitignore`
- `deno.json`
- `scripts/deploy.sh`

Deleted dead entrypoints and root deploy surfaces:

- `Dockerfile`
- `docker-entrypoint.sh`
- `fly.toml`
- `fly.provider.toml`
- `scripts/lint-dockerfile-workspace.ts`
- `scripts/lint-dockerfile-workspace.test.ts`

Verified with:

- `rg -n "fly\\.worker|deploy-worker|Auto-Worker|fly\\.provider|anchr-tlsn-provider|packages/sdk/src/cli\\.ts|CMD \\[\\\"deno\\\", \\\"task\\\", \\\"start\\\"\\]|lint:dockerfile-workspace|lint-dockerfile-workspace" .github fly*.toml deno.json scripts README.md docs packages examples e2e --glob '!docs/issues/closed/**' --glob '!docs/archive/**'`
- `rg -n "packages/(core-runtime|core-cashu|tlsn-toolkit|photo-verification|frost-oracle|cashu-conditional-swap|blossom|bounty)/deno\\.json" .github/workflows/publish.yml`
- `rg -n "apps/two-party-binary-bet|mobile/|example/bounty-board|\\.frost-market" .gitignore`
- `deno task check`
- `deno task test:scripts`
- `deno task lint:strict`
- `deno task publish:dry-run`
- `bash -n scripts/deploy.sh`
- `deno task test:all`
- `deno task test:all:docker`

Harness update:

- Existing `deno task publish:dry-run`, `deno task lint:strict`, and
  `deno task test:all` / `deno task test:all:docker` now cover the remaining
  SDK/protocol package and verification surfaces. The removed Dockerfile
  workspace lint no longer had a live root Dockerfile owner after the root
  deploy image was deleted.

Review residuals:

- None.

Follow-up:

- #0091 continues to own stale live documentation references to retired package
  names.
- #0100 should be re-read against the updated CI workflow because the root
  deploy-image job it described no longer exists.
