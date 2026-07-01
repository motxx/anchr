# Extend port-adoption lints to node:fs / node:os / node:child_process

Created: 2026-07-02
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- 0192
- 0193

Blocks:
- None

## Summary

The env / persistence / execution port lints (issues 0162-0164) only detect
`Deno.*` APIs, so a module that reaches for the Node builtin equivalent
(`node:fs`, `node:os` tmpdir, `node:child_process`, `node:crypto`) passes every
check. This is the blind spot that let the 0193 and 0192 stragglers survive.
Extend the lints once those stragglers are removed so regressions are caught.

## Rationale

- `scripts/arch-lint.ts` E028 (`ENV_READ = /\bDeno\.env\./`) and the 0163/0164
  rg guards match only `Deno.*`.
- Bypassing modules: `proofs/proofmode-validation.ts` (`node:fs`, 0193),
  `proofs/c2pa-validation.ts` / `tlsn-validation.ts` (`node:fs/promises`,
  `node:os` tmpdir), `requests/domain/challenge.ts` (`node:crypto`, 0192).

## Acceptance

- The port lints flag `node:fs`, `node:os` tmpdir, `node:child_process`, and
  `node:crypto` usage in non-adapter modules, with the same allowlist model as
  the `Deno.*` rules.

## Verification

- Introducing a `node:fs` import in a non-adapter module fails
  `deno task lint:strict`.
- `deno task lint:strict` passes on the current tree (after 0192, 0193 land).

## Plan

- Extend the E028/port rules to the `node:*` equivalents with an adapter
  allowlist.
