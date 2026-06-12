# Add a local pre-commit secret scan

Created: 2026-06-13
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

`scripts/git-hooks/pre-commit` runs only `deno task lint:strict`; no local
hook scans staged changes for secrets. CI runs `gitleaks/gitleaks-action`
(`.github/workflows/ci.yml`), but that detection fires after the push has
already exposed the secret to the remote. Wire a local gitleaks scan into the
commit path so a leaked key, token, or ecash proof is blocked before it leaves
the developer's machine.

## Rationale

- Security-audit finding recorded while shipping PR #175: the repository's
  layered checks (lint chain, `lint:paths`) catch developer-local paths but
  not secret-shaped material.
- `scripts/git-hooks/pre-commit` is the repository-managed hook path
  (`git config core.hooksPath scripts/git-hooks`, installed by
  `deno task setup:hooks`), so the scan belongs there rather than in
  per-developer `.git/hooks`.
- Known constraints for the resolver:
  - The hook must stay offline and fast; `gitleaks protect --staged` scans
    only the staged diff.
  - Developer machines may not have gitleaks installed. Decide and document
    the policy when the binary is absent (hard-fail with install guidance vs
    warn-and-continue), keeping CI as the backstop either way.
  - Any local config must not allowlist patterns that match real secret
    prefixes; extend the default ruleset only for intentionally published
    fixtures.

## Acceptance

- Committing a staged file that contains a dummy secret matching the default
  gitleaks ruleset (for example a fake AWS access key ID) is rejected locally
  before the commit is created.
- A normal commit without secret-shaped content passes the hook unchanged.
- The behavior when gitleaks is not installed is decided, implemented, and
  documented alongside the `deno task setup:hooks` instructions.

## Verification

- Stage a scratch file containing a fake `AKIA...`-style key, run
  `git commit`; the hook is expected to reject the commit. Remove the scratch
  file afterwards without committing it.
- `git commit` on a clean docs-only change succeeds.
- `deno task lint:strict` still passes from the hook.

## Plan

- Add a gitleaks invocation to `scripts/git-hooks/pre-commit` scoped to the
  staged diff.
- Decide the absent-binary policy and document the install step next to
  `deno task setup:hooks`.
- Keep the local ruleset aligned with the CI `gitleaks-action` defaults.
