# Add missing load-bearing domain terms to CONTEXT.md

Created: 2026-07-02
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

CONTEXT.md is the authoritative domain glossary, but core, widely-used terms
have no entry even though whole spec sections and packages are built around
them. Missing entries for load-bearing concepts weaken the one-vocabulary
guarantee.

## Rationale

- No glossary entry for FROST / threshold / quorum
  (`specs/paid-request-exchange.md` ~120-158, `packages/sdk/src/payments/frost/`),
  Hash Commitment / Hash Bootstrap / Preimage (`specs/messaging.md` ~299-326),
  or Attachment / Blossom (`packages/sdk/src/attachments/`).

## Acceptance

- CONTEXT.md has entries (with `_Avoid_` lists where relevant) for FROST
  threshold group, Quorum, Hash Commitment/Bootstrap, Preimage, and
  Attachment/Blossom.

## Verification

- Each term resolves to a CONTEXT.md entry; terminology matches the specs.

## Plan

- Draft the entries using the specs' current wording.
