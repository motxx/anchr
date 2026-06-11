# Architecture and docs conformance gaps

Created: 2026-06-11
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Tracking issue for the architecture-conformance findings: `crates/`, `docs/`,
and `skills/` are missing from the component table; `requests/domain/types.ts`
re-exports proof-owned TLSN types as a second barrel; and the documented
"no package depends on examples" rule is unenforced by arch-lint.

## Rationale

From `docs/production-readiness-audit.md` §2.3:

- **ARCH-02** — `crates/` is undocumented in `docs/architecture.md` and
  `CLAUDE.md` (`grep -c crates` → 0 in both); this includes the Rust gate note
  for issue 0121.
- **ARCH-03** — `docs/` and `skills/` have no rows in the
  `docs/architecture.md:94-104` component table.
- **ARCH-04** — `packages/sdk/src/requests/domain/types.ts:52-67` re-exports
  TLSN types owned by `packages/sdk/src/proofs/tlsn-types.ts`, and
  `packages/sdk/src/proofs/verification/checks/tlsn.ts:4-8` imports them back
  through `requests/domain` — the round-trip `docs/architecture.md:138-141`
  forbids.
- **ARCH-05** — `scripts/arch-lint.ts:96-116,336-353` does not flag a
  `packages/` file importing `examples/`/`e2e/`/`scripts/` (latent gap).

## Acceptance

- The `docs/architecture.md` component table has a row for every tracked
  top-level directory (`crates/`, `docs/`, `skills/` added); `CLAUDE.md`
  `## Layout` names `crates/` with its build command and Rust-exception note.
- The TLSN-type re-export barrel is removed; proofs/adapters import TLSN types
  directly from `@anchr/sdk/proofs`.
- `scripts/arch-lint.ts` flags a `packages/` import resolving into
  `examples/`/`e2e/`/`scripts/`.

## Verification

- `rg -c crates docs/architecture.md CLAUDE.md` > 0.
- Expected `rg -n "from .*requests/domain/types" packages/sdk/src/proofs`
  returns nothing.
- `deno task lint:arch` passes; a scratch `packages/` → `examples/` import is
  flagged (do not commit the scratch fixture).
- `deno task lint:strict`

## Plan

- Apply the doc-table rows and CLAUDE.md `crates/` bullet.
- Delete the `requests/domain/types.ts` TLSN re-export block and update the two
  call sites.
- Extend `arch-lint.ts` resolution to raise on package → examples/e2e/scripts
  imports.
