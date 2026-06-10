# Replace module-level test seams with dependency injection

Created: 2026-06-10
Model: Claude Fable 5
Completed: 2026-06-10

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Replace the module-level mutable test seams in proofs/payments with
constructor/option injection so production code carries no test-only
mutation hooks:

- `packages/sdk/src/payments/frost-cli.ts` `_setFrostSignerPathForTest`
- `packages/sdk/src/proofs/tlsn-validation.ts` `_setVerifierPathForTest`
- `packages/sdk/src/proofs/verification/verifier.ts` `_setValidateTlsnForTest`

The two seams in `adapters/nostr/oracle-service.ts`
(`_setPublishEventForTest`, `_setVerifyForTest`) are NOT in scope: that
module is retired by #0109.

## Rationale

Tests currently mutate module globals instead of injecting dependencies,
hiding real dependencies from construction signatures. These functions sit on
verification/settlement-critical paths, so changes here must run the
silent-bypass review before closing (see `CLAUDE.md` verification bar).

## Acceptance

- The three `_set*ForTest` exports are deleted; affected tests inject paths or
  validators through public options/parameters instead.
- No behavior change on the verification paths (existing tests pass with
  injection-based setup).

## Verification

- No matches are expected outside `adapters/nostr/oracle-service*`:
  `rg -n "_set[A-Za-z]+ForTest" packages/sdk/src`
- `deno task test:unit`
- `deno task test:e2e:tlsn` (Docker) for the TLSN path

## Plan

- Thread an options parameter (binary path / validator fn) through the
  existing call chains; update the ~6 test files that use the seams.

## Resolution

Implemented by updating:

- `packages/sdk/src/payments/frost-cli.ts` / `frost-signer.ts` — deleted
  `_setFrostSignerPathForTest` and the module-level path cache; an optional
  `frostSignerPath?: string | null` (undefined=auto-detect, null=force
  unavailable, string=use) threads through the CLI round functions and
  `FrostSignerConfig`.
- `packages/sdk/src/proofs/tlsn-validation.ts` — deleted
  `_setVerifierPathForTest`; `validateTlsn(att, req, { verifierPath? })`.
- `packages/sdk/src/proofs/verification/verifier.ts` — deleted
  `_setValidateTlsnForTest`; `verifyProof`/`verify` take
  `VerifyProofOptions { blossomKeys?, validateTlsn? }` defaulting to the
  real validator; `adapters/oracle-client/built-in.ts` updated.
- The six affected test files inject through the new parameters; module
  globals and afterEach resets removed.

Verified with:

- `deno task check`, `deno task test:unit`, `deno task lint:strict`,
  `deno task test:all`
- `rg -n "_set[A-Za-z]+ForTest" packages/sdk/src` matches only
  `adapters/nostr/oracle-service*` (out of scope; retired by #0109).

Harness update:

- None — the seams themselves were the harness debt; injection restores
  normal test wiring.

Review residuals:

- A stale comment referencing the deleted seam remains at
  `adapters/nostr/oracle-service.ts:54`; it leaves with #0109.

Follow-up:

- None
