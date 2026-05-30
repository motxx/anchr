# Dogfood SDK public API

Created: 2026-05-27
Model: GPT-5 Codex
Completed: 2026-05-30

## Priority

maintenance

## Dependencies

Depends on:
- 0086
- 0092

Blocks:
- 0080
- 0088

## Summary

Use the public SDK API as an application developer would, before deciding which
files, helpers, docs, and examples are unnecessary. The dogfood flow should
exercise Customer, Provider, Oracle, payment, proof, attachment, and adapter
composition through documented public imports only.

## Rationale

Dead-code and directory cleanup are safer after the SDK has been used through
its public surface. Dogfooding can reveal missing exports, awkward setup,
misleading README snippets, or helpers that look unused internally but are
needed by real users. It should happen after protocol conformance is checked and
before examples are revived or stale files are deleted.

## Acceptance

- A small local dogfood script, test, or documented runbook exercises a real
  paid-request flow using only `@anchr/sdk`, approved `@anchr/sdk/*` subpaths,
  and `@anchr/protocol`.
- The dogfood flow covers the common setup path for Customer, Provider, and
  Oracle roles, with payment/proof/attachment boundaries covered as far as
  local infrastructure allows.
- No internal `packages/sdk/src/...` imports are required by the dogfood flow.
- Any missing public API, confusing README snippet, or setup friction is fixed
  or captured in a focused follow-up issue.
- The dogfood artifact is either retained as a smoke test/example seed or its
  findings are recorded in the resolution note.

## Verification

- `deno task check`
- `deno task test:unit`
- Manual command or test added by the resolver for the dogfood flow.
- No matches are expected in the dogfood artifact: `rg -n "packages/sdk/src|\\.\\./packages/sdk" <dogfood-path>`

## Plan

- Start from the public README and package README setup path.
- Build the smallest realistic local flow that uses public imports only.
- Turn any public API gap into a direct fix or a follow-up issue.

## Resolution

Implemented by updating:

- `examples/sdk-public-api-dogfood.test.ts`

Verified with:

- `deno test --allow-all examples/sdk-public-api-dogfood.test.ts`
- `rg -n "packages/sdk/src|\\.\\./packages/sdk" examples/sdk-public-api-dogfood.test.ts` returned no matches.
- `deno task check`
- `deno task test:all` outside the sandbox after the sandboxed run could not lock the cargo advisory database; the rerun passed and includes `deno task test:unit`.

Harness update:

- Added a retained example smoke test that dogfoods the public SDK imports for Customer, Provider, Oracle, payment, proof, attachment, and adapter composition.

Review residuals:

- None

Follow-up:

- None
