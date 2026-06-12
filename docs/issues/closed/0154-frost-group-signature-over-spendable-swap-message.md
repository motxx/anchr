# Bind the FROST group signature to a mint-spendable swap message and add the Provider redeem path

Created: 2026-06-13
Model: Claude Fable 5 (claude-fable-5)
Completed: 2026-06-13

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

The FROST group currently signs `sha256("anchr:sign:" + query.id)`
(`packages/sdk/src/payments/frost/signing-message.ts`), but a NUT-11 P2PK
2-of-2 spend requires a BIP-340 signature over the swap transaction's
SIG_ALL message (proof secrets + blinded outputs). A signature over the
query id can never satisfy the mint, so the delivered `group_signature` is
unusable for redemption and no Provider redeem helper exists
(`frost-escrow-provider.settle()` intentionally returns `{settled:false}`).
Design and implement the message contract that makes the group signature
spendable, plus the Provider-side redeem path.

## Rationale

- `docs/production-readiness-audit.md` §2.5 PROT-05 (weak message binding:
  excludes `request_event_id`, the selected Provider, and a token
  commitment) and PROT-06 (no function applies `group_signature` +
  Provider key as the 2-of-2 P2PK witness).
- NUT-11 SIG_ALL requires the signature over the concatenated proof
  secrets and blinded outputs of the exact swap the Provider submits, so
  the Provider's intended swap must be communicated to the Oracle cluster
  before signing — a wire/spec extension, not an SDK-local fix.
- The peer-signer message binding added for issue 0134 derives the
  expected message from `requirement.id`; the new contract must keep an
  equivalent derivation rule so peers still refuse coordinator-chosen
  arbitrary messages.

## Acceptance

- A spec section defines what the FROST group signs for `p2pk_frost`
  settlement, binding at minimum the swap message (SIG_ALL), the request
  (`request_event_id`), and the selected Provider.
- Peer signers can independently derive/validate the message they sign
  from material they verify.
- A Provider redeem helper applies its own signature plus the group
  signature as the 2-of-2 witness and swaps the token at the mint.
- `deno task test:e2e:frost` (or regtest) exercises sign → redeem.

## Verification

- `deno task test:e2e:frost`
- `deno task test:unit`

## Plan

- Design the swap-message commitment flow (Provider submits intended swap
  with the result; Oracle cluster verifies and signs it).
- Update `signing-message.ts`, the signer routes, and the coordinator
  together; lock with an end-to-end redeem test.

## Resolution

Implemented by updating:

- `packages/sdk/src/payments/frost/signing-message.ts`
- `packages/sdk/src/payments/frost/signing-message.test.ts`
- `packages/sdk/src/adapters/oracle-service/frost-signer-routes.ts`
- `packages/sdk/src/adapters/oracle-service/server-frost.test.ts`
- `packages/sdk/src/payments/frost/frost-signing-coordinator.ts`
- `packages/sdk/src/payments/frost/frost-signature-adapter.ts`
- `packages/sdk/src/requests/application/ports.ts`
- `packages/sdk/src/requests/application/query-verifier.ts`
- `packages/sdk/src/requests/domain/types.ts`
- `packages/sdk/src/proofs/verification/contract.ts`
- `packages/sdk/src/adapters/nostr/events/events.ts`
- `packages/sdk/src/adapters/nostr/events/dm.ts`
- `packages/sdk/src/adapters/nostr/events/frost-dm.test.ts`
- `packages/sdk/src/adapters/nostr/oracle-service.ts`
- `packages/sdk/src/payments/cashu/frost-escrow-provider.ts`
- `packages/sdk/src/payments/cashu/frost-escrow-provider.test.ts`
- `packages/sdk/src/payments/cashu/mod.ts`
- `e2e/regtest/frost-p2pk-cashu.test.ts`
- `specs/paid-request-exchange.md`

Verified with:

- `deno test packages/sdk/src/payments/frost/signing-message.test.ts packages/sdk/src/payments/cashu/frost-escrow-provider.test.ts packages/sdk/src/adapters/nostr/events/frost-dm.test.ts packages/sdk/src/adapters/oracle-service/server-frost.test.ts packages/sdk/src/requests/application/query-service.test.ts packages/sdk/src/adapters/cashu.test.ts packages/sdk/src/payments/cashu/redeem-htlc.test.ts --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys`
- `deno task check`
- `PATH=/private/tmp/anchr-bin:$PATH deno task test:all`
- `deno task test:e2e:regtest` against the Docker regtest stack: all pass,
  including `6b. Provider redeems with merged FROST group signatures without
  the group key` — a real-DKG threshold signature merged into the proof
  witnesses redeemed the 2-of-2 P2PK token at the real mint with no group
  secret key. (Codex's sandbox could not reach the Docker socket; the run
  was completed outside the sandbox.)

Harness update:

- Added unit coverage for token hash binding, per-proof `sha256(utf8(secret))` message derivation, signer-route token rejection paths, per-proof FROST DM payloads, and Provider/group witness merging.
- Added a Docker-regtest-gated e2e path that runs real FROST DKG, signs each `SIG_INPUTS` proof message, merges Provider and group signatures, and swaps without the group secret key.
- Added `specs/paid-request-exchange.md` FROST P2PK settlement rules for `SIG_INPUTS`, peer validation, and release material shape.
- `check-silent-bypass` and `arch-lint-llm` records were refreshed after reviewing the changed package source.

Review residuals:

- None

Follow-up:

- None
