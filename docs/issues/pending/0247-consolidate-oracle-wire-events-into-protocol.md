# Consolidate Oracle wire events into @anchr/protocol

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

## Summary

The wire contract has two owners. `packages/protocol/src/events.ts` owns
build/parse for eight event types, but four files (353 lines) under
`packages/sdk/src/adapters/nostr/events/` own the rest of the wire surface:
`event-builders.ts` (oracle announcement, kind 30088), `oracle-attestation.ts`
(kind 30103), `dm.ts` (preimage DM, rejection DM, FROST signature DM, and
`parseOracleDM`), plus the shared `events.ts`. The kind constants for all of
these already live in `packages/protocol/src/nostr.ts` (E027), so kinds are
protocol-owned while their event shapes are SDK-owned — exactly the split
ownership E027 exists to prevent. Any compatible implementation that wants to
verify an attestation or read an Oracle DM must currently import SDK
internals. Move build/parse and the wire payload types into
`@anchr/protocol`.

## Rationale

- Measured dependencies of the four files (2026-07-26): `nostr-tools`,
  protocol `KIND_*` constants, `identity.ts` `NostrIdentity` (replaceable by
  the protocol `Keypair`/`NostrSigner`), NIP-44 helpers from
  `adapters/nostr/crypto/encryption.ts` (protocol already exports
  `encryptNip44`/`decryptNip44`), and the payload types `OracleInfo` /
  `OracleAttestation` from `requests/domain/oracle-types.ts` (44 lines,
  wire payloads — move them to protocol with the builders).
- `docs/threat-model.md` ("Trust surface: Attestation publication") states
  "The SDK owns the event shape (`buildOracleAttestationEvent`)"; update that
  sentence to protocol ownership.
- Protocol entrypoints must stay browser-portable (E031); the moved code is
  pure event construction and crypto, which satisfies this.
- `docs/issues/pending/0209-messaging-spec-kind-tables.md` tracks the spec
  side of the same surface.

## Acceptance

- Build and parse functions for kinds 30088, 30103, and the Oracle DMs are
  exported from `@anchr/protocol` (events or nostr subpath); the payload
  types they serialize are protocol-owned.
- `packages/sdk/src/adapters/nostr/events/` no longer defines wire event
  shapes; SDK call sites import from `@anchr/protocol`.
- The threat-model attestation-ownership sentence reflects protocol
  ownership (lock hash updated if an INV body changes; otherwise none).

## Verification

- No matches expected:
  `rg "export function build.*Event|export function parse" packages/sdk/src/adapters/nostr/events/`
- `deno task lint:strict`, `deno task test:unit`, and
  `deno task test:e2e:protocol` pass.
- `deno task publish:dry-run` passes for both packages.

## Plan

- Move `dm.ts` first (only needs the `NostrIdentity` → protocol keypair
  substitution), then `event-builders.ts` / `oracle-attestation.ts` together
  with the `oracle-types.ts` payload types.
- Re-point SDK imports and delete the vacated files.
