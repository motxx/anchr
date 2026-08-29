# Consolidate Oracle protocol events into @anchr/protocol

Created: 2026-07-26
Model: Claude Opus 5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- 0248
- 0250
- 0252
- 0253

## Summary

The interoperable message formats have two owners. `packages/protocol/src/events.ts` owns
build/parse for eight event types, but four files (353 lines) under
`packages/sdk/src/adapters/nostr/events/` define the remaining messages:
`event-builders.ts` (oracle announcement, kind 30088), `oracle-attestation.ts`
(kind 30103), `dm.ts` (preimage DM, rejection DM, FROST signature DM, and
`parseOracleDM`), plus the shared `events.ts`. The kind constants for all of
these already live in `packages/protocol/src/nostr.ts` (E027), so kinds are
defined by `@anchr/protocol` while their message formats are defined in the SDK — exactly the split
ownership E027 exists to prevent. Any compatible implementation that wants to
verify an attestation or read an Oracle DM must currently import SDK
internals. Move build/parse and the message payload types into
`@anchr/protocol`.

## Rationale

- Measured dependencies of the four files (2026-07-26): `nostr-tools`,
  protocol `KIND_*` constants, `identity.ts` `NostrIdentity` (replaceable by
  the protocol `Keypair`/`NostrSigner`), NIP-44 helpers from
  `adapters/nostr/crypto/encryption.ts` (protocol already exports
  `encryptNip44`/`decryptNip44`), and the payload types `OracleInfo` /
  `OracleAttestation` from `requests/domain/oracle-types.ts` (44 lines,
  message payloads — move them to protocol with the builders). OracleInfo's
  `supported_payment_lock_types` also requires `PaymentLockType` to be defined by `@anchr/protocol`;
  move that canonical value set out of the SDK request domain with it.
- `docs/threat-model.md` ("Attestation publication") states
  "The SDK defines the event format (`buildOracleAttestationEvent`)"; update that
  sentence to protocol ownership.
- Protocol entrypoints must stay browser-portable (E031); the moved code is
  pure event construction and crypto, which satisfies this.
- `docs/issues/pending/0209-messaging-spec-kind-tables.md` tracks the spec
  same messages in the specification.

## Acceptance

- Build and parse functions for kinds 30088, 30103, and the Oracle DMs are
  exported from `@anchr/protocol` (events or nostr subpath); the payload
  types they serialize are defined by `@anchr/protocol`.
- Every moved JSON format has its own version constant and the required root
  field `version: 0`; its parser rejects a missing, non-integer, or unsupported
  version. Changing one format's version does not change another format.
- `PaymentLockType` and its accepted values are defined once in
  `@anchr/protocol`; Oracle registry payloads import that definition rather
  than defining or copying their own values.
- `packages/sdk/src/adapters/nostr/events/` no longer defines protocol event
  shapes; SDK call sites import from `@anchr/protocol`.
- The threat-model attestation-ownership sentence reflects protocol
  ownership (lock hash updated if an INV body changes; otherwise none).

## Requirement traceability

| Requirement | Verification |
| --- | --- |
| Kinds 30088, 30103, and every Oracle DM have one builder, parser, and payload type in `@anchr/protocol` | Protocol unit tests round-trip one valid event and reject one malformed event for every moved event type. |
| Every moved JSON format owns an independent integer version, initially `0` | Builder tests inspect plaintext or decrypted JSON; parser tests reject a missing, string, and unsupported version for every moved format; a type test changes one fixture's version without changing its siblings. |
| `PaymentLockType` and its accepted values have one owner | An architecture-lint rule rejects a value-set definition outside `@anchr/protocol`; its negative fixture defines an SDK copy and must fail. |
| SDK adapters no longer define or re-export message formats | The no-export command below returns no matches, and SDK call sites compile using protocol imports. |
| Threat-model ownership text names protocol | A focused docs assertion checks that the attestation section names `@anchr/protocol`, followed by `lint:invariants`. |
| Both packages expose valid publish surfaces | `deno task publish:dry-run` succeeds for both packages. |

## Verification

- `packages/sdk/src/adapters/nostr/events/` retains no exported symbol of
  any kind (builders, parsers, payload types, constants, re-exports):
  `rg "^export" packages/sdk/src/adapters/nostr/events/` returns nothing, or
  the directory is deleted.
- `deno task lint:strict`, `deno task test:unit`, and
  `deno task test:e2e:protocol` pass.
- `deno task publish:dry-run` passes for both packages.

## Plan

- Move `dm.ts` first (only needs the `NostrIdentity` → protocol keypair
  substitution), then `event-builders.ts` / `oracle-attestation.ts` together
  with the `oracle-types.ts` payload types.
- Re-point SDK imports and delete the vacated files.
