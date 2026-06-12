# Route FROST peer signing HTTP through an injectable transport

Created: 2026-06-12
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- 0117

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
- Conditional on 0117: if FROST escrow is removed from v0, close this issue
  as obsolete; if FROST is completed, this hook is part of completing it.
- Mirror the injection pattern 0124 establishes (injectable `fetchImpl` on
  the coordinator config) rather than inventing a second mechanism.

## Acceptance

- If FROST stays: `coordinateSigning` accepts an injectable transport used
  for all peer round-1/round-2 calls, with a test asserting the injected
  implementation is used; documentation notes the IP-exposure boundary.
- If FROST is removed by 0117: closed as obsolete with a pointer to 0117's
  resolution.

## Verification

- Unit test passes with a spy transport and zero `globalThis.fetch` calls
  during coordination.
- `deno task test:e2e:frost` passes (when FROST is kept).

## Plan

- Wait for 0117's keep-or-remove decision.
- If kept: thread `fetchImpl` through `SigningCoordinatorConfig` into
  `fetchWithTimeout`; reuse the transport type introduced by 0124.
