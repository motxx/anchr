# Remove transport-neutral protocol framing

Created: 2026-06-03
Model: GPT-5 Codex

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0080
- 0085
- 0091

## Summary

Remove transport-neutral protocol framing from live code, docs, and specs.
Anchr's current protocol contract is Nostr/NIP-90 wire compatibility: event
kinds, tags, payloads, signing, and NIP-44 encryption boundaries are protocol
surface, while relay clients, subscriptions, runtime wiring, and service
orchestration remain SDK-owned Nostr adapter behavior.

The cleanup should make that boundary explicit. Live documentation should state
the current target contract only, following `CLAUDE.md`'s documentation prose
rule.

## Rationale

Current live surfaces still present or imply a transport-neutral protocol shape:

- `specs/protocol-contract.md` is titled "Universal Protocol Contract" and
  describes transport profiles and role-neutral message classes.
- `specs/README.md`, `README.md`, `docs/universality-boundaries.md`, and
  `docs/protocol-conformance-audit.md` still use role-neutral protocol wording
  for the public protocol surface.
- SDK comments in `packages/sdk/src/proofs/verification/verifier.ts` and
  `packages/sdk/src/requests/domain/types.ts` describe verifier inputs as
  transport-neutral even though the repository protocol surface is Nostr.
- `docs/architecture.md` and `specs/messaging.md` are the current ownership
  anchors for the Nostr wire-contract shape, but the resolver must re-read
  current files before deciding the final coherent split.

This is a current-contract cleanup. It should not add migration notes or
non-target design explanations to live docs.

## Acceptance

- Live docs and specs present `@anchr/protocol` as the Nostr/NIP-90 wire
  contract for compatible Anchr implementations.
- `specs/protocol-contract.md` is renamed, rewritten, or narrowed so it no
  longer describes an implied transport-neutral protocol layer.
- `@anchr/protocol/events` and `@anchr/protocol/nostr` ownership is documented
  as protocol-level Nostr wire ownership, not adapter implementation detail.
- SDK Nostr adapter docs and exports are described as relay/runtime/service
  binding, not the canonical wire contract.
- Live comments and docs avoid transport-neutral, role-neutral, universal
  profile, or alternative-transport framing unless the phrase names a current
  code surface with runtime meaning.
- No live doc adds meta-commentary about non-target protocol framing.
- If the resolver finds that code movement is needed, broad work is split into
  child issues before implementation.

## Verification

- No live transport-neutral framing is expected:
  `rg -n "transport-neutral|transport neutral|role-neutral|Universal Protocol|universal lifecycle|Transport profiles|Adapter Profiles|profile-specific|alternative transports|different transport|role-neutral wire|role-neutral protocol" README.md docs specs packages/protocol/src packages/sdk/src -g '*.md' -g '*.ts'`
- Manual check: `docs/issues/closed/` is not rewritten solely to satisfy the
  negative check.
- `deno task lint:strict`

## Plan

- Re-read `docs/architecture.md`, `specs/messaging.md`,
  `specs/protocol-contract.md`, `specs/README.md`,
  `docs/universality-boundaries.md`, `docs/protocol-conformance-audit.md`, and
  the SDK comments found by the verification query.
- Decide whether `specs/protocol-contract.md` remains as a Nostr protocol
  contract, is merged into `specs/messaging.md`, or is split into smaller
  Nostr-owned specs.
- Update live docs and comments to state the current Nostr wire contract
  directly.
- Add or update focused verification only if the cleanup reveals a repeatable
  drift pattern that should be enforced mechanically.
