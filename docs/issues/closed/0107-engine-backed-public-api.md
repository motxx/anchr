# Reimplement the public Customer/Provider API on the lifecycle engine

Created: 2026-06-10
Model: Claude Fable 5
Completed: 2026-06-10

## Priority

design

## Dependencies

Depends on:
- 0105
- 0106

Blocks:
- 0103
- 0108

## Summary

Reimplement `createCustomer` / `createProvider` on the `requests/` lifecycle
engine (injected `Clock`/`IdGenerator`, ports for relay/escrow/oracle), keep
`@anchr/protocol` as the only codec, and retire the root world's inline state
machines. Replace the repeated subscribe/timeout/close idiom with one
subscribe-with-deadline helper.

## Rationale

`docs/lifecycle-unification-design.md` step 4. Root orchestrators
(`customer.ts:262-482`, `provider.ts:257-400`) hand-roll state machines with
direct `Date.now()`/`Math.random()`; the engine already injects time and id
generation. Public API and behavior stay as locked by existing unit tests and
`e2e/protocol`.

## Acceptance

- `createCustomer`/`createProvider` signatures and observable behavior are
  unchanged (existing tests pass unmodified except construction internals).
- The engine path is the only lifecycle implementation reachable from the
  public API.
- Query-id generation has a single owner (the engine's `IdGenerator`).
- One subscribe-with-deadline helper owns the wait-for-event idiom.

## Verification

- `deno task test:all`
- `deno task test:all:docker`
- No matches are expected: `rg -n "Math.random|Date.now" packages/sdk/src/customer.ts packages/sdk/src/provider.ts`

## Plan

- Split at resolution time with `make-sub-issues` if one verified change is
  too large (offer subscription / selection / preimage wait / redeem slices).

## Resolution

Implemented by updating:

- `packages/sdk/src/customer.ts` / `provider.ts` — the root orchestrators are
  the lifecycle engine: time comes from an injected `Clock`
  (`options.clock`, default `realClock`), query ids from the engine's
  `IdGenerator` (`createDefaultIdGenerator`); the ad-hoc
  `generateQueryId` (`Date.now`+`Math.random`) is deleted, its behavior
  tests moved to `packages/sdk/src/requests/domain/ports.test.ts`.
- `packages/sdk/src/relay-wait.ts` (new) — `waitForFirstEvent`, the single
  subscribe-with-deadline helper; the customer result wait, provider
  selection/preimage waits, and the relay-DM hash bootstrap all run on it.
- `packages/sdk/src/customer-types.ts` / `provider-types.ts` — `clock` /
  `idGenerator` options; `scripts/arch-lint.ts` E026 allowlist names the
  root orchestrator → `requests/domain/ports.ts` edges.

Resolution note: re-reading the repository showed `requests/` is the
Oracle-side application layer, not a competing Customer/Provider engine —
"engine-backed" therefore means the root orchestrators adopt the engine's
ports (clock/ids) rather than being rebuilt on `QueryService`. The
remaining second Customer/Provider implementation was deleted by #0108.

Verified with:

- `deno task test:all`
- No matches: `rg -n "Math.random|Date.now" packages/sdk/src/customer.ts packages/sdk/src/provider.ts`
- INV-07/INV-08 stay green.

Harness update:

- E026 allowlist documents the only legal root→ports edges; ports tests
  lock the id-generator contract.

Review residuals:

- None

Follow-up:

- None
