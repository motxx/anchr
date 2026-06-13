# Route FROST peer signing HTTP through an injectable transport

Created: 2026-06-12
Model: Claude Fable 5
Completed: 2026-06-13

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- 0143

## Summary

The FROST signing coordinator calls peer Oracle endpoints with a direct
`fetch` wrapper and no injectable transport
(`packages/sdk/src/payments/frost/frost-signing-coordinator.ts:75,141`,
via `fetchWithTimeout` at `:220`). Peer Oracles therefore see the
coordinator's IP, and the calls cannot be routed over SOCKS5/Tor — the same
gap class that 0124 closes for mint/Blossom, but untracked for FROST.

## Rationale

- Privacy premise: every non-relay network touchpoint must be proxy-routable
  or documented as an accepted exposure (cf. INV-08 scope notes in 0124).
- 0117 kept FROST escrow in v0, so this hook applies to the FROST peer
  coordination surface.
- Mirror the injection pattern 0124 establishes (injectable `fetchImpl` on
  the coordinator config) rather than inventing a second mechanism.

## Acceptance

- `coordinateSigning` accepts an injectable transport used for all peer
  round-1/round-2 calls, with a test asserting the injected implementation is
  used; documentation notes the IP-exposure boundary.

## Verification

- Unit test passes with a spy transport and zero `globalThis.fetch` calls
  during coordination.
- `deno task test:e2e:frost` passes (when FROST is kept).

## Plan

- Thread `fetchImpl` through `SigningCoordinatorConfig` into
  `fetchWithTimeout`; reuse the transport type introduced by 0124.

## Resolution

Implemented by updating:

- `packages/sdk/src/payments/frost/frost-signing-coordinator.ts`
- `packages/sdk/src/payments/frost/frost-signing-coordinator.test.ts` (new)
- `docs/threat-model.md`
- `docs/threat-model.lock.json`
- `docs/issues/pending/0143-premise-alignment-restructuring-plan.md`

`SigningCoordinatorConfig` gained an optional `fetchImpl` (defaulting to
`globalThis.fetch`), threaded through `fetchWithTimeout` into both peer
round-1 and round-2 calls — the same injection shape 0124 established for
mint/Blossom. The INV-08 scope note now lists FROST peer round HTTP alongside
the mint/Blossom/TLSN touchpoints as proxy-routable exposure, with its lock
hash bumped and justified.

Verified with:

- `deno task check` (0 errors), `deno task lint:strict`, `deno task test:unit`
  (297 passed); the new unit test asserts all peer round-1/round-2 calls route
  through the injected `fetchImpl` and `globalThis.fetch` is never called
  during coordination (spy rejects, asserted empty).
- `deno task test:e2e:frost` is exercised by the integrated `deno task
  test:all` run on the branch (default transport unchanged).

Harness update:

- `frost-signing-coordinator.test.ts` locks the injected-transport behavior;
  `docs/threat-model.lock.json` drift-locks the INV-08 scope-note change.

Review residuals:

- None.

Follow-up:

- None
