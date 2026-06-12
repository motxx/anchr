# Fail closed when the escrow provider port is missing

Created: 2026-06-12
Model: Claude Fable 5 (claude-fable-5)

## Priority

bug

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

In `packages/sdk/src/requests/application/escrow-flow-methods.ts` the CTF-2
escrow lock check and the amount check run only when the optional
`deps.escrowProvider` port happens to be injected. A service wired without it
silently selects the provider and later reveals the preimage with the escrow
token never lock- or amount-verified — the theft the CTF-2 comment in
`query-escrow-validation.ts` says these checks prevent.

## Rationale

- `escrow-flow-methods.ts`: `if (escrowRef && paymentHash &&
  deps.escrowProvider) { ... }` gates the verification on port presence
  instead of failing when the port is required but absent.
- Found by the `check-silent-bypass` full-file review (Pattern A) on
  2026-06-12. Pre-existing behavior.

## Acceptance

- For HTLC escrow queries, provider selection fails with an explicit error
  when no escrow provider is wired, instead of skipping verification.
- A test locks the rejection.

## Verification

- `deno task test:unit` with a test: escrow query + absent `escrowProvider`
  port → selection returns `{ ok: false }` with a configuration error.

## Plan

- Return a loud configuration error from the escrow paths when
  `deps.escrowProvider` is absent for a query that requires escrow
  verification, or add `// allow-bypass: <reason>` if test-only wiring is
  intentional and document it.
