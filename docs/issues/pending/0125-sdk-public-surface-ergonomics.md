# SDK public-surface ergonomics and docs cleanup

Created: 2026-06-11
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Tracking issue for the medium/low SDK public-surface findings from the
production-readiness audit: missing testing fakes, stale subpath docs, missing
teardown, the type-bar enforcement gap, the `visibility` API gap, and an
implicit Nostr-adapter export surface. The request-type leak (SDK-01) is owned
separately by 0122 and is out of scope here.

## Rationale

From `docs/production-readiness-audit.md` §2.2:

- **SDK-02** — no public `CashuClient` fake in `@anchr/sdk/testing`; the example
  and README hand-roll one (`packages/sdk/src/testing/mod.ts:1-25`,
  `examples/paid-request-simulation/mod.ts:26-67`).
- **SDK-03** — `docs/architecture.md:55-63` lists `@anchr/protocol/schemas` and
  `/validators` that do not exist; the package exports `/schema` (singular)
  (`packages/protocol/deno.json:4-10`).
- **SDK-04** — `Customer` has no `close()`/`dispose()`; the README's Customer
  snippet never closes the relay pool (`packages/sdk/src/customer.ts:62-72`,
  `packages/sdk/README.md:58-77`).
- **SDK-05** — `as` casts on the public Cashu adapter contradict the stated type
  bar, which `lint:types` only warns on (`packages/sdk/src/adapters/cashu.ts:193,262,285,311,345,417`).
- **SDK-06** — the threat-model `visibility` mitigation is absent from the public
  `RequestOptions`/`Spec` (`packages/sdk/src/customer-types.ts:69-79`).
- **SDK-07** — `packages/sdk/src/adapters/nostr/mod.ts:1-16` uses
  `export *` and creates a second Oracle-service owner alongside
  `@anchr/sdk/adapters/oracle-service`.

## Acceptance

- A public `createInMemoryCashuClient()` exists in `@anchr/sdk/testing`; the
  example/README use it instead of inline fakes.
- `docs/architecture.md` §Public Subpaths matches `packages/protocol/deno.json`.
- Customer relay lifecycle is either caller-closed (documented + shown in the
  README) or `Customer.close()` exists, consistent with `Provider.stop()`.
- The `as`-vs-type-bar gap is reconciled (lint tightened or prose amended).
- `visibility` is either on the public request API or the threat-model section
  is scoped to the internal QueryService.
- `adapters/nostr/mod.ts` uses an explicit export list and a single documented
  Oracle-service owner.

## Verification

- `deno task test:examples`, `deno task test:unit`, `deno task lint:arch`,
  `deno task lint:strict`.
- `deno check` importing each documented `@anchr/protocol` subpath resolves.

## Plan

- Re-read each surface; split with `make-sub-issues` if any single item grows
  beyond one coherent change.
- Apply the smaller items (SDK-03 doc fix, SDK-07 export list) directly; treat
  SDK-06 `visibility` as a design decision needing a recorded outcome.

## Progress

- 2026-06-11: **SDK-03 resolved** in the protocol/sdk role-separation pass.
  `docs/architecture.md` §Public Subpaths now lists `@anchr/protocol/schema`
  (singular) and drops the non-existent `/schemas`/`/validators` entries
  (wire validation is owned by the `/events` parsers). Remaining findings
  SDK-02, SDK-04, SDK-05, SDK-06, SDK-07 stay open under this issue.
