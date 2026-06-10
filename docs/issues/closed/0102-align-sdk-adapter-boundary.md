# Align SDK adapter boundary

Created: 2026-06-03
Model: GPT-5 Codex
Completed: 2026-06-10

## Priority

design

## Dependencies

Depends on:
- 0097

Blocks:
- 0080
- 0085

## Summary

Align the SDK adapter boundary with the v0 decision that Anchr is
Nostr-native and Cashu-settled. `sdk/src/adapters` may remain as the concrete
runtime and I/O binding layer, but it must not imply that Nostr or Cashu are
replaceable substrate profiles.

The current code has mostly reasonable ownership, but several active SDK
adapter files still blur the boundary between canonical protocol/payment
semantics and concrete runtime clients.

## Rationale

ADR `docs/adr/0001-fix-v0-substrate-to-nostr-and-cashu.md` fixes v0 to Nostr
and Cashu while keeping SDK relay and payment ports as I/O and test
boundaries, not substrate replacement promises.

Code review found these boundary risks:

- `packages/sdk/src/adapters/nostr/client.ts` defines Nostr kind constants,
  key helpers, NIP-44 helpers, and tag helpers that already belong to
  `packages/protocol/src/nostr.ts`.
- `packages/sdk/src/adapters/nostr/events/events.ts` defines Nostr event
  payloads separately from `packages/protocol/src/events.ts`, making it look
  like a second wire contract.
- `packages/sdk/src/adapters/cashu-htlc-options.ts` duplicates settlement
  option builders that are also present under `packages/sdk/src/payments/`.
- `AdapterManifest` and `AdapterCapability` may read like public substrate
  replacement metadata unless they are removed or reframed as diagnostic
  runtime metadata.

This issue intentionally depends on #0097 because some adapter event cleanup
overlaps with the final public request advertisement decision.

## Acceptance

- `sdk/src/adapters` is documented and implemented as fixed-substrate runtime
  binding code, not as a plug-in layer for alternative transport or settlement
  substrates.
- SDK Nostr adapter code no longer owns canonical Nostr protocol primitives or
  duplicate canonical event payload shapes; those come from `@anchr/protocol`
  or are explicitly documented as SDK-local policy.
- Cashu HTLC/P2PK settlement option builders have one clear owner, and concrete
  cashu-ts mint/wallet calls remain in the Cashu adapter client.
- `AdapterManifest` / `AdapterCapability` are removed, narrowed, or explicitly
  reframed so they do not advertise substrate replaceability.
- Public docs and package exports describe `@anchr/sdk/adapters/*` consistently
  with ADR `0001`.
- Any remaining SDK-local Nostr event or Cashu payment helper is justified by a
  concrete runtime binding responsibility, not by compatibility with a
  hypothetical alternative substrate.

## Verification

- `deno task lint:arch`
- `deno task lint:strict`
- `deno task test:unit`
- No SDK-owned duplicate canonical Nostr wire contract is expected:
  `rg -n "export interface QueryRequestPayload|export const KIND_QUERY_REQUEST|ANCHR_MARKETPLACE_LISTING" packages/sdk/src/adapters/nostr`
- Canonical Nostr wire definitions are expected to live under
  `packages/protocol/src`.
- Manual check: `docs/architecture.md`, `packages/sdk/README.md`, and
  `packages/sdk/deno.json` present adapters as runtime bindings, not substrate
  replacement profiles.

## Plan

- Re-read the current protocol event helpers, SDK Nostr adapter, Cashu adapter,
  payment helpers, and public exports after #0097 closes.
- Decide whether `AdapterManifest` / `AdapterCapability` still serve an SDK
  runtime diagnostic purpose.
- Move or rewire duplicated protocol primitives and event payload definitions
  to the canonical protocol owner.
- Consolidate duplicate Cashu HTLC option builders under the chosen payment
  owner and keep cashu-ts-specific calls in the concrete Cashu adapter.
- Update architecture/package docs and add lint enforcement if a mechanical
  rule can prevent the same boundary drift.

## Resolution

Implemented by updating:

- `packages/protocol/src/nostr.ts` — promoted `KIND_ORACLE_ANNOUNCEMENT` (30088)
  and `KIND_ORACLE_ATTESTATION` (30103) into the canonical kind catalogue.
- `packages/sdk/src/adapters/nostr/client.ts` — reduced to relay transport
  binding only (`publishOnce`, `createRelayClient`); deleted the verbatim
  fork of protocol key/NIP-44/tag/kind helpers.
- `packages/sdk/src/adapters/nostr/events/events.ts` — deleted SDK-owned kind
  constants and the unused `ANCHR_MARKETPLACE_LISTING`; renamed the SDK-local
  DVM-dialect payload shapes to `Dvm*` (`DvmQueryRequestPayload`,
  `DvmQueryResponsePayload`, `DvmOfferFeedbackPayload`,
  `DvmSelectionFeedbackPayload`) and documented the module as non-canonical.
- `packages/sdk/src/adapters/nostr/{events/dm.ts,events/oracle-attestation.ts,events/event-builders.ts,transport/client.ts,index.ts}`,
  `packages/sdk/src/adapters/oracle-client/oracle-discovery.ts`,
  `e2e/relay/oracle-discovery.test.ts` — kinds now imported from
  `@anchr/protocol/nostr`.
- `packages/sdk/src/adapters/types.ts`, `packages/sdk/src/index.ts`,
  `packages/sdk/src/adapters/{cashu.ts,storage.ts}`,
  `examples/paid-request-simulation/mod.ts` — removed
  `AdapterManifest`/`AdapterCapability`/`checkCapabilities` and all `manifest`
  fields (substrate-replaceability metadata, contra ADR 0001).
- Deleted `packages/sdk/src/adapters/cashu-htlc-options.ts`;
  `packages/sdk/src/payments/cashu-htlc-options.ts` is the single owner and
  the Cashu adapter imports it.
- `docs/architecture.md` — adapters documented as fixed-substrate runtime
  bindings per ADR 0001.

Verified with:

- `deno task check`
- `deno task lint:arch` / `deno task lint:strict`
- `deno task test:unit`, `deno task test:e2e:protocol`, `deno task test:all`
- `rg -n "export interface QueryRequestPayload|export const KIND_QUERY_REQUEST|ANCHR_MARKETPLACE_LISTING" packages/sdk/src/adapters/nostr` → no matches

Harness update:

- `scripts/arch-lint.ts` gained `[E027]`: any `export const KIND_*/ANCHR_* = <number>`
  defined inside the sdk package is an error; kind constants must be imported
  from `@anchr/protocol/nostr`.

Review residuals:

- The `Dvm*` payload shapes in `adapters/nostr/events/` remain a second,
  SDK-local event dialect consumed by the `customer-service`/`provider-service`
  orchestration layer. Converging or retiring that layer is the unification
  work tracked by the Customer/Provider single-implementation design (Phase 2),
  which must preserve the anonymous relay-only P2P flow (ephemeral identities,
  region-key relay-observer privacy) per maintainer direction.

Follow-up:

- None
