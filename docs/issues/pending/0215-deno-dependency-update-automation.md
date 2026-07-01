# Automate Deno/JSR dependency updates

Created: 2026-07-02
Model: Claude Fable 5

## Priority

feature

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

The application's core runtime dependencies (`hono`, `@noble/hashes`,
`@noble/curves`, `nostr-tools`, `@cashu/cashu-ts`, `@logtape/logtape`,
`puppeteer`, `@std/*`) are pinned in `deno.json` + `deno.lock`, but Dependabot
does not support the Deno/JSR import ecosystem, so none of them get update PRs.
With `deno install --frozen` in CI, the bulk of the attack surface silently
drifts and misses security updates while peripheral cargo/action deps are
well-tended.

## Rationale

- `.github/dependabot.yml` covers github-actions, npm (`/packages/sdk`), docker,
  and cargo — not the Deno imports in `deno.json` (~lines 14-52).
- Renovate has first-class `deno.json`/`deno.lock` support.

## Acceptance

- Deno/JSR dependencies receive automated update PRs (Renovate), or a
  documented scheduled `deno outdated` / re-lock cadence exists in
  `CONTRIBUTING.md` and is followed.

## Verification

- An update mechanism produces (or a documented process schedules) Deno
  dependency bumps; the config is committed.

## Plan

- Add Renovate scoped to the Deno ecosystem (keep Dependabot for the rest), or
  document and schedule a manual re-lock cadence.
