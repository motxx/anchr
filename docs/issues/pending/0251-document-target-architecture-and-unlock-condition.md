# Document the target architecture and add Unlock Condition to CONTEXT.md

Created: 2026-07-26
Model: Claude Opus 5

## Priority

maintenance

## Dependencies

Depends on:
- 0250

Blocks:
- None

## Summary

Record the 2026-07-26 architecture decisions as the current target
in `docs/architecture.md`, and close the vocabulary gap that pushed design
discussions into Cashu implementation terms. Two changes:

1. `docs/architecture.md`: state the trust-boundary design — package
   boundaries coincide with trust boundaries; `@anchr/protocol` is the
   shared trust base (message types, build/parse, transition vocabulary);
   roles hold their own state models (Customer/Provider volatile per
   request, Oracle persistent); Payment Lock implementations sit behind
   capabilities for each role: Customer prepares and refunds a lock, Provider
   verifies binding and redeems it, and Oracle produces Release Material.
   v0 remains Cashu-fixed; these capabilities constrain role authority rather
   than promise arbitrary payment-backend substitution. Proof Schema
   verification is pure and deterministic (no ambient time, network, or
   randomness — third parties must be able to re-run verification and reach
   the same conclusion). Per the docs-prose rule, describe only the target
   architecture; no migration narrative or measurement history.
2. `CONTEXT.md`: add **Unlock Condition** — the condition under which a
   Payment Lock can be redeemed; assembled by Anchr, evaluated by the
   settlement backend (mint). _Avoid_: spending condition, witness,
   predicate. Extend the **Release Material** entry with its relation:
   Oracle-produced material that satisfies an Unlock Condition after proof
   verification succeeds. The mapping to Cashu's `Proof.witness` field
   belongs in the Cashu adapter documentation, not the glossary.

## Rationale

- The glossary defines Payment Lock, Release Material, Redeem, and Refund
  but has no term for the lock's condition; design sessions borrowed
  `witness` (NUT-10/11/14 implementation vocabulary) as a result.
  `witness` appears only under `packages/sdk/src/payments/cashu/` (measured
  2026-07-26), so the boundary the term protects already exists in code.
- `predicate` is used in `specs/messaging.md` for the proof-schema
  requirement payload; the Avoid list keeps payment-side and proof-side
  vocabulary distinct.
- `docs/architecture.md` "Public Packages" / "Public Subpaths" sections
  predate the role-package split (0250) and should describe the target
  public API consistently with its accepted capability and TCB matrix.

## Acceptance

- `CONTEXT.md` defines Unlock Condition with the Avoid list and relates
  Release Material to it; repository code and docs use the term where the
  concept appears.
- `docs/architecture.md` describes the trust-boundary package design and the
  Payment Lock and Proof Schema capabilities for each role as the current target,
  with no removed-design meta-commentary.

## Requirement traceability

| Requirement | Verification |
| --- | --- |
| `Unlock Condition` is a single canonical glossary term | A glossary test asserts exactly one `### Unlock Condition` heading and its required definition and Avoid list. |
| `Release Material` is related to `Unlock Condition` without Cashu implementation detail | The same test asserts the Release Material entry names Unlock Condition and rejects `Proof.witness`, HTLC, P2PK, or Mint field names inside either glossary entry. |
| Proof predicate vocabulary remains separate | The existing no-`witness` command below covers universal docs, while the glossary test locks `predicate` into the Unlock Condition Avoid list. |
| Architecture documents the same Role capabilities as 0250 | A docs-consistency test compares the Customer, Provider, Oracle, and Protocol rows with 0250's checked-in capability/TCB fixture data. |
| Architecture documents the enforced dependency direction | A docs-consistency test compares its allowed package-dependency table with `ALLOWED_PACKAGE_DEPS`. |
| v0 remains Cashu-fixed without promising arbitrary backend substitution | A focused assertion checks the architecture text against ADR 0001's v0 decision and rejects a public API for registering arbitrary payment implementations. |
| Documentation contains no migration narrative | `lint:no-history-comments` and the docs-prose review run on the changed files. |

## Verification

- `deno task lint:strict` passes (includes the docs-affecting lints).
- No matches expected in the target files:
  `rg -i "witness" CONTEXT.md docs/architecture.md docs/threat-model.md specs --glob '!specs/messaging.md'`
  (messaging.md may retain it only if describing the Cashu adapter mapping;
  issue files under `docs/issues/` and Cashu adapter docs are out of scope).

## Plan

- Draft both edits in one change; keep CONTEXT.md entries in its established
  format.
