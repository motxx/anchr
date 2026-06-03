# Enforce SDK feature ownership

Created: 2026-05-30
Model: GPT-5 Codex
Completed: 2026-06-03

## Priority

design

## Dependencies

Depends on:
- 0086

Blocks:
- 0080
- 0085

## Summary

Define and enforce the intended ownership boundaries inside `@anchr/sdk`.
The package-level graph is intentionally small, but the current SDK folder
split is not mechanically enforced, and several feature folders import
request-lifecycle domain or application types directly.

There are no external users to preserve compatibility for. Do not keep
compatibility barrels, aliases, or shim exports for obsolete internal owners;
move callers directly to the current owner and delete the replaced path.

## Rationale

The UNIX design review found that `@anchr/sdk` is cohesive at the public-package
level but weakly enforced internally. Examples to re-check include:

- `packages/sdk/src/attachments/*` importing `../requests/domain/types.ts`
  for attachment and result shapes.
- `packages/sdk/src/adapters/nostr/*` importing request lifecycle types and
  exposing role workflow helpers from `@anchr/sdk/adapters/nostr`.
- `packages/sdk/src/payments/*` importing `EscrowProvider` from
  `requests/application/ports.ts`.
- `packages/sdk/src/proofs/verification/verifier.ts` importing request-domain
  verification types.
- `packages/sdk/src/customer.ts` and `packages/sdk/src/provider.ts` carrying
  large role lifecycle orchestration in single modules.

Some of these imports may be valid because the shape is request-scoped. Others
may show that `requests/domain/types.ts` is acting as a generic shared type
barrel or that Nostr adapters have become second owners for Customer/Provider
workflow.

This repository is pre-user and pre-1.0. Resolver decisions should optimize for
the clean target shape, not backward-compatible import paths. Preserve protocol
correctness, fund-flow safety, security invariants, and spec semantics; do not
preserve stale SDK/internal API compatibility.

## Acceptance

- The intended `@anchr/sdk` feature-folder ownership rules are documented in
  `docs/architecture.md` or an equivalent architecture-owned document.
- Every cross-feature import from or into `requests/` is either moved to the
  owning feature directory or explicitly justified as request-scoped lifecycle
  state or a lifecycle-consumed port.
- `@anchr/sdk/adapters/nostr` no longer exposes role workflow as a second owner,
  or the architecture document explicitly records why those exports are adapter
  responsibilities.
- Obsolete SDK/internal exports, barrels, aliases, and import paths are deleted
  directly instead of retained as compatibility shims.
- If the final rules can be checked syntactically, `scripts/arch-lint.ts` and
  its tests enforce them; otherwise `skills/arch-lint-llm/SKILL.md` captures
  the semantic rule.
- Broad implementation work is split into child issues before code changes if
  one coherent verified change is too large.

## Verification

- `deno task lint:arch`
- `deno task test:scripts`
- `deno task test:unit`
- Manual check: every remaining cross-feature `requests/` import has a current
  owner rationale in the architecture docs or the semantic architecture skill.

## Plan

- Re-read `docs/architecture.md` SDK Request Internals and inspect current
  imports among `requests/`, `attachments/`, `payments/`, `proofs/`, and
  `adapters/nostr/`.
- Decide the smallest ownership rule that catches real drift without blocking
  legitimate lifecycle ports.
- Move current callers to the chosen owner and delete replaced paths rather
  than introducing compatibility aliases.
- Add deterministic lint coverage when the rule is syntactic; otherwise update
  the semantic architecture review skill and create child issues for concrete
  moves.

## Resolution

Implemented by updating:

- `docs/architecture.md`
- `scripts/arch-lint.ts`
- `scripts/arch-lint.test.ts`

Verified with:

- `deno task lint:arch`
- `deno task test:scripts`
- `deno task check`
- `deno task test:all`
- `deno task test:all:docker`

Harness update:

- `scripts/arch-lint.ts` now enforces E026 for SDK request-internal ownership
  exceptions, with `scripts/arch-lint.test.ts` covering allowed lifecycle
  imports and rejected arbitrary cross-feature imports.

Review residuals:

- None

Follow-up:

- None
