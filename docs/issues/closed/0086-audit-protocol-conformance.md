# Audit protocol conformance

Created: 2026-05-27
Model: GPT-5 Codex
Completed: 2026-05-30

## Priority

investigation

## Dependencies

Depends on:
- None

Blocks:
- 0080
- 0087

## Summary

Audit the large post-collapse implementation against the protocol specs before
public-release cleanup starts. The goal is to confirm that SDK, protocol
helpers, Nostr adapters, payment settlement, proof verification, Oracle
registry, and lifecycle state still implement the documented protocol rather
than merely passing implementation-shaped tests.

## Rationale

The repository recently changed package boundaries, actor vocabulary, request
lifecycle internals, payment ownership, and public SDK surfaces. Before pruning
files or presenting the project externally, maintainers need a spec-to-code map
and a gap list for:

- `specs/protocol-contract.md`
- `specs/messaging.md`
- `specs/oracle-registry.md`
- `specs/proof-schemas.md`
- `specs/conditional-swap.md`
- `packages/protocol/src/`
- `packages/sdk/src/{customer.ts,provider.ts,oracle.ts}`
- `packages/sdk/src/adapters/nostr/`
- `packages/sdk/src/payments/`
- protocol and regtest e2e coverage

This issue is primarily an audit and mapping issue. If fixes are small and
coherent, the resolver may apply them. If the audit finds broad or independent
drift, create narrower follow-up issues and stop.

## Acceptance

- Each active protocol spec has a documented implementation and test mapping.
- Wire event kinds, tags, payload fields, and parsing behavior match the
  relevant spec or have explicit follow-up issues.
- Customer, Provider, Oracle lifecycle states and settlement/release semantics
  match `specs/protocol-contract.md` and `specs/conditional-swap.md`.
- Oracle registry and proof schema dispatch behavior match their specs or have
  explicit follow-up issues.
- No undocumented protocol drift is left as an implicit cleanup concern.

## Verification

- `deno task test:e2e:protocol`
- `deno task test:unit`
- Manual check: spec-to-code mapping names every active protocol spec and its
  implementation/test owner.

## Plan

- Read the active specs and map each normative behavior to package or e2e
  coverage.
- Compare protocol helpers and SDK adapters against that map.
- Fix only narrow, obvious drift; otherwise create focused follow-up issues.

## Resolution

Implemented by updating:

- `docs/protocol-conformance-audit.md`
- `specs/protocol-contract.md`
- `specs/README.md`
- `docs/issues/pending/0092-reconcile-nostr-messaging-wire-drift.md`
- `docs/issues/pending/0093-reconcile-conditional-swap-spec-ownership.md`
- `docs/issues/pending/0080-prepare-public-release-cleanup.md`
- `docs/issues/pending/0087-dogfood-sdk-public-api.md`
- `docs/issues/SEQUENCE`

Verified with:

- `deno task test:e2e:protocol`
- `deno task test:unit`
- Manual check: `docs/protocol-conformance-audit.md` maps every active
  protocol spec to implementation/test owners and tracks drift in #0092/#0093.

Harness update:

- `docs/protocol-conformance-audit.md` records the spec-to-code/test mapping
  and turns found drift into tracked issues #0092 and #0093.

Review residuals:

- Maintainer must resolve #0092 before #0087 can close.
- Maintainer must resolve #0092 and #0093, or explicitly decide they are not
  public-release blocking, before #0080 can close.

Follow-up:

- #0092
- #0093
