# Bind the FROST group signature to a mint-spendable swap message and add the Provider redeem path

Created: 2026-06-13
Model: Claude Fable 5 (claude-fable-5)

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0117

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
