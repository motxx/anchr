# Enforce TLSN server-identity when the target hostname cannot be resolved

Created: 2026-07-02
Model: Claude Fable 5

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

The TLSN server-identity check is skipped when the expected hostname cannot be
derived. `expectedHostname` is `domain_hint ?? extractHostname(target_url)`,
and `extractHostname` returns `null` for a `target_url` without a scheme (a
common typo). When it is falsy, neither the match nor the mismatch branch runs,
so no failure is recorded and the server-binding guarantee (INV-01) is silently
dropped — a valid presentation from any Provider-controlled server is accepted.

## Rationale

- `packages/sdk/src/proofs/tlsn-validation.ts` (~lines 299-312): no failure is
  pushed when `expectedHostname` is falsy; verdict is `failures.length === 0`
  (`verifier.ts` ~line 59).
- `target_url` is validated only as `typeof === "string"` (`tlsn-types.ts`
  ~line 96), never as a well-formed URL.

## Acceptance

- A TLSN-backed requirement with an unresolvable hostname records a failure
  (fails closed) rather than skipping the check.
- `target_url` is validated as a well-formed URL at the schema boundary.

## Verification

- Unit test: a requirement whose `target_url` omits the scheme and has no
  `domain_hint` fails verification instead of passing.

## Plan

- Push a failure when `expectedHostname` cannot be determined.
- Validate `target_url` as a URL in `tlsn-types.ts`.
