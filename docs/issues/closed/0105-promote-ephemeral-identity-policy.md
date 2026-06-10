# Promote ephemeral identity policy into the lifecycle engine

Created: 2026-06-10
Model: Claude Fable 5
Completed: 2026-06-10

## Priority

design

## Dependencies

Depends on:
- 0104

Blocks:
- 0103
- 0107

## Summary

Make fresh-keypair-per-request the engine-level default signer source, with
persistent signers as an explicit injected option. Both current worlds consume
the same policy module so the unification step (0107) inherits it unchanged.

## Rationale

P1 in `docs/lifecycle-unification-design.md`. Today ephemeral identity lives
only in the adapter world (`adapters/nostr/crypto/identity.ts`); the root
world takes caller-provided keypairs with no stated default policy.

## Acceptance

- One module owns identity policy; both orchestration paths use it.
- Ephemeral-by-default is observable: INV-07 test stays green without
  test-side identity wiring.
- No duplicate keypair-generation helpers remain in `packages/sdk/src`.

## Verification

- `deno task test:unit`
- `deno task lint:arch`
- No matches are expected: `rg -n "generateSecretKey" packages/sdk/src --glob '!**/*.test.ts'` outside the identity policy module.

## Plan

- Decide the module location with the engine (requests/ application layer or a
  sibling policy module) at resolution time based on current imports.
- Rewire `customer.ts`/`provider.ts` and the adapter services to consume it.

## Resolution

Implemented by updating:

- `packages/sdk/src/identity.ts` (new) — the single identity-policy module:
  `NostrIdentity`, `generateEphemeralIdentity()` (built on the protocol
  package's `generateKeypair` primitive), `restoreIdentity()` for explicit
  persistent identities.
- `packages/sdk/src/customer.ts` — the root-world request identity now comes
  from `generateEphemeralIdentity()` (same policy module as the adapter
  world).
- Deleted `packages/sdk/src/adapters/nostr/crypto/identity.ts`; all 19
  importers (adapter services, event builders, attachments, tests) rewired to
  `packages/sdk/src/identity.ts`; its test relocated to
  `packages/sdk/src/identity.test.ts`.

Verified with:

- `deno task check`
- `deno task test:all` (INV-07 stays green without test-side identity wiring)
- No matches: `rg -n "generateSecretKey" packages/sdk/src --glob '!**/*.test.ts'`

Harness update:

- None — INV-07 (declared in #0104) is the locking test for this policy;
  this issue moved the policy to one owner.

Review residuals:

- None

Follow-up:

- None
