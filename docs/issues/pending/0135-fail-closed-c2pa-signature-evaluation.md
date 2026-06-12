# Fail closed in C2PA signature evaluation

Created: 2026-06-12
Model: Claude Fable 5 (claude-fable-5)

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

`evaluateSignature` in `packages/sdk/src/proofs/c2pa-validation.ts` treats
only `claimSignature.*` and `assertion.dataHash.*` failure codes as real
failures. Any other c2patool failure code — for example
`assertion.hashedURI.mismatch` (a tampered assertion store, where the GPS
assertion lives) or `signingCredential.untrusted` — is silently ignored, so
`signatureValid` can be `true` for a manifest c2patool reports as failing.
`verifyC2paGpsBinding` and the INV-06 fail-closed claim load-bear on this
boolean.

## Rationale

- `packages/sdk/src/proofs/c2pa-validation.ts`, `evaluateSignature`:
  `failureCodes.some((v) => v.code.startsWith("claimSignature.") ||
  v.code.startsWith("assertion.dataHash."))` is a fail-open filter.
- Found by the `check-silent-bypass` full-file review (Pattern A) on
  2026-06-12. The filter pre-exists; INV-06 promotion increased what depends
  on it.
- `docs/threat-model.md` INV-06.

## Acceptance

- Any failure entry in the c2patool validation report invalidates the
  signature unless its code is on an explicit, documented allowlist.
- An INV-06 attack test covers a tampered-assertion (`hashedURI` mismatch)
  report.

## Verification

- `deno task test:unit`
- `deno task lint:invariants`

## Plan

- Invert the filter to fail closed with a documented allowlist of ignorable
  informational codes.
- Add the tampered-assertion attack test referencing INV-06.
