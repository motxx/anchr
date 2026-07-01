# FROST peer signers must authenticate the work policy, not trust the coordinator

Created: 2026-07-02
Model: Claude Fable 5

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

FROST peer signers verify a proof against a requirement and input that both
come from the coordinator's request body. The check therefore only proves the
coordinator's own input satisfies the coordinator's own policy — it never
binds the signature to the customer's real verification requirement. A single
malicious coordinator that also runs one node can present a real group-locked
token with a fabricated (trivial) requirement and collect signatures from
honest peers, releasing payment without the customer's work being verified.

## Rationale

- `packages/sdk/src/adapters/oracle-service/frost-signer-routes.ts` (~lines
  52-108): `/frost/signer/round1` runs `verifyProof(body.requirement,
  body.input, …)` on coordinator-supplied values.
- `packages/sdk/src/payments/frost/frost-signing-coordinator.ts` (~lines
  82-97) forwards `config.requirement` / `config.input`.
- `isAllowedSigningMessage` binds the message to the token
  (`escrow_token_hash`, `tokenMatchesFrostP2pkLock`) but not to an
  authenticated work policy.
- Only the documented *colluding threshold* should be able to release; here one
  malicious node fools honest peers. Relates to INV-05.

## Acceptance

- Peers derive the verification requirement from an authenticated source (the
  customer-signed kind-5300 query event or a signature over the requirement),
  not from the coordinator's request body.
- A fabricated requirement that does not match the customer-signed one is
  rejected by an honest peer.

## Verification

- Integration test: an honest peer refuses to sign when the coordinator's
  requirement differs from the customer-signed requirement bound to the token.

## Plan

- Forward the customer-signed query event to peers; re-derive `requirement`
  locally and verify the customer signature before running `verifyProof`.
