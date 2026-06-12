# Route FROST peer signing HTTP through an injectable transport

Created: 2026-06-12
Model: Claude Fable 5

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
