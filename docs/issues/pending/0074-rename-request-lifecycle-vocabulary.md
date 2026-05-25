# Rename request lifecycle vocabulary

Created: 2026-05-25
Model: GPT-5 Codex

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- 0067

## Summary

Replace old requester/worker actor vocabulary inside the SDK request lifecycle
domain and application services with Customer/Provider vocabulary. This child
owns lifecycle method names, state names, ports, domain type names, and focused
request lifecycle tests.

## Rationale

Parent issue #0067 found active request lifecycle matches in
`packages/sdk/src/requests/domain/types.ts`,
`packages/sdk/src/requests/domain/query-aggregate.ts`,
`packages/sdk/src/requests/domain/query-transitions.ts`,
`packages/sdk/src/requests/domain/query-repository.ts`,
`packages/sdk/src/requests/application/query-service.ts`,
`packages/sdk/src/requests/application/escrow-flow-methods.ts`,
`packages/sdk/src/requests/application/ports.ts`, and adjacent tests.

These names are SDK-owned lifecycle concepts rather than archived history.
However, some fields may currently be persisted or mirrored by Nostr payloads,
so the resolver must identify whether a direct pre-1.0 rename is sufficient or
whether #0075 must first change wire payload names.

## Acceptance

- Request lifecycle public and internal method names use Provider/Customer
  terms instead of `selectWorker`, `bindWorker`, `workerPubkey`, or
  `RequesterMeta`.
- SDK lifecycle statuses use Provider/Customer terminology instead of
  `worker_selected`.
- Request lifecycle domain fields use Provider/Customer terminology instead of
  `requester_pubkey`, `worker_pubkey`, `requester_meta`, and
  `requester_only`, unless a field is explicitly deferred to #0075 as a wire
  compatibility migration.
- Focused request lifecycle tests are updated to assert the new names.
- No compatibility aliases are left for old SDK names.

## Verification

- No matches are expected outside explicitly deferred wire payload work:
  `rg -n "RequesterMeta|RequesterType|requester_meta|requester_type|requester_id|requester_only|selectWorker|doSelectWorker|bindWorker|worker_selected|workerPubkey|worker_pubkey|Worker pubkey|selected worker" packages/sdk/src/requests`
- `deno task test:unit`
- `deno task lint:strict`

## Plan

- Re-read request domain/application imports and classify each old spelling as
  internal lifecycle state, public SDK API, port method, persisted field, or
  Nostr wire mirror.
- Rename the SDK-owned lifecycle names directly.
- If a field cannot be safely renamed until #0075 changes the wire payload,
  update this issue or create a narrower dependency before implementation.
