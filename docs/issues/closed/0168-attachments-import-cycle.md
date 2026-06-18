# Break attachments import cycle

Created: 2026-06-19
Completed: 2026-06-19
Model: GPT-5.5 (codex:rescue)

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

`sprawlens analyze .` reports three import cycles in `packages/sdk/src`. The
smallest one — a 2-file strongly-connected component between
`attachments/access.ts` and `attachments/attachment-helpers.ts` — is a classic
"shared type lives in the wrong file" cycle and is independently fixable.

## Rationale

`access.ts` imports the concrete helper functions
(`attachmentRefSource`, `extractBlossomFields`, `inferAttachmentId`,
`normalizeFromRef`, `normalizeFromResolved`, `normalizeFromString`,
`readBlossomAttachment`, `readExternalAttachment`) from
`attachment-helpers.ts`. `attachment-helpers.ts` imports the type
`StoredAttachment` from `access.ts`. The edge that closes the cycle is purely
the type import; extracting `StoredAttachment` (and the two derived shapes
`StoredAttachmentBuffer` / `StoredAttachmentStats`) into a dedicated
`attachments/types.ts` removes it without changing any runtime behaviour.

## Acceptance

- `attachment-helpers.ts` imports no value or type from `access.ts`.
- `StoredAttachment*` types remain re-exported from `access.ts` so existing
  consumers keep the same import path.
- The 3-cycle SCC count reported by `sprawlens analyze .` drops to two cycles.

## Verification

- `deno task lint:strict`
- `deno task test:unit -- attachments`
- `sprawlens collect . && sprawlens analyze .` — cycle count = 2.

## Plan

- Create `packages/sdk/src/attachments/types.ts` with the three interface
  declarations and their shared imports.
- Replace the declarations in `access.ts` with `import type` + `export type`
  so the public surface is unchanged.
- Switch `attachment-helpers.ts` to import the type from `./types.ts`.

## Resolution

Implemented by updating:

- `packages/sdk/src/attachments/types.ts` (new)
- `packages/sdk/src/attachments/access.ts`
- `packages/sdk/src/attachments/attachment-helpers.ts`

Verified with:

- `deno task lint:strict` — pass
- `deno task test:unit -- attachments` — 310 passed (635 steps) | 0 failed

Harness update:

- None — the `lint:arch` rule catalogue already forbids new import cycles in
  `packages/`; this issue removes one of the three pre-existing legacy SCCs and
  the remaining two are tracked separately (`proofs/verification` and
  `requests/application`).

Review residuals:

- None.

Follow-up:

- Break the remaining two cycles in separate issues.
