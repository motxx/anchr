# Promote requests/ to the Oracle-owned state machine and revise ADR 0003

Created: 2026-07-26
Model: Claude Opus 5

## Priority

design

## Dependencies

Depends on:
- 0243
- 0245

Blocks:
- 0250

## Summary

The `requests/` lifecycle machine (13 files, 1,405 non-test lines, 3,404 test
lines: `query-aggregate.ts`, `query-store.ts`, `query-service.ts`,
`escrow-flow-methods.ts`, `query-lifecycle-methods.ts`, and siblings) has zero
production callers — it is reachable only via `@anchr/sdk/testing`, and 7 of
17 e2e files drive it there. Production lifecycle transitions are implemented
inline in `customer.ts`, `provider.ts`, and
`adapters/nostr/oracle-service.ts`. ADR 0003 declares the aggregate "the only
lifecycle status model" for all roles, which no production code satisfies.

Resolve the split by promoting the machine to the Oracle's persistent state
model, wired into the production Oracle daemon.
Customer and Provider keep request-lifetime volatile state; role-neutral
transition vocabulary moves to `@anchr/protocol`. The `domain/` /
`application/` layer directories dissolve — that layering exists nowhere else
in the repository and is held up only by E026/E029 lint and duplicated ports
files.

## Rationale

- Production usage of `requests/` (measured 2026-07-26) is limited to five
  vocabulary/port files (479 lines): `application/ports.ts`,
  `domain/types.ts`, `domain/ports.ts`, `application/query-verifier.ts`,
  `domain/oracle-types.ts` (the last moves to protocol in 0247).
- Wiring the daemon through the promoted machine makes the 3,404 test lines
  guard production, gives the Oracle restart safety (verified-but-undelivered
  state currently lives in in-memory `WatchedQuery` maps), and lets the
  INV-02 production test (0245) hold across the migration — hence the
  dependency.
- Per-role state models differing is intended: Customer/Provider volatile,
  Oracle persistent; shared parts are protocol types and transition
  vocabulary, not state. ADR 0003 must be revised to claim exactly that.
- 0243 (consolidating duplicated transition logic onto the aggregate) is
  groundwork; 0242 (escrow factory wiring), 0222 (clock port), and 0191
  (role facade decomposition) touch the same files — coordinate sequencing.
- Resolver-led split applies: if one coherent change is too large, split with
  `make-issues` before implementation.

## Acceptance

- The production Oracle daemon persists and transitions request state through
  the promoted machine; no lifecycle status computation remains inline in
  `adapters/nostr/oracle-service.ts` / `oracle-handlers.ts`.
- Pure transition vocabulary lives in `@anchr/protocol`; the machine lives in
  an Oracle-owned module; the `requests/domain` and `requests/application`
  directories no longer exist.
- ADR 0003 states Oracle ownership (protocol owns transition vocabulary,
  roles own their projections); E026/E029 are retired, with boundary
  enforcement handed to 0250's reachability lint.
- Release delivery is crash-safe: a durable delivery intent (outbox) with an
  idempotency key tied to the request and its state version covers the gap
  between committing a verified state and publishing the delivery DM.

## Verification

- `deno task test:all` passes; the 0245 INV-02 production-path test passes
  unchanged.
- No matches expected: `rg "requests/(domain|application)" packages e2e examples`
- Restart-safety is covered by a test: a request in a verified-but-undelivered
  state survives an Oracle process restart, and a crash injected between
  state commit and delivery publication yields exactly one delivery on retry.

## Plan

- Land 0243's consolidation, then move vocabulary to protocol, then rehome
  the machine under the Oracle module and wire the daemon through it.
- Rewrite the seven `createQueryService`-driven e2e files against the
  promoted entry points; revise ADR 0003 and the lints last.
