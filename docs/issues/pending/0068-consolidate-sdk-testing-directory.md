# Consolidate SDK testing directory

Created: 2026-05-25
Model: GPT-5 Codex

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- 0067

## Summary

Make the SDK testing helper layout visually obvious by keeping a single testing
directory under `packages/sdk/src/testing/`. Move request lifecycle test
helpers currently under `packages/sdk/src/requests/testing/` into
`packages/sdk/src/testing/`, update imports, and delete the nested testing
directory.

The intended final shape is that `@anchr/sdk/testing` is the only public testing
entry point, while individual files under `src/testing/` are cohesive helper
modules for SDK, e2e, and example tests.

## Rationale

The current layout has both:

- `packages/sdk/src/testing/`
- `packages/sdk/src/requests/testing/`

That split is understandable historically, but it is surprising when scanning
the directory tree. `src/testing/mod.ts` already re-exports request testing
helpers, so the public owner is effectively `@anchr/sdk/testing` while the files
still live under a request-internal path.

Relevant files:

- `packages/sdk/src/testing/mod.ts`
- `packages/sdk/src/testing/helpers.ts`
- `packages/sdk/src/requests/testing/attachments.ts`
- `packages/sdk/src/requests/testing/factories.ts`
- `packages/sdk/src/requests/testing/oracle-registry.ts`
- `packages/sdk/src/requests/testing/protocol-helpers.ts`
- `packages/sdk/deno.json`
- tests and e2e files importing `requests/testing/*`

## Acceptance

- `packages/sdk/src/requests/testing/` no longer exists.
- All SDK testing helpers live under `packages/sdk/src/testing/`.
- `@anchr/sdk/testing` remains the only public testing subpath and exports the
  helpers needed by e2e tests and examples.
- Internal package tests import moved helpers from the single `src/testing/`
  location.
- Helper modules keep one clear responsibility each; no catch-all test helper
  module is introduced.

## Verification

- No matches are expected:
  `test ! -d packages/sdk/src/requests/testing`
- No matches are expected:
  `rg -n "requests/testing|requests\\/testing" packages/sdk/src e2e examples`
- All matching testing helper files are expected to be under
  `packages/sdk/src/testing/`:
  `rg --files packages/sdk/src | rg '/testing/'`
- `deno task test:unit`
- `deno task lint:strict`

## Plan

- Move the four files from `packages/sdk/src/requests/testing/` into
  `packages/sdk/src/testing/` with clear names.
- Update relative imports inside moved files and all callers.
- Keep `packages/sdk/src/testing/mod.ts` as the public barrel for
  `@anchr/sdk/testing`.
- Run focused grep checks before the standard unit and lint verification.
