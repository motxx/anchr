# Absorb proof helpers

Created: 2026-05-23
Model: GPT-5
Completed: 2026-05-23

## Priority

maintenance

## Dependencies

Depends on:
- 0046
- 0050
- 0051

Blocks:
- 0047

## Summary

Move TLSNotary and photo verification helpers needed by verifiable paid
requests into SDK proof modules instead of publishing them as separate Anchr
packages.

## Rationale

#0046 classifies TLSNotary validation, replay safeguards, C2PA, EXIF,
ProofMode, AI-content, and GPS checks as SDK proof internals or standard proof
helpers. They should be reached through `@anchr/sdk/proofs` when public, not
through standalone packages.

Relevant current surfaces:

- `packages/tlsn-toolkit/`
- `packages/photo-verification/`
- `packages/sdk/`
- `packages/bounty/src/infrastructure/verification/`
- `e2e/tlsn/`

## Acceptance

- Proof verifier, schema dispatch, and retained standard proof helpers are
  available through `@anchr/sdk/proofs` or SDK internals.
- Package and e2e code no longer imports `@anchr/tlsn-toolkit` or
  `@anchr/photo-verification`.
- Retained proof-helper tests move with the implementation or are replaced by
  SDK proof tests covering the same behavior.
- Absorbed proof package manifests are deleted once no references remain.

## Verification

- No matches are expected:
  `rg -n "@anchr/(tlsn-toolkit|photo-verification)" packages e2e deno.json`
- `deno task test:unit`
- `deno task test:e2e:tlsn`

## Plan

- Identify TLSN and photo verification code required by SDK proof flows.
- Move retained helpers and tests into `packages/sdk/src/proofs/`.
- Rewrite package and e2e imports to SDK proof exports or SDK internals.
- Delete absorbed proof package manifests and directories.

## Resolution

Implemented by updating:

- `packages/sdk/src/proofs/`
- `packages/sdk/deno.json`
- `packages/bounty/deno.json`
- `packages/bounty/src/domain/types.ts`
- `packages/bounty/src/infrastructure/attachment-store.ts`
- `packages/bounty/src/infrastructure/attachment-store-helpers.ts`
- `packages/bounty/src/infrastructure/claim-gate/`
- `packages/bounty/src/infrastructure/verification/`
- `deno.json`
- `Dockerfile`
- `scripts/arch-lint.ts`

Verified with:

- `rg -n "@anchr/(tlsn-toolkit|photo-verification)" packages e2e deno.json`
- `find packages -maxdepth 2 -name deno.json -print | sort`
- `deno test packages/sdk/src/proofs/tlsn-validation.test.ts --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys`
- `deno task test:unit`
- `TLSN_VERIFIER_HOST=127.0.0.1:7046 deno task test:e2e:tlsn`
- `deno task lint:strict`
- `check-silent-bypass` on changed load-bearing package TypeScript

Harness update:

- SDK proof tests moved with the retained helpers, `tlsn-validation.test.ts`
  now locks missing verifier timestamps as freshness failures, and
  `scripts/arch-lint.ts` allows only the SDK proof subpath needed during the
  transitional bounty retirement.

Review residuals:

- None

Follow-up:

- None
