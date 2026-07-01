# Unify port ownership on the consumer side and dissolve adapters/types.ts

Created: 2026-07-02
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

The SDK mixes two port-ownership conventions. Lifecycle ports are
consumer-owned (`requests/domain/ports.ts`, `requests/application/ports.ts`
define `Clock`, `EscrowProvider`, `PreimageStore`, `OracleRegistry`, …, and
`payments/` / `adapters/` implement them — the correct dependency direction).
But the transport/payment/storage ports (`CashuClient`, `RelayClient`,
`ActorStateStore`, `PersistenceStore`) are adapter-owned in
`adapters/types.ts`, even though their consumers are the root role modules
(`customer.ts`, `provider.ts`, `oracle.ts`). One SDK, two conventions; port
placement is not predictable, and the same symbols travel multiple re-export
hops to reach the public surface.

## Rationale

- `packages/sdk/src/adapters/types.ts` (95 lines, fan-in ~15): 4 ports across
  four unrelated concerns plus ~40 lines of Cashu DTOs (`BindProviderParams`,
  `RedeemHtlcParams`, …) that `adapters/cashu.ts` (~lines 38-58) immediately
  re-imports and re-exports — the file acts as a remote type annex of
  `cashu.ts`.
- Direct importers include `customer.ts:14`, `provider.ts:21`, `oracle.ts:22`,
  `customer-types.ts`, `provider-types.ts`, `relay-wait.ts:9`, the nostr
  adapter files, `storage.ts:7`, and `testing/` — i.e. the consumers live at
  the root, the port lives in the adapter directory.
- Triple re-export path for the Nostr DTOs: `types.ts` → `nostr/client.ts:24-29`
  → `nostr/mod.ts:12-17` → `index.ts:135-139`, while `customer/provider/oracle`
  import the same symbols from `types.ts` directly — multiple paths to one
  symbol.
- `adapters/mod.ts` (3 lines, `export *` barrel) has zero importers across
  packages, e2e, examples, and scripts — a dead barrel; `deno.json` exports
  `./adapters` through it.
- Contrast (correct direction): `payments/cashu/cashu-escrow-provider.ts:1` and
  `payments/cashu/frost-escrow-provider.ts:12` import `EscrowProvider` from
  `requests/application/ports.ts`; `adapters/oracle-client/registry.ts:2`
  imports `OracleRegistry` the same way.

## Acceptance

- One recorded port-ownership convention (consumer-owned) and every SDK port
  placed per that convention: `CashuClient` + its DTOs beside their owner,
  `RelayClient`/`Filter`/`Subscription`/`PublishResult` beside the Nostr seam,
  `ActorStateStore`/`PersistenceStore` beside their consumers or `storage.ts`.
- `adapters/types.ts` is deleted or reduced to types genuinely shared by
  multiple adapters, with a header stating its owner responsibility.
- Each public symbol has one export path (no parallel re-export hops).
- `adapters/mod.ts` is either deleted (with the `./adapters` subpath removed or
  retargeted in `deno.json`) or gains a real importer set; a dead barrel does
  not remain.

## Verification

- `deno task lint:strict` and `deno task test:unit` pass after the moves.
- `rg -l '"\.\./adapters/types\.ts"|"\./types\.ts"' packages/sdk/src` shows
  imports only from the file's remaining owner scope (or no matches if the file
  is deleted).
- If `adapters/mod.ts` is deleted:
  `rg "adapters/mod" packages e2e examples scripts` returns no matches.

## Plan

- Record the convention (architecture.md Component Boundaries or an ADR if it
  meets the ADR bar).
- Relocate ports/DTOs to their owners; collapse duplicate re-export paths.
- Delete or repurpose `adapters/mod.ts` and align `deno.json` exports.
