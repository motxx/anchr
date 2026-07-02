# Split the oracle-service adapter's four responsibilities

Created: 2026-07-02
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

`adapters/nostr/oracle-service.ts` (502 lines) bundles subscription/watch
lifecycle, single-oracle verify-and-deliver (with an inline retry loop), FROST
threshold verify-and-deliver, quorum-vs-single dispatch policy, and a from-env
constructor. The most security-sensitive path (release authority) is hard to
isolate and test, and the "verify fails → build rejection DM → publish → log"
block is duplicated verbatim.

## Rationale

- `packages/sdk/src/adapters/nostr/oracle-service.ts`: single-oracle delivery
  (~246-262), FROST delivery (~287-364), dispatch policy (~366-391);
  the rejection block is copied at ~273-284 and ~295-306.
- Deeper finding (2026-07-02 architecture review): role-neutral release
  semantics live in the adapter, contra `docs/architecture.md` ("Nostr adapter
  role helpers ... only when inseparable from relay subscription, event
  publication, NIP-44 encryption, or Nostr event parsing"):
  the quorum-vs-single dispatch policy including the never-downgrade trust
  rule (~366-391); `WatchedQuery` request state
  (`oracle-handlers.ts:16-24`, the third production state model noted in
  0190); evidence mapping `oracleResponseToResult`
  (`oracle-handlers.ts:69-96`, resolves schema evidence and registers
  bundles); and `hash-responder.ts` owning INV-08 issuance semantics.
  Role/lifecycle identifiers appear 36 times across non-test
  `adapters/nostr/*.ts`.

## Acceptance

- The rejection path is a single `deliverRejection()` helper; single-oracle and
  FROST delivery strategies live in separate modules behind the dispatcher; the
  factory owns only wiring.
- The role-neutral release semantics listed in the 2026-07-02 review addendum
  (quorum dispatch policy, `WatchedQuery` state, evidence mapping,
  hash-responder issuance) are either moved out of `adapters/nostr/` in this
  change or split into a linked follow-up issue before closing; the eviction
  direction follows the 0190 ownership decision.

## Verification

- `deno task test:unit` + `deno task test:integration` (oracle-service) pass;
  the rejection block exists once.

## Plan

- Extract `deliverRejection()`; split delivery strategies; keep the dispatcher
  thin.
