# Fix the README reference to a nonexistent createHttpOracleClient

Created: 2026-07-02
Model: Claude Fable 5
Completed: 2026-07-02

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

The front-page README's headline Customer example tells the reader to pass
`client: createHttpOracleClient(...)`, but that symbol exists nowhere in the
repo (no HTTP oracle client factory exists). This is the first code sample a new
user copies, and it references an undefined function; the package README omits
it, so the two disagree.

## Rationale

- `README.md` (~lines 135-137) references `createHttpOracleClient`.
- Real factory is `createNostrOracleClient` (`packages/sdk/src/oracle.ts`
  ~line 77); the option field is `client?: OracleClient`
  (`packages/sdk/src/customer-types.ts` ~line 52).

## Acceptance

- The README example uses a real pattern (supply a custom `OracleClient` via
  `client:`; default is `createNostrOracleClient`) or drops the line.

## Verification

- `rg "createHttpOracleClient" .` returns no matches.

## Plan

- Correct or remove the `createHttpOracleClient` line in `README.md`.

## Resolution

Implemented by updating:

- `README.md` — the Customer API sketch comment now names the real default
  (`createNostrOracleClient`) and the real override point (`client:` with a
  custom `OracleClient`) instead of the removed `createHttpOracleClient`.

Verified with:

- `rg "createHttpOracleClient" --glob '!docs/issues/**' .` returns no matches
  (the symbol survives only inside closed-issue archives, which record
  history and are not live docs).
- `deno task lint:strict`

Harness update:

- Filed issue 0232 (typecheck README `ts` code fences against the real
  `@anchr/*` surface), which absorbs the class of README-vs-exported-API
  drift that let this stale reference survive the 0095 removal.

Review residuals:

- None

Follow-up:

- None
