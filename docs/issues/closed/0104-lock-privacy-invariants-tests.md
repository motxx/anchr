# Lock P1/P2 privacy invariants with tests

Created: 2026-06-10
Model: Claude Fable 5
Completed: 2026-06-10

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0103
- 0105
- 0106

## Summary

Add locking tests for the two privacy invariants that currently have none,
before any unification work changes the code that provides them:

- P1: two sequential requests publish under distinct ephemeral pubkeys unless
  a persistent signer is explicitly injected.
- P2: the full Customer/Provider/Oracle exchange can complete relay-only
  (in-process relay, no HTTP listener anywhere in the flow).

Declare them as INV-07 and INV-08 in `docs/threat-model.md` with the lock-file
process.

## Rationale

`docs/lifecycle-unification-design.md` privacy invariant table. P1 machinery
lives in `packages/sdk/src/adapters/nostr/crypto/identity.ts`; P2 initially
exercises the adapter world's DM path
(`packages/sdk/src/adapters/nostr/oracle-service.ts`).

## Acceptance

- INV-07 and INV-08 exist in `docs/threat-model.md` with `enforced` status.
- Each has at least one test discovered by the unit or `e2e/protocol` tier.
- `deno task lint:invariants` passes.

## Verification

- `deno task lint:invariants`
- `deno task test:unit`
- `deno task test:e2e:protocol`

## Plan

- Write the P1 unit test against the current ephemeral-identity default.
- Write the P2 protocol-bucket e2e against the in-process relay test double.
- Add INV-07/INV-08 entries and update `docs/threat-model.lock.json`.

## Resolution

Implemented by updating:

- `packages/sdk/src/customer.test.ts` — `INV-07: two sequential requests
  publish under distinct ephemeral pubkeys` (locks the fresh-keypair-per-
  request behavior already present in `Customer.request`).
- `e2e/protocol/anonymous-relay-flow.test.ts` — `INV-08: full exchange
  completes relay-only with no HTTP endpoint` (full Customer/Provider/Oracle
  exchange over an in-memory relay; Oracle hash bootstrap through the
  injectable `OracleClient` port; Release Material via relay DM; Provider
  redeem asserted).
- `docs/threat-model.md` — INV-07 and INV-08 declared `enforced`.
- `docs/threat-model.lock.json` — entries added with justifications.

Verified with:

- `deno task lint:invariants`
- `deno task test:unit`
- `deno task test:e2e:protocol`
- `deno task test:all`

Harness update:

- Two new threat-model invariants (INV-07/INV-08) wired into
  `lint:invariants`; their tests run in the unit and protocol-e2e tiers.

Review residuals:

- INV-08 currently proves the port seam (in-process `OracleClient`); the
  default relay-DM hash bootstrap that removes the HTTP adapter from the
  default path is #0106.

Follow-up:

- None
