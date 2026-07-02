# Reconcile VerificationFactor with the architecture-doc target contract

Created: 2026-07-02
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0225

## Summary

`docs/architecture.md` states the target has no shared `VerificationFactor`
union and no SDK-wide factor-check registry, and CONTEXT.md lists "Verification
factor" under _Avoid_. Yet `VerificationFactor` is a live public export, the
shared `VerificationRequirement` still carries `factors` and `challenge_nonce`,
and `VERIFICATION_FACTORS` is exported. The doc pins this cleanup to issues
0146-0148, which are already closed. Either finish the removal or update the
doc.

## Rationale

- `packages/sdk/src/values.ts` (~lines 14-15),
  `proofs/verification/contract.ts` (~lines 11, 23, 27),
  `requests/domain/types.ts` (~lines 38, 167), `index.ts` (~lines 109, 111).
- `docs/architecture.md` (~lines 224-240) describes the removed target and
  cites closed issues; `CONTEXT.md` (~line 44).
- Residue inventory (2026-07-02 architecture review): `VERIFICATION_FACTORS`
  is an empty array and `VerificationFactor` a degenerate `string` alias
  (`values.ts:14-15`); `requirement.factors` is written once
  (`requests/application/query-verifier.ts:31`) and read by no check;
  `challenge_nonce` is plumbed (`query-verifier.ts:33`,
  `requests/domain/types.ts:164`, `query-aggregate.ts:83`) with no consuming
  check; the check interface is still named `FactorCheck`
  (`proofs/verification/checks/types.ts:39`).
- The URI-dispatch half of the migration is already complete:
  `proofs/verification/verifier.ts:34-54` dispatches via
  `getSchemaBundle(schema)` and never reads `factors` — which strengthens the
  "remove" option.

## Acceptance

- Either `VerificationFactor` / `factors` / `challenge_nonce` /
  `VERIFICATION_FACTORS` are removed from the shared contract and public
  surface (nonce/timestamp becoming schema-internal), or `architecture.md`
  ~224-240 is rewritten to describe the actual current contract. The
  closed-issue references are dropped either way.

## Verification

- If removing: `rg "VerificationFactor|VERIFICATION_FACTORS" packages/sdk/src`
  returns no shared-contract matches; `deno task test:all` passes.
- If documenting: architecture.md no longer claims a contract the code
  contradicts.

## Plan

- Decide remove vs document; execute; drop the 0146-0148 references.
