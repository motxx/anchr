# Rename bounty vocabulary in packages and tighten the E022 lint

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

CONTEXT.md and architecture.md list "bounty" as forbidden application
vocabulary and E022's regex includes it, but the `\b…\b` word boundaries never
match inside camelCase (`createBountyToken`) or snake_case (`bounty_token`), so
the lint passes while a public SDK export ships the forbidden term. Rename the
identifiers and fix the matcher so the guardrail actually enforces the rule.

## Rationale

- `packages/sdk/src/payments/cashu/cashu-wallet.ts` (~lines 71, 99
  `CreateBountyTokenOptions`, `createBountyToken`),
  `payments/cashu/mod.ts` (~lines 62, 69),
  `requests/domain/value-objects.ts` (~line 8 `validateBountyInfo`),
  `testing/protocol-helpers.ts` (~lines 211, 217).
- `scripts/arch-lint.ts` (~lines 61-62) E022 regex uses word boundaries.
- The rejection guard `bounty_token` in `protocol/src/events.ts` (~line 141)
  may stay (rejecting a legacy field), ideally with a comment.

## Acceptance

- The identifiers are renamed to the glossary vocabulary
  (e.g. "Payment Lock" / "Provider Redemption Token").
- E022 matches compound identifiers (camelCase / snake_case), not just
  standalone words.

## Verification

- After the rename, E022 with the tightened matcher passes; introducing a new
  `createBountyToken` fails `deno task lint:strict`.

## Plan

- Rename the SDK identifiers; tighten the E022 matcher; keep the legacy-field
  rejection guard.
