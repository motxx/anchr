# Relocate the verifier Query-adapters out of proofs

Created: 2026-06-12
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- 0131

Blocks:
- 0122
- 0132

## Summary

After 0131 the only remaining `proofs/ → requests/domain` import is
`verifier.ts`'s `Query`/`QueryResult`, used by the Query-coupling adapter
functions `verify`, `requestToRequirement`, and `resultToVerificationInput`.
Move those adapters to a `requests/`-owned module so `proofs/` depends on
nothing in `requests/domain`, eliminating the last (type-only, pre-existing)
`proofs ↔ requests/domain` cycle and removing `Query` from the public
`@anchr/sdk/proofs` surface.

## Rationale

Parent: issue 0122 (A-full direction).

- `packages/sdk/src/proofs/verification/verifier.ts:12-16` imports
  `Query`/`QueryResult` for `verify(request, result)`,
  `requestToRequirement(request)`, and `resultToVerificationInput(result)`.
- The pure engine `verifyProof(requirement, input, options)` needs no `Query`.
- These three adapters convert the request lifecycle's `Query`/`QueryResult`
  into the proof-verification contract — a `requests/` responsibility.
- They are consumed by `adapters/nostr/oracle-service.ts`,
  `adapters/oracle-client/built-in.ts`,
  `adapters/oracle-service/{frost-signer-routes,htlc-routes}.ts`,
  `payments/frost/frost-signature-adapter.ts`, and tests — all of which may
  import from `requests/`. No example uses them.
- Removing them from `@anchr/sdk/proofs` also stops `Query` (a `requests/`-owned
  type) leaking through the public proofs surface, which issue 0132's arch-lint
  guard must be able to assert.

## Acceptance

- `verifyProof` and the verification contract types remain the public
  `@anchr/sdk/proofs` surface; `verify`/`requestToRequirement`/
  `resultToVerificationInput` live in a `requests/`-owned module and are no
  longer exported from `@anchr/sdk/proofs`.
- No `packages/sdk/src/proofs/**` non-test file imports from `requests/`.
- `Query`/`QueryResult` are not reachable through any non-`/testing` public
  export.

## Verification

- `deno task check`, `deno task test:all`, `deno task lint:strict`,
  `deno task lint:arch`.
- No matches expected:
  `rg -n "requests/" packages/sdk/src/proofs --glob '!*.test.ts' | rg "from \""`

## Plan

- Create a `requests/application/` (or adapter-side) module owning the three
  Query→contract adapters; have it import `verifyProof` + the contract from
  `@anchr/sdk/proofs`.
- Strip `Query`/`QueryResult` and those three functions from `verifier.ts`;
  drop them from `proofs/verification/index.ts` public exports.
- Repoint the adapter/test callers; verify proofs imports nothing from
  `requests/`.

Completed: 2026-06-12

## Resolution

Implemented by updating:

- `packages/sdk/src/requests/application/query-verifier.ts` (new: owns the
  Query→contract adapters `verify`, `requestToRequirement`,
  `resultToVerificationInput`; imports `Query`/`QueryResult` from
  `requests/domain` and `verifyProof` + the contract from `@anchr/sdk/proofs`)
- `packages/sdk/src/proofs/verification/verifier.ts` (stripped the three
  adapters and the `Query`/`QueryResult` import; now exports only `verifyProof`
  + the contract/check re-exports)
- `packages/sdk/src/proofs/verification/index.ts` (public proofs surface now
  exports `checkAttachmentContent` + `verifyProof` only)
- Callers repointed to `query-verifier.ts`: `adapters/nostr/oracle-service.ts`,
  `adapters/oracle-client/built-in.ts`,
  `adapters/oracle-service/htlc-routes.ts`,
  `payments/frost/frost-signature-adapter.ts`, and the verifier tests
- `scripts/arch-lint.ts` allowlist adds `query-verifier.ts` as a documented
  request-internal target for the nostr/oracle-client/oracle-service/payments
  importers

Verified with:

- `deno task check`, `deno task test:all`, `deno task lint:strict`,
  `deno task lint:arch`
- Negative: `grep -rn 'from ".*requests/' packages/sdk/src/proofs --include='*.ts' | grep -v .test.ts`
  → no matches (`proofs/` imports nothing from `requests/`)
- `verifyProof` remains public from `@anchr/sdk/proofs`; `verify` no longer is

Harness update:

- The arch-lint allowlist now documents `query-verifier.ts` as the single
  request-internal bridge adapters may consume; the broader leak guard is
  issue 0132.

Review residuals:

- None. The `proofs ↔ requests/domain` cycle is fully eliminated and `Query` no
  longer leaks through the public proofs surface.

Follow-up:

- 0132 (arch-lint guard for requests/ type leaks), then close parent 0122.
