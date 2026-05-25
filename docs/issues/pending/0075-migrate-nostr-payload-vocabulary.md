# Migrate Nostr payload vocabulary

Created: 2026-05-25
Model: GPT-5 Codex

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0067

## Summary

Decide and implement the Provider/Customer vocabulary for SDK Nostr event
payloads and direct Nostr adapter state. This child owns active wire payload
interfaces, builders, parsers, Oracle handler state, customer/provider service
payload construction, and Nostr event tests.

## Rationale

Parent issue #0067 found active Nostr payload fields such as
`requester_pubkey`, `decrypt_key_requester`, `worker_pubkey`, and
`selected_worker_pubkey` in `packages/sdk/src/adapters/nostr/events/*` and
adapter services. `docs/architecture.md` says older terms may remain only where
a current wire field already uses that spelling, and that versioned protocol
replacements should remove those names instead of retaining aliases.

Because these payloads are event content and tags, the resolver must decide the
pre-1.0 replacement shape instead of doing a blind text replacement.

## Acceptance

- Nostr event payload interfaces, builders, parsers, and tests use
  Customer/Provider field names for actor payload fields.
- If existing Nostr wire compatibility requires a versioned replacement, the
  chosen replacement is documented in the relevant spec or architecture note
  and a follow-up issue is created for any remaining interoperable migration.
- Oracle handler state and Nostr service code use Provider/Customer local names
  even when reading an explicitly documented legacy wire field during a staged
  migration.
- No unversioned compatibility aliases remain for old payload fields unless the
  issue records a concrete follow-up and residual risk.

## Verification

- No matches are expected unless the issue records a versioned migration
  follow-up:
  `rg -n "requester_pubkey|decrypt_key_requester|worker_pubkey|selected_worker_pubkey|requesterPubKey|workerPubKey|selectedWorker|offeredWorkers|Requester|Worker" packages/sdk/src/adapters/nostr`
- `deno task test:unit`
- `deno task lint:strict`

## Plan

- Re-read the Nostr event builders, parsers, event tests, Oracle service,
  customer service, provider service, and any protocol specs they map to.
- Choose the direct pre-1.0 payload replacement or create a narrower versioned
  migration follow-up if interoperability requires staging.
- Update Nostr adapter tests to lock the selected public payload shape.
