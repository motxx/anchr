# Settle Cashu payment owner

Created: 2026-05-25
Model: GPT-5 Codex

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Investigate and resolve the ownership boundary for the SDK's Cashu HTLC client.
`packages/sdk/src/payments/mod.ts` currently re-exports
`packages/sdk/src/adapters/cashu.ts`, which makes the Cashu implementation look
owned by both `payments/` and `adapters/`. Decide the intended owner and update
code, exports, imports, docs, and tests so the dependency graph is explicit.

This is not an import-style cleanup. Changing relative imports to absolute
imports is not sufficient if ownership remains ambiguous.

## Rationale

Current signals point in different directions:

- `packages/sdk/src/adapters/cashu.ts` implements `createCashuClient`,
  `CashuClientOptions`, `CashuClientError`, mint operations, HTLC lock binding,
  and redemption behavior.
- `packages/sdk/src/payments/mod.ts` re-exports `../adapters/cashu.ts`.
- `packages/sdk/deno.json` exposes both `@anchr/sdk/adapters/cashu` and
  `@anchr/sdk/payments`.
- Root SDK exports also expose Cashu client symbols from
  `./adapters/cashu.ts`.
- Some e2e tests import `createCashuClient` from
  `@anchr/sdk/adapters/cashu`, while payment helpers are imported from
  `@anchr/sdk/payments`.

Under the single-purpose design rule, Cashu should have one owner sentence. For
example, if Cashu is a standard payment adapter, its public placement should
make that clear without a cross-directory barrel re-export. If it is a payment
helper, it should not live under `adapters/`.

## Acceptance

- The resolver documents the chosen owner for Cashu HTLC client behavior:
  `payments/`, `adapters/`, or a clearly documented split with separate
  responsibilities.
- `packages/sdk/src/payments/mod.ts` no longer re-exports
  `../adapters/cashu.ts` as a cross-owner shortcut.
- Public SDK subpaths and root exports match the chosen owner.
- Callers and tests import Cashu symbols through the chosen public surface.
- If the correct fix requires moving `packages/sdk/src/adapters/cashu.ts`, the
  move is direct and pre-1.0: update callers and delete the replaced path
  rather than preserving a compatibility shim.
- If the investigation finds the change is broader than one coherent verified
  unit, split this issue before implementation.

## Verification

- No matches are expected:
  `rg -n "export \\* from \"\\.\\./adapters/cashu\\.ts\"" packages/sdk/src/payments/mod.ts`
- The selected public Cashu surface is visible and consistent:
  `rg -n "@anchr/sdk/(payments|adapters/cashu)|createCashuClient|CashuClientOptions|CashuClientError" README.md packages/sdk/README.md packages/sdk/src e2e deno.json packages/sdk/deno.json`
- `deno task test:unit`
- `deno task lint:strict`

## Plan

- Re-read `packages/sdk/src/adapters/cashu.ts`,
  `packages/sdk/src/payments/mod.ts`, package exports, root SDK exports, README
  examples, and all imports of `createCashuClient`.
- Decide whether Cashu HTLC behavior is owned by `payments/`, `adapters/`, or a
  narrow documented split.
- Implement the smallest owner-consistent change.
- Update focused tests or imports so the chosen public surface is locked.
