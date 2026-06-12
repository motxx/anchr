# Bind FROST round-2 message to the round-1 verified query

Created: 2026-06-12
Model: Claude Fable 5 (claude-fable-5)
Completed: 2026-06-13

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

The FROST signer HTTP API performs the mandatory independent verification in
round 1, but the verified requirement is never bound to the message that
round 2 signs. Round 1 stores only the nonces, keyed by a random `nonce_id`;
round 2 signs whatever `body.message` the caller supplies with those nonces.
A coordinator that passes verification once for query X can therefore obtain
signature shares for an arbitrary other message, defeating the signer
independence defense.

## Rationale

- `packages/sdk/src/adapters/oracle-service/frost-signer-routes.ts`: round 1
  verifies and stores `pendingNonces.set(nonceId, ...)` only; round 2 calls
  `signRound2(keyPackageJson, nonces, body.commitments, body.message)` with
  the unchecked caller message.
- Found by the `check-silent-bypass` full-file review (Pattern A) on
  2026-06-12. Pre-existing behavior, not introduced by the reviewed branch.
- The nonce-reuse comment in round 1 is correct (key by random session id),
  but it does not substitute for binding the verified context to the message.

## Acceptance

- Round 2 refuses to produce a signature share when the supplied message does
  not match the message derived from the requirement verified in round 1 for
  that nonce session.
- A test locks the rejection.

## Verification

- `deno task test:unit` with a new signer-routes test: round 2 with a
  mismatched message returns an error response and no `signature_share`.
- `deno task test:e2e:frost` still passes.

## Plan

- Derive the expected message from the round-1 verified requirement and store
  it alongside the nonces under the same `nonce_id`.
- Compare in round 2 and reject on mismatch.

## Resolution

Decision: bind round 2 to a message the signer derives itself.

Implemented by updating:

- `packages/sdk/src/payments/frost/signing-message.ts` (new single owner of
  the `sha256("anchr:sign:" + queryId)` derivation)
- `packages/sdk/src/payments/frost/mod.ts`,
  `packages/sdk/src/payments/frost/frost-signature-adapter.ts`,
  `packages/sdk/src/adapters/nostr/oracle-service.ts` (all derive through it)
- `packages/sdk/src/adapters/oracle-service/frost-signer-routes.ts` — round 1
  rejects a message that does not match the verified requirement, stores
  `{noncesJson, messageHex}` per random session id; round 2 consumes the
  session once and rejects a mismatched message (403)
- `packages/sdk/src/adapters/oracle-service/server.ts` (typed session map)
- `packages/sdk/src/adapters/oracle-service/server-frost.test.ts`

Verified with:

- `deno task test:unit` (new round-1/round-2 message-binding tests)
- `deno task test:e2e:frost`
- `deno task test:all`

Harness update:

- `server-frost.test.ts` "FROST signer message binding" suite locks the
  rejection on both rounds.

Review residuals:

- None

Follow-up:

- Issue 0154 owns strengthening what the message itself commits to
  (mint-spendable swap message).
