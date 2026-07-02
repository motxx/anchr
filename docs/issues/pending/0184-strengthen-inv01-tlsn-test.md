# Strengthen the INV-01 TLSN anti-forgery test

Created: 2026-07-02
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

The INV-01 (TLSN anti-forgery) test is both weak and silently skippable. It
mutates a single byte once and only asserts `result.valid === false` plus
`typeof error === "string"`, though the invariant documents three distinct
mutation classes (transcript commitment, notary signature, target host) each
yielding a typed error. Every test in the file also `return`s green with zero
assertions when infra is down unless an env var is set, so a fully broken
verifier can pass.

## Rationale

- `e2e/tlsn/tlsn.test.ts`: INV-01 test (~line 254), per-test skip guard
  (~lines 255-258), `beforeAll` throw-guard (~lines 226-233).
- A generic "rejected for any reason" assertion cannot distinguish a correct
  rejection from an unrelated failure. Relates to 0171.

## Acceptance

- One test case per mutation class asserts the specific error class
  (transcript / signature / server).
- The vacuous per-test `return` skip is replaced by a real skip or the
  fail-loud `beforeAll` guard, so a green result always means assertions ran.

## Verification

- `deno task test:e2e:tlsn` exercises the three mutation cases; removing the
  server-identity check (0180) makes the target-host case fail.

## Plan

- Split into three mutation cases with typed-error assertions.
- Convert the skip path to `test.ignore` / rely on the `beforeAll` guard.
