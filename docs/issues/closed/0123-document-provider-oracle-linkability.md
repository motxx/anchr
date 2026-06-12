# Document Provider/Oracle cross-request linkability

Created: 2026-06-11
Model: Claude Fable 5
Completed: 2026-06-13

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

INV-07 guarantees Customer unlinkability, but Provider and Oracle identities are
deliberately stable and cross-request-linkable, and this asymmetry is documented
nowhere. A reader of "requests are unlinkable" may wrongly assume the whole
exchange is unlinkable. Record the accepted design limit.

## Rationale

From `docs/production-readiness-audit.md` §2.4 (ANON-01):

- `packages/sdk/src/provider.ts:199-201,226` signs every offer/result/selection
  under one stable key for the Provider's lifecycle;
  `packages/protocol/src/events.ts:160-180` carries `provider_pubkey`.
- The Oracle requires a stable advertised pubkey (kind 5300 `p`-tag, kind 30088
  registry; `packages/sdk/src/adapters/nostr/hash-responder.ts:22-23`).
- `docs/threat-model.md:178-199` (INV-07) is scoped to the Customer only; no
  invariant or prose covers Provider/Oracle linkability.

## Acceptance

- `docs/threat-model.md` states the accepted design limit — either a new
  `INV-09` (Provider/Oracle identities are intentionally stable and
  cross-request-linkable) with a Claim/Attack/Expected/Status and a test, or an
  "Actor linkability" subsection stating INV-07 covers only the Customer.
- If an invariant body is added, `docs/threat-model.lock.json` is updated.

## Verification

- `deno task lint:invariants` (binds any new invariant both directions).
- `deno task test:unit` if a linkability test is added.
- `deno task lint:strict`

## Plan

- Decide invariant vs prose subsection (no code change to the linkability
  property itself — it is accepted design).
- If invariant: add the entry, a test asserting two Provider serves reuse one
  pubkey while the Customer rotates, and the lock-file entry.

## Resolution

Decision: prose subsection (the property is an accepted design limit, not a
defended invariant).

Implemented by updating:

- `docs/threat-model.md` — new "Actor linkability" section: INV-07 covers
  the Customer only; Provider and Oracle identities are intentionally stable
  and cross-request-linkable (why, what an observer learns, and the
  key-rotation trade-off)

Verified with:

- `deno task lint:invariants`
- `deno task lint:strict`

Harness update:

- None — accepted design limit now recorded in the threat model; no
  enforceable behavior changed (a human universal decision documented at its
  owning doc).

Review residuals:

- None

Follow-up:

- None
