# Inventory release cleanup candidates

Created: 2026-05-27
Model: GPT-5 Codex
Completed: 2026-06-02

## Priority

investigation

## Dependencies

Depends on:
- 0088

Blocks:
- 0080
- 0083
- 0084
- 0085

## Summary

Create an explicit inventory of files and directories that should be kept,
internalized, archived, or deleted before external public release. This issue
should classify the repository shape before destructive cleanup begins.

## Rationale

The cleanup scope spans root files, `docs/`, `skills/`, examples, scripts,
generated artifacts, local database files, package entry points, and stale
configuration. Some files are public product contract, some are maintainer
workflow, and some are likely obsolete. The correct deletion split depends on a
current repository read after protocol conformance, SDK dogfooding, and example
revival have clarified what is actually needed.

## Acceptance

- A tracked inventory document or issue resolution section classifies root
  files, `docs/`, `skills/`, `examples/`, `example/`, `scripts/`, `specs/`,
  package manifests, generated outputs, and local artifacts as keep, internal,
  archive, or delete.
- Every delete candidate has a short reason and a focused verification command
  or manual check.
- Maintainer workflow files that should remain in the repo are distinguished
  from public-facing docs.
- No broad destructive deletion is performed in this issue except obviously
  generated or local-only artifacts if the resolver verifies they are ignored
  and unneeded.
- Follow-up cleanup issues are created if the inventory reveals independent
  deletion batches beyond #0083, #0084, and #0085.

## Verification

- `rg --files | sort`
- `git status --short`
- Manual check: each cleanup candidate has exactly one classification and no
  sensitive material is copied into the issue text.

## Plan

- List the repository top level and major docs/skills/examples/scripts trees.
- Classify each candidate by public value and maintenance value.
- Create narrower follow-up issues only for independently closeable cleanup
  batches discovered during inventory.

## Resolution

Implemented by updating:

- `docs/issues/closed/0082-inventory-release-cleanup-candidates.md`

Inventory:

- Keep public product surface: `README.md`, `LICENSE`, `CHANGELOG.md`,
  `packages/protocol/`, `packages/sdk/`, `specs/`, `spec-site/`,
  `docs/architecture.md`, `docs/threat-model.md`,
  `docs/universality-boundaries.md`, `docs/protocol-conformance-audit.md`,
  and the advertised `examples/paid-request-simulation/` lesson.
- Keep package, native-helper, and verification source:
  `crates/frost-signer/`, `crates/tlsn-prover/`, `crates/tlsn-server/`,
  `crates/tlsn-verifier/`, `e2e/`, `tools/types/`, `deno.json`,
  `deno.lock`, package `deno.json` files, `packages/sdk/package.json`,
  `packages/sdk/bun.lock`, `packages/sdk/tsconfig.json`, and SDK npm build
  scripts. `packages/sdk/bun.lock` is kept because CI and publish workflows run
  `bun install --frozen-lockfile`.
- Keep internal maintainer workflow: `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`,
  `.claude/settings.json`, `.claude/skills`, `.codex/skills`, `.cursor/`,
  `.github/`, `CONTRIBUTING.md`, `docs/issues/`, `docs/review-harness.md`,
  `skills/`, `scripts/`, `.dockerignore`, `.env.example`, `.env.test`,
  `.gitignore`, `.gitleaks.toml`, and local verification helper scripts. These
  should remain available but not be presented as the product surface.
- Keep internal deployment/test infrastructure pending #0083 review:
  `Dockerfile`, `Dockerfile.blossom`, `docker-compose.yml`,
  `docker-entrypoint.sh`, `blossom-config.yml`, `fly.toml`,
  `fly.blossom.toml`, `fly.provider.toml`, and `fly.relay.toml`. They are not
  public SDK/protocol contract, and several entries are stale candidates below.
- Keep internal design/reference docs unless #0084 chooses to relabel or unlink
  them: `docs/development-publishing-strategy.md`,
  `docs/blossom-nip23-blog-publishing.md`,
  `docs/publishing-storage-comparison.md`, `docs/http-402-integrations.md`,
  `docs/resilience-checklist.md`, and `docs/example-delivery-lifecycle.md`.
- Archive: `docs/archive/chaos-engineering-report-2026-04-06.md` only. The
  archive category stays exceptional; no new archive destination is needed for
  this inventory.
- Delete candidate for #0083: `.github/workflows/deploy.yml` still has a
  `deploy-worker` job that deploys missing `fly.worker.toml`. Verification:
  `rg -n "fly\\.worker|deploy-worker|Auto-Worker" .github/workflows/deploy.yml`.
- Delete or repair candidate for #0083: root `Dockerfile` ends with
  `deno task start`, but the root `deno.json` has no `start` task.
  Verification: `rg -n '"start"|CMD \\["deno", "task", "start"\\]' deno.json
  Dockerfile`.
- Delete or repair candidate for #0083: `fly.provider.toml` runs
  `bun run packages/sdk/src/cli.ts`, but that CLI path is absent. Verification:
  `rg --files packages/sdk/src | rg '(^|/)cli\\.ts$'`.
- Delete or repair candidate for #0083: `.github/workflows/publish.yml` still
  publishes removed package paths such as `packages/core-runtime/deno.json` and
  `packages/bounty/deno.json`. Verification:
  `rg -n "packages/(core-runtime|core-cashu|tlsn-toolkit|photo-verification|frost-oracle|cashu-conditional-swap|blossom|bounty)/deno\\.json" .github/workflows/publish.yml`.
- Delete or repair candidate for #0083: `.gitignore` contains obsolete ignored
  paths for removed app/mobile/example surfaces, including
  `apps/two-party-binary-bet/`, `mobile/`, `example/bounty-board/`, and
  `.frost-market/`. Verification:
  `rg -n "apps/two-party-binary-bet|mobile/|example/bounty-board|\\.frost-market" .gitignore`.
- Repair candidate for #0091: live docs still mention deleted package owners
  such as `packages/bounty`, `@anchr/core-runtime`, or old package layout.
  Verification:
  `rg -n "@anchr/(core-runtime|core-cashu|customer-sdk|provider-sdk|oracle-sdk|bounty)|packages/(bounty|core-runtime)" CLAUDE.md AGENTS.md README.md specs docs/architecture.md docs/review-harness.md docs/universality-boundaries.md`.
- Repair candidate for #0090: active vocabulary still contains `bounty`,
  `market`, or `worker` in live source/docs where not intentionally historical.
  Verification:
  `rg -n "\\b(bounty|Bounty|market|Market|marketplace|Marketplace|worker|Worker)\\b" README.md CLAUDE.md AGENTS.md docs packages examples e2e deno.json scripts .github Dockerfile fly*.toml --glob '!docs/issues/closed/**' --glob '!docs/archive/**'`.
- Delete local ignored artifacts only when present: `node_modules/`,
  `crates/*/target/`, `dist/`, `packages/sdk/dist/`, `.local/`,
  fund-bearing or generated DB files matched by `jobs.db*`, `queries.db*`, and
  `kannagi.db*`, plus generated upload/report/cache files named in
  `.gitignore`. Verification: `git status --short --ignored`.
- Absent legacy directories: `example/`, `apps/`, and `mobile/` are not tracked
  source directories. No direct deletion is needed; stale references are covered
  by #0083/#0090.

Verified with:

- `rg --files | sort`
- `git ls-files | sort`
- `git status --short --ignored`
- Manual check: each cleanup candidate above has one classification and no
  sensitive material is copied into this issue text.

Harness update:

- None - this issue records a one-time release cleanup inventory. Existing
  follow-up issues #0083, #0084, #0085, #0090, and #0091 own the executable
  cleanup and verification.

Review residuals:

- None.

Follow-up:

- #0083 removes or repairs stale code entrypoints and deployment/package
  configuration.
- #0084 prunes or labels maintainer docs and skills.
- #0085 performs the final public repository layout pass.
- #0090 finishes active vocabulary cleanup.
- #0091 reconciles live docs architecture drift.
