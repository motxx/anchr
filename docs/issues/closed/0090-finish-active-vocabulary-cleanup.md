# Finish active vocabulary cleanup

Created: 2026-05-30
Model: GPT-5 Codex
Completed: 2026-06-10

## Priority

design

## Dependencies

Depends on:
- 0086
- 0097

Blocks:
- 0080
- 0085

## Summary

Finish the active-surface vocabulary cleanup for terms that
`docs/architecture.md` says are not core Anchr vocabulary, especially `bounty`
and `marketplace`.

There are no external users to preserve compatibility for. Prefer direct
rename or deletion of obsolete SDK/API/import-path vocabulary over
compatibility shims or legacy aliases.

## Rationale

The current architecture document says public protocol, docs, SDKs, and
examples should use Customer, Provider, and Oracle vocabulary, and that
application vocabulary such as `market`, `marketplace`, and `bounty` is not the
default repository theme or public package surface.

The design review found active matches in package code and protocol helpers,
including:

- `packages/protocol/src/events.ts` uses `bounty_token`.
- `packages/sdk/src/requests/domain/types.ts` exposes `BountyInfo` and
  `Query.bounty`.
- `packages/sdk/src/adapters/nostr/events/events.ts` still references a
  marketplace listing.
- Oracle registry and payment code still use `min_bounty_sats`,
  `max_bounty_sats`, or bounty comments.

Issue #0095 deleted the obsolete `Anchr` HTTP client surface. Treat any
remaining vocabulary cleanup as separate from that removed hosted-client path.

Commit `151f068` fixed Anchr v0 to the Nostr/Cashu substrate and replaced the
old protocol contract with `specs/paid-request-exchange.md`. The `bounty_token`
wire field is part of the current public request payload, so its final rename or
removal should happen with #0097's public request advertisement redesign rather
than as an isolated vocabulary edit.

Some wire fields may need a versioned migration or explicit spec rationale.
The issue is not to preserve old names for hypothetical users. It is to make
every active use current Anchr vocabulary unless changing it would alter
protocol correctness, fund-flow safety, a security invariant, or an explicitly
documented spec semantic. If a wire field is wrong for the target contract,
update the spec and tests with the implementation instead of keeping a
compatibility alias.

## Acceptance

- Active package code, README/package docs, and specs no longer use
  `bounty`, `market`, or `marketplace` as default Anchr vocabulary.
- Obsolete active SDK/API/import-path vocabulary is directly renamed or deleted;
  no compatibility shim, alias, duplicate field, or legacy facade is introduced.
- Any remaining non-target term is explicitly documented in `specs/` or
  `docs/architecture.md` as a protocol semantic that cannot be renamed in this
  change without weakening correctness or safety.
- `scripts/arch-lint.ts` detects active package vocabulary drift for the terms
  maintainers decide should be banned mechanically.
- Tests or protocol mappings are updated for any renamed wire or SDK fields.
- Broad protocol or SDK API migration work is split into child issues before
  implementation if it cannot close safely in one verified change.

## Verification

- No unowned active matches are expected: `rg -n "\b(bounty|Bounty|market|Market|marketplace|Marketplace)\b" README.md CLAUDE.md docs/architecture.md docs/review-harness.md specs packages examples e2e`
- `deno task lint:arch`
- `deno task test:e2e:protocol`
- `deno task test:unit`

## Plan

- Use #0086's protocol conformance map to classify each remaining term as
  active public API, protocol semantic, implementation detail, or historical
  text.
- Use #0097's final public request advertisement shape before deciding the
  replacement for `bounty_token` or other relay-visible payment field names.
- Rename active implementation and docs vocabulary where the owner is clear.
- Delete obsolete aliases and duplicate fields instead of keeping compatibility
  shims.
- Record any remaining protocol-semantic exceptions in the owning spec or
  architecture document and make lint enforce the chosen active-surface rule.

## Resolution

Implemented by updating:

- Renamed `BountyInfo` → `PaymentLockInfo` and the `Query.bounty` field →
  `Query.payment_lock` across `packages/sdk/src/requests/`, payments, adapters,
  testing helpers, and all dependent tests (CONTEXT.md "Payment Lock" term).
- Renamed announcement wire fields `min_bounty_sats`/`max_bounty_sats` →
  `min_amount_sats`/`max_amount_sats` in `packages/sdk/src/requests/domain/oracle-types.ts`,
  the announcement builder/parser, and `specs/oracle-registry.md` (spec updated
  with the implementation; pre-1.0, no compatibility alias).
- `packages/protocol/src/events.ts` public-advertisement parser now rejects
  both the historical `bounty_token`-era field name and the renamed
  `payment_lock`/`payment_lock_token` fields as payment-bearing material.
- Deleted `ANCHR_MARKETPLACE_LISTING` (unused) with #0102.
- Renamed `e2e/protocol/bounty-{trustless,attacks,vulns}.test.ts` →
  `paid-request-*.test.ts` and `bounty-quorum.test.ts` → `oracle-quorum.test.ts`.
- Remaining matches are only the two lint-rule descriptions in `CLAUDE.md` and
  `docs/architecture.md`, which own the ban.

Verified with:

- `rg -n "\b(bounty|Bounty|market|Market|marketplace|Marketplace)\b" README.md CLAUDE.md docs/architecture.md docs/review-harness.md specs packages/protocol/src packages/sdk/src examples e2e` → only the two rule-owning doc lines
- `deno task lint:arch`, `deno task check`
- `deno task test:unit`, `deno task test:e2e:protocol`, `deno task test:all`

Harness update:

- `scripts/arch-lint.ts` `[E022]` vocabulary regex extended with
  `bounty|bounties|Bounty|Bounties|BOUNTY` and uppercase `MARKET|MARKETPLACE`,
  so package-code drift fails mechanically.

Review residuals:

- None

Follow-up:

- None
