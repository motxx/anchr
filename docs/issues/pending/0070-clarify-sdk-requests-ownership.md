# Clarify SDK requests ownership

Created: 2026-05-25
Model: GPT-5 Codex

## Priority

design

## Dependencies

Depends on:
- 0067
- 0068
- 0069
- 0072

Blocks:
- None

## Summary

Clarify what `packages/sdk/src/requests/` owns after the SDK directory cleanup.
Today it acts like an internal paid-request lifecycle core, but other SDK areas
also import it as a shared domain model for attachments, payments, proof
verification, Oracle adapters, Nostr adapters, and testing. That makes the
directory read like one feature while it actually owns cross-cutting SDK
concepts.

The resolver should re-read the post-cleanup repository state and decide
whether to keep `requests/` as an explicitly internal lifecycle core, split
shared concepts back to their owning feature directories, or create child
issues for a staged migration.

## Rationale

Current examples of cross-directory ownership pressure include:

- `packages/sdk/src/attachments/*` importing `AttachmentRef` and related types
  from `packages/sdk/src/requests/domain/types.ts`.
- `packages/sdk/src/payments/*` importing `EscrowProvider` from
  `packages/sdk/src/requests/application/ports.ts`.
- `packages/sdk/src/proofs/*` importing verification input/result shapes from
  `packages/sdk/src/requests/domain/types.ts`.
- `packages/sdk/src/adapters/*` importing `Query`, `QueryResult`,
  `OracleAttestation`, or `OracleRegistry` from `requests/`.
- `packages/sdk/src/testing/mod.ts` exposing request lifecycle service helpers
  through `@anchr/sdk/testing`.

Under the single-purpose design rule, each shared concept should have one owner
that can be stated in a sentence. If `requests/` remains, its role should be
obvious from its path and imports. If it is only a leftover lifecycle core, the
shared types and ports should move to the feature owners that use them.

## Acceptance

- The repository has an explicit, documented decision for whether
  `packages/sdk/src/requests/` remains as an internal lifecycle core, moves
  under `packages/sdk/src/internal/`, or is split into feature-owned concepts.
- Shared SDK concepts such as attachment references, escrow ports, verification
  input/result shapes, Oracle registry types, and lifecycle state each have a
  clear owner.
- Public SDK exports continue to expose only the documented public subpaths.
- If the migration is too broad for one coherent verified change, this issue is
  split into child issues before implementation.
- After any concrete movement, imports no longer make unrelated feature
  directories depend on `requests/` merely to get their own concept types.

## Verification

- `rg -n "requests/(domain|application)|from \"\\.\\/requests|from \"\\.\\.\\/requests|@anchr/sdk/requests" packages/sdk/src packages/sdk/deno.json deno.json docs/architecture.md`
- `deno task lint:arch`
- `deno task test:unit`
- `deno task lint:strict`

## Plan

- Wait for #0067, #0068, #0069, and #0072 so stale vocabulary, duplicate helper
  directories, and Cashu/payment ownership do not obscure the real `requests/`
  boundary.
- Re-read `packages/sdk/src/requests/`, the public actor APIs, and all imports
  from `requests/`.
- Classify each exported type, port, store, and service as request-lifecycle
  state, attachment concept, payment concept, proof concept, Oracle concept, or
  adapter/testing support.
- Split into child issues if the correct change spans multiple independent
  owners.
