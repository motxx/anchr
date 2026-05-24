# Rename Nostr adapter query API

Created: 2026-05-24
Model: GPT-5 Codex
Completed: 2026-05-24

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- 0054

## Summary

Rename the public `@anchr/sdk/adapters/nostr` requester, worker, and query
exports to Customer, Provider, and request vocabulary while preserving Nostr
wire compatibility internally.

## Rationale

Parent #0054 requires the bounty/query public SDK surface to disappear. Current
Nostr adapter public exports still include the old app-shaped language:

- `packages/sdk/src/adapters/nostr/mod.ts` exports `discoverQueries`,
  `createHtlcQuery`, `CreateQueryRequest`, `RequesterQueryState`,
  `WorkerQueryState`, and `DiscoveredQuery`.
- `packages/sdk/src/adapters/nostr/requester-service.ts` and
  `packages/sdk/src/adapters/nostr/worker-service.ts` define the public names.
- E2E tests import `@anchr/sdk/adapters/nostr` and exercise these adapter
  surfaces.

NIP-90 kind and payload terminology may remain where it is a protocol wire
contract, but the SDK adapter API should describe Anchr actors and paid
requests.

## Acceptance

- `@anchr/sdk/adapters/nostr` no longer exports public symbols named with
  requester, worker, query, or bounty vocabulary.
- Equivalent retained symbols use Customer, Provider, and request vocabulary.
- E2E and package tests compile against the renamed public adapter API.
- Protocol wire constants, tags, event kind names, and JSON fields remain
  compatible where changing them would break Nostr interoperability.

## Verification

- No matches are expected:
  `rg -n "discoverQueries|createHtlcQuery|CreateQueryRequest|RequesterQueryState|WorkerQueryState|DiscoveredQuery" packages/sdk/src/adapters/nostr/mod.ts packages/sdk/src/adapters/nostr/requester-service.ts packages/sdk/src/adapters/nostr/worker-service.ts e2e packages/sdk/src/*.test.ts`
- No public Nostr adapter exports should retain old actor names:
  `deno eval 'const text = await Deno.readTextFile("packages/sdk/src/adapters/nostr/mod.ts"); const bad = text.split("\n").map((line, i) => [i + 1, line]).filter((entry) => /export .*\\b(Requester|Worker)\\b/.test(entry[1])); if (bad.length) { console.log(bad.map((entry) => entry[0] + ":" + entry[1]).join("\n")); Deno.exit(1); }'`
- `deno task test:unit`
- `deno task test:e2e:protocol`

## Plan

- Rename the requester-service and worker-service public functions/types to
  Customer/Provider/request terms.
- Update the Nostr adapter barrel and all package/e2e callers.
- Leave protocol wire field names unchanged unless a separate protocol issue
  owns the migration.

## Resolution

Implemented by updating:

- `packages/sdk/src/adapters/nostr/mod.ts`
- `packages/sdk/src/adapters/nostr/requester-service.ts`
- `packages/sdk/src/adapters/nostr/worker-service.ts`
- `packages/sdk/src/adapters/nostr/worker-service.test.ts`

Verified with:

- `rg -n "discoverQueries|createHtlcQuery|CreateQueryRequest|RequesterQueryState|WorkerQueryState|DiscoveredQuery" packages/sdk/src/adapters/nostr/mod.ts packages/sdk/src/adapters/nostr/requester-service.ts packages/sdk/src/adapters/nostr/worker-service.ts e2e packages/sdk/src/*.test.ts`
- `deno eval 'const text = await Deno.readTextFile("packages/sdk/src/adapters/nostr/mod.ts"); const bad = text.split("\n").map((line, i) => [i + 1, line]).filter((entry) => /export .*\\b(Requester|Worker)\\b/.test(String(entry[1]))); if (bad.length) { console.log(bad.map((entry) => entry[0] + ":" + entry[1]).join("\n")); Deno.exit(1); }'`
- `deno task test:unit`
- `deno task test:e2e:protocol`
- `deno task lint:strict`

Harness update:

- `packages/sdk/src/adapters/nostr/worker-service.test.ts` now compiles against the Provider/request type names, and the issue-specific symbol checks lock the removed Nostr adapter API names.

Review residuals:

- None

Follow-up:

- None
