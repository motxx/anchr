# Consolidate simple-path lifecycle transitions onto the domain aggregate

Created: 2026-07-07
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- 0249

## Summary

ADR 0003 names the `requests/` Query aggregate the only lifecycle status
model, but the application layer implements the simple-path transitions in
parallel instead of delegating. `doSubmitQueryResult`, `doCancelQuery`, and
`doExpireQueries` in
`packages/sdk/src/requests/application/query-lifecycle-methods.ts` re-implement
the pending → approved/rejected/expired, cancel, and expire transitions
inline, while the domain functions `submitResult`, `cancelQuery`, and
`expireQuery` in `packages/sdk/src/requests/domain/query-aggregate.ts` have no
production callers. The two copies have already drifted: the domain sets
`assigned_oracle_id` with an `?? oracleId` fallback the application lacks, and
the expiry outcome semantics differ (`ok: true` with an expired query vs
`ok: false` with a stored expired query). `doSubmitEscrowResult` likewise
finalizes verifying → approved/rejected through `verifyAndFinalize`'s inline
spread (`verification-orchestration.ts`) instead of the domain
`completeVerification`, contradicting the contract stated at the top of
`escrow-flow-methods.ts` that every state change goes through the aggregate.

## Rationale

- Found by `arch-lint-llm` (L003, logic duplication) during the PR #212
  pre-ship review; PR #212 introduced ADR 0003
  (`docs/adr/0003-requests-aggregate-owns-lifecycle.md`), which makes a
  parallel status implementation a defect rather than a design option.
- The PR #212 diff had to apply the `isCancellable` → `isOpenStatus` rename in
  both copies — a concrete instance of the divergence cost.
- `escrow-flow-methods.ts` already shows the target shape: `doRecordOffer`,
  `doSelectProvider`, `doBeginWork`, `doRecordResult`, and
  `doCompleteVerification` all delegate to the aggregate and map
  `TransitionResult` to outcome messages.
- Related: 0191 drives the role facades through these application services;
  0222 threads a `Clock` port through the same layer. Both touch the same
  files, so coordinate sequencing at resolution time.

## Acceptance

- Every lifecycle state change in `requests/application` goes through a domain
  aggregate transition function; no application function computes
  `status` / `payment_status` values itself.
- `submitResult`, `cancelQuery`, and `expireQuery` either have production
  callers in the application layer or are deleted in favor of the functions
  the application does call — one owner, no parallel copy.
- Observable outcomes of the service methods (ok flags, messages, stored
  query states) are locked by tests before and after the consolidation.

## Verification

- `deno task test:unit` and `deno task test:integration` pass.
- Reading `query-lifecycle-methods.ts` and `verification-orchestration.ts`
  shows no inline `status:` / `payment_status:` transition writes; the only
  spread-based state construction lives in `query-aggregate.ts`. Expected: no
  matches for `rg 'status: (passed|"rejected"|"expired")' packages/sdk/src/requests/application/`.

## Plan

- Delegate `doSubmitQueryResult` to `submitResult`, `doCancelQuery` to
  `cancelQuery`, and `doExpireQueries` to `expireQuery`, reconciling the
  drifted `assigned_oracle_id` and expiry-outcome semantics deliberately.
- Route `doSubmitEscrowResult` finalization through `completeVerification`;
  shrink `verifyAndFinalize` to verification orchestration only.
- Lock the reconciled outcome semantics with unit tests.
