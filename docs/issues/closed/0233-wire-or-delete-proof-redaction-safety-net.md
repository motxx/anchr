# Wire the proof-redaction credential safety net into a real path or delete it

Created: 2026-07-03
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

`proofs/proof-redaction.ts` presents itself as a post-verification safety
net — the module header says "if credentials somehow survive into the
verified output, we block the publish" — but nothing calls it. Its only
importer is the `proofs/mod.ts` `export *` barrel, and the
`validateNoCredentials` docstring itself admits it "is not used in the
publish pipeline". A security check that advertises blocking behavior while
never executing is documentation that misleads readers about a guarantee
the system does not provide. Decide: wire it into the result
publish/verification path with a test, or delete the module per the pre-1.0
delete-outright policy (TLSN-level `--redact-sent-header` is the real
redaction mechanism).

## Rationale

- `packages/sdk/src/proofs/proof-redaction.ts:1-11` (module claim),
  `:38-41` (docstring admitting it is unused), `:43` `validateNoCredentials`.
- Importers: only `proofs/mod.ts:5` (`export *`); no symbol usage across
  `packages/`, `e2e/`, `examples/`, `scripts/` (verified 2026-07-03).
- `SENSITIVE_HEADER_NAMES` is likewise exported and unconsumed.
- Related: 0174 (Rust-side redaction offsets), 0195/0226 reshape `proofs/`
  and should not inherit a dead module.

## Acceptance

- Either `validateNoCredentials` runs on a concrete publish/delivery path
  with a test proving a credential-bearing output is blocked, or the module
  is deleted and the barrel no longer exports it. The chosen direction is
  recorded in the resolution note.

## Verification

- If wiring: a unit test feeds a `bearer ...` string through the publish
  path and asserts rejection.
- If deleting: `rg "proof-redaction|validateNoCredentials|SENSITIVE_HEADER_NAMES" packages e2e examples scripts`
  returns no matches (expected); `deno task test:unit` passes.

## Plan

- Decide wire vs delete against the TLSN redaction coverage.
- Execute; update `proofs/mod.ts` accordingly.

Completed: 2026-07-04

## Resolution

Direction chosen: **delete** (the issue's own analysis — TLSN-level
`--redact-sent-header` is the real redaction mechanism; the module was an
advertised-but-unwired safety net). Executed by the 0241 repo-wide
dead-code purge on branch `worktree-purge-dead-code` (commit 9b81e49).

Implemented by updating:

- `packages/sdk/src/proofs/proof-redaction.ts` — deleted
- `packages/sdk/src/proofs/proof-redaction.test.ts` — deleted
- `packages/sdk/src/proofs/mod.ts` — `export *` barrel line removed
- `specs/README.md` — the "credential-leakage guard" claim removed from
  the TLSNotary hardening row

Verified with:

- `rg "proof-redaction|validateNoCredentials|SENSITIVE_HEADER_NAMES" packages e2e examples scripts`
  — 0 matches
- `deno task test:all` (incl. lint:strict, unit, Rust crate gate) — pass
  on the purge branch

Harness update:

- None — the delete-vs-wire decision is recorded here; the
  advertised-but-unwired-check class is covered going forward by the
  `check-silent-bypass` review rubric, and the dead-export sweep method is
  recorded in 0241's resolution note.

Review residuals:

- Close is contingent on branch `worktree-purge-dead-code` (0241, commit
  9b81e49) merging to main; reopen if that branch is discarded.

Follow-up:

- None
