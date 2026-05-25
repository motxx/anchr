# Retire requester worker vocabulary

Created: 2026-05-25
Model: GPT-5 Codex

## Priority

maintenance

## Dependencies

Depends on:
- 0068

Blocks:
- None

## Summary

Remove remaining `requester` and `worker` vocabulary from active code, tests,
docs, public names, and filenames, and replace it with `customer` and
`provider` vocabulary. The repository already documents Customer, Provider, and
Oracle as the canonical actor names, but active implementation and test surfaces
still contain old naming.

This is likely broad enough that the resolver should first re-read the current
repository state and split this issue if a single coherent verified change would
touch too many independent API, domain-state, test, and documentation surfaces.

## Rationale

Known examples from the current repository include:

- `packages/sdk/src/attachments/worker-upload.ts`
- `packages/sdk/src/requests/application/query-service.ts`
- `packages/sdk/src/requests/application/escrow-flow-methods.ts`
- `packages/sdk/src/requests/application/ports.ts`
- `packages/sdk/src/adapters/nostr/customer-service.ts`
- `packages/sdk/src/adapters/nostr/oracle-service.ts`
- `packages/sdk/src/adapters/nostr/oracle-handlers.ts`
- `packages/sdk/src/proofs/tlsn-types.ts`
- `e2e/regtest/regtest-htlc-attacks.test.ts`
- `e2e/regtest/regtest-htlc-trustless.test.ts`
- `e2e/protocol/bounty-quorum.test.ts`
- `e2e/frost/frost-threshold.test.ts`
- `scripts/deploy.sh`

Some old spellings may be wire fields, persisted state names, or closed issue
history. The resolver must identify those boundaries explicitly instead of
performing a blind text replacement. If an old wire field still exists, resolve
the naming through a versioned protocol replacement or create a narrower
follow-up before claiming complete removal.

## Acceptance

- Active source, tests, scripts, examples, README, and non-archive docs no
  longer contain `requester`, `Requester`, `worker`, or `Worker` as actor
  vocabulary.
- Active filenames no longer contain `requester`, `Requester`, `worker`, or
  `Worker`.
- Public SDK functions, types, method names, test descriptions, comments, and
  docs use Customer/Provider terminology consistently.
- Internal state, persisted fields, and protocol or Nostr payload names either
  use Customer/Provider terminology or have a documented versioned migration
  plan with a new follow-up issue.
- Historical closed issues and archived documents are not rewritten only to
  satisfy this cleanup.

## Verification

- No matches are expected in active surfaces:
  `rg -n "requester|Requester|worker|Worker" README.md CLAUDE.md AGENTS.md docs packages examples e2e deno.json scripts --glob '!docs/issues/**' --glob '!docs/archive/**'`
- No matching filenames are expected in active surfaces:
  `rg --files README.md docs packages examples e2e scripts | rg 'requester|Requester|worker|Worker'`
- `deno task test:unit`
- `deno task lint:strict`

## Plan

- Re-read the current matches and classify them as public API, internal
  implementation, tests, docs, filenames, wire fields, or historical text.
- Split this issue first if the public API migration, internal state migration,
  filename cleanup, and protocol/wire-field decisions are not closeable in one
  coherent verified change.
- Prefer direct pre-1.0 replacement over compatibility aliases.
- Add or update focused tests where behavior or public exports change.
