# Remove public query helper names

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

Remove query-shaped names from public SDK helper and adapter subpaths outside
the root client and Nostr adapter, especially attachments, proof verification,
and oracle helper surfaces.

## Rationale

#0054 can close only after the SDK's retained public surfaces no longer teach
`query` or `bounty` as SDK concepts. After the bounty package was deleted, some
public helper subpaths still expose names from the old lifecycle:

- `@anchr/sdk/attachments` exports helpers such as `normalizeQueryResult` and
  `materializeQueryResult`.
- `@anchr/sdk/proofs` and oracle adapters consume or expose `QueryResult` and
  `Query` types from `packages/sdk/src/requests/domain/types.ts`.
- E2E tests import the internal request lifecycle directly while package
  collapse is still transitional.

This issue owns the public helper vocabulary only. Purely internal
`packages/sdk/src/requests/**` names may remain until a later internal
refactor unless they leak through an exported SDK subpath.

## Acceptance

- Public SDK subpaths other than `@anchr/sdk` root and
  `@anchr/sdk/adapters/nostr` no longer export function, class, or type names
  containing `Query`, `query`, `Bounty`, `bounty`, or claim-gate vocabulary.
- Retained helper names use request/result/proof/attachment/oracle vocabulary.
- Tests and e2e callers no longer import internal SDK request lifecycle files
  solely to reach publicly useful helper types.
- Internal wire or transitional lifecycle names are documented as non-public if
  they remain.

## Verification

- No matches are expected:
  `rg -n "Query|query|Bounty|bounty|claim[-_]?gate|ClaimGate" packages/sdk/src/attachments/mod.ts packages/sdk/src/proofs/mod.ts packages/sdk/src/adapters/oracle-client/index.ts packages/sdk/src/adapters/oracle-service/index.ts packages/sdk/src/adapters/mod.ts packages/sdk/deno.json`
- No matches are expected:
  `rg -n "packages/sdk/src/requests" e2e`
- `deno task test:unit`
- `deno task test:e2e:protocol`

## Plan

- Audit exported barrels for attachments, proofs, oracle-client,
  oracle-service, payments, and adapters.
- Rename public helper symbols to request/result/proof/attachment/oracle
  vocabulary and update callers.
- Keep any remaining lifecycle internals out of package exports and e2e imports,
  or create a narrower follow-up if the internal migration is too large.

## Resolution

Implemented by updating:

- `packages/sdk/src/attachments/access.ts`
- `packages/sdk/src/proofs/ai-content-check.ts`
- `packages/sdk/src/proofs/integrity-store.ts`
- `packages/sdk/src/proofs/verification/verifier.ts`
- `packages/sdk/src/adapters/oracle-service/nostr-service.ts`
- `packages/sdk/src/adapters/mod.ts`
- `packages/sdk/src/adapters/oracle-client/index.ts`
- `packages/sdk/src/index.ts`
- `e2e/`

Verified with:

- `rg -n "Query|query|Bounty|bounty|claim[-_]?gate|ClaimGate" packages/sdk/src/attachments/mod.ts packages/sdk/src/proofs/mod.ts packages/sdk/src/adapters/oracle-client/index.ts packages/sdk/src/adapters/oracle-service/index.ts packages/sdk/src/adapters/mod.ts packages/sdk/deno.json` returned no matches.
- `rg -n "packages/sdk/src/requests" e2e` returned no matches.
- `deno test --allow-all packages/sdk/src/attachments/access.test.ts packages/sdk/src/proofs/integrity-store.test.ts packages/sdk/src/proofs/ai-content-check.test.ts packages/sdk/src/proofs/verification/verifier-standalone.test.ts packages/sdk/src/proofs/verification/verifier.test.ts packages/sdk/src/adapters/oracle-service/nostr-service.test.ts packages/sdk/src/adapters/oracle-service/nostr-frost.test.ts`
- `deno task test:unit`
- `deno task test:e2e:protocol`
- `deno task lint:strict`

Harness update:

- Existing public-surface grep checks in this issue now pass, and focused unit
  plus protocol e2e tests cover the renamed helper exports and e2e import
  routing.

Review residuals:

- None

Follow-up:

- None
