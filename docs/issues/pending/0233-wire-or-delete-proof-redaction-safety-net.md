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
