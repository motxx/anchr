# Audit Blossom attachment adapter boundary

Created: 2026-05-24
Model: GPT-5 Codex

## Priority

maintenance

## Dependencies

Depends on:
- 0048

Blocks:
- None

## Summary

After #0048 aligns repository documentation, lint, and package metadata with
the minimal SDK/protocol surface, audit the SDK's Blossom attachment boundary.
Only move code if the final architecture still requires a narrower split
between generic attachment helpers and concrete Blossom storage behavior.
If #0048 already makes the docs, exports, and implementation agree, close this
issue as resolved by #0048 without moving Blossom code.

## Rationale

This issue was originally created as a local implementation cleanup based on a
single reading of `docs/architecture.md`: `@anchr/sdk/attachments` owns
encrypted attachment references and transport helpers, while
`@anchr/sdk/adapters` owns standard Nostr, Cashu, Blossom, Oracle HTTP, local
state, and signer adapters. The current SDK exports Blossom-specific server
configuration, upload authorization, upload, download, encryption, and retry
behavior from `packages/sdk/src/attachments/blossom.ts`.

That local cleanup should not block the broader repository-surface cleanup in
#0048. #0048 owns the authoritative pass that removes stale package/app/tooling
guidance and makes docs, lint, and exports agree on the final SDK/protocol
shape. This issue should run only after that context is settled, and it should
preserve the existing placement if #0048 records Blossom-under-attachments as
the intentional public shape. In that case, this issue is a post-#0048
confirmation task, not a mandatory implementation task.

Relevant files:

- `docs/architecture.md`
- `packages/sdk/src/attachments/`
- `packages/sdk/src/adapters/`
- `packages/sdk/deno.json`

## Acceptance

- #0048 has landed or this issue is explicitly replaced by a narrower follow-up
  created during #0048.
- If #0048 already resolves the boundary by making docs, exports, and placement
  agree, this issue is closed as resolved by #0048 with no code movement.
- `docs/architecture.md`, SDK public exports, and implementation placement agree
  about whether Blossom is reached through `@anchr/sdk/attachments`,
  `@anchr/sdk/adapters`, or an explicitly documented combination of the two.
- If Blossom remains under `packages/sdk/src/attachments/`, the architecture
  docs explain why encrypted Blossom transport is part of the attachment
  helper surface rather than a replaceable adapter owner.
- If Blossom moves under `packages/sdk/src/adapters/`, Blossom-specific storage,
  auth-event, upload, download, config, retry, and manifest behavior move
  together and existing attachment upload/fetch behavior remains covered by SDK
  tests.

## Verification

- The selected target shape is documented in `docs/architecture.md` and matches
  SDK public exports.
- If Blossom is moved out of attachments, no Blossom-specific implementation
  file is expected directly under `packages/sdk/src/attachments/`:
  `find packages/sdk/src/attachments -maxdepth 1 -iname '*blossom*' -print`
- `deno task test:unit`
- `deno task lint:strict`

## Plan

- Wait for #0048 or re-read its final diff before editing implementation code.
- First check whether #0048 already made this issue obsolete; if yes, close this
  issue without implementation changes.
- Re-read the current attachment and adapter exports, because #0048 and #0063
  may change public helper symbols first.
- Decide whether the remaining mismatch is documentation-only, export-only, or
  implementation placement.
- Prefer the smallest coherent change: document the intentional boundary if the
  code is already correct, or move Blossom-specific behavior only if the final
  architecture requires an adapter owner.
