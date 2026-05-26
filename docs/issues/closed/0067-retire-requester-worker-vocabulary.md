# Retire requester worker vocabulary

Created: 2026-05-25
Model: GPT-5 Codex
Completed: 2026-05-27

## Priority

maintenance

## Dependencies

Depends on:
- 0068
- 0073
- 0074
- 0075
- 0076
- 0077
- 0078

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

- No actor-vocabulary matches are expected in active surfaces. A residual
  lowercase `worker` sweep may return only platform/API terms: browser service
  workers in `scripts/launch-chrome-tlsn.ts`, runtime target strings in
  `packages/sdk/src/internal/runtime/`, adapter runtime capability strings in
  `packages/sdk/src/adapters/{storage.ts,storage.test.ts,types.ts}`, and the
  Cloudflare Workers timing-attack documentation link in
  `packages/sdk/src/adapters/oracle-service/auth.ts`.
  `rg -n "requester|Requester|worker|Worker" README.md CLAUDE.md AGENTS.md docs packages examples e2e deno.json scripts --glob '!docs/issues/**' --glob '!docs/archive/**'`
- No matching actor filenames are expected in active surfaces:
  `rg --files README.md docs packages examples e2e scripts | rg -v '^docs/issues/' | rg 'requester|Requester|worker|Worker'`
- `deno task test:unit`
- `deno task lint:strict`

## Plan

- Resolve the child issues that split the current active vocabulary matches:
  #0073 SDK attachment upload surface, #0074 request lifecycle state and ports,
  #0075 Nostr event payload vocabulary, #0076 payment and escrow vocabulary,
  #0077 docs and e2e invariant vocabulary, and #0078 final vocabulary sweep.
- Prefer direct pre-1.0 replacements over compatibility aliases in each child.
- Close this parent only after the final sweep confirms no active actor
  vocabulary remains, or documents any non-actor platform term that needs a
  narrower verification rule.

## Resolution

Implemented by updating:

- `docs/issues/closed/0067-retire-requester-worker-vocabulary.md`

Resolved through closed child issues:

- #0068 consolidate SDK testing directory
- #0073 rename provider attachment upload
- #0074 rename request lifecycle vocabulary
- #0075 migrate Nostr payload vocabulary
- #0076 rename payment escrow vocabulary
- #0077 update docs/e2e vocabulary
- #0078 final active vocabulary sweep

Verified with:

- `rg -n "requester|Requester|worker|Worker" README.md CLAUDE.md AGENTS.md docs packages examples e2e deno.json scripts --glob '!docs/issues/**' --glob '!docs/archive/**'`
- `rg --files README.md docs packages examples e2e scripts | rg -v '^docs/issues/' | rg 'requester|Requester|worker|Worker'`
- `deno task check`
- `deno task test:all`

Harness update:

- `docs/issues/closed/0078-final-active-vocabulary-sweep.md` documents the allowed non-actor platform/API residuals for the final parent sweep.

Review residuals:

- None

Follow-up:

- #0070 remains pending and is now dependency-ready.
