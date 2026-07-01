# Shrink the @anchr/sdk root barrel to the common setup path

Created: 2026-07-02
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- 0202

Blocks:
- None

## Summary

`docs/architecture.md` says root exports exist "for the common Customer,
Provider, and Oracle setup path", but `index.ts` re-exports 102 named symbols
across at least seven ownership areas: raw protocol event builders/parsers,
19 `@anchr/protocol/nostr` crypto helpers, the full Cashu client API
(17 symbols), storage adapters, the oracle client, a server-only daemon helper
(`serveHashRequests`), and the dead verification-factor exports tracked by
0202. The root interface is nearly as wide as the SDK, so internal changes
ripple to the root: `index.ts` is the most-churned source file in the repo
(20 of the last 300 commits). Every re-exported symbol already has a public
subpath owner (`@anchr/protocol/events`, `/adapters/cashu`, `/adapters/nostr`,
`/adapters/storage`).

## Rationale

- `packages/sdk/src/index.ts:25-43` re-exports protocol event
  builders/parsers; `:113-132` re-exports 19 protocol/nostr helpers;
  `:165-181` re-exports the whole Cashu client surface; `:160-163` exports
  `serveHashRequests` (server-only daemon) at the root; `:104-111` exports
  `VerificationFactor`/`VERIFICATION_FACTORS` (0202 residue).
- `docs/architecture.md` "Public Subpaths": root exports are for the common
  setup path; the concrete Cashu HTLC client surface is
  `@anchr/sdk/adapters/cashu`.
- Churn: 20/300 commits touch `index.ts` (highest in `packages/`), evidence
  that the wide barrel couples the root to internal edits.
- Coordinate with 0224: the adapter symbol homes and single re-export paths
  should be settled by 0224's convention; this issue owns the root surface
  composition only.

## Acceptance

- The root barrel exports only: the Customer/Provider/Oracle setup path
  (factories, option/result types, role errors), schema-bundle registration
  (`registerSchemaBundle` and its types), and the shared value objects — with
  a recorded classification for anything else that stays.
- Protocol event builders/parsers are importable only via
  `@anchr/protocol`/`@anchr/protocol/events`; the Cashu client only via
  `@anchr/sdk/adapters/cashu`; daemon/server helpers only via their adapter
  subpaths.
- Examples, e2e, and docs import moved symbols from their subpath owners.

## Verification

- `deno task publish:dry-run`, `deno task lint:strict`, and
  `deno task test:all` pass.
- `rg "buildQueryRequestEvent|createCashuClient|serveHashRequests" packages/sdk/src/index.ts`
  returns no matches.
- Export count of `index.ts` is reduced to the classified setup-path set
  (target ≈ 30; the exact list is recorded in the resolution note).

## Plan

- Classify all 102 exports (setup path / subpath-owned / dead).
- Move or drop non-setup exports; update examples, e2e, and README imports.
- Re-run the publish dry run and lint chain.
