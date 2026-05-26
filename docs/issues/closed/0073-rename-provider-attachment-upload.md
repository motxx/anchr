# Rename provider attachment upload

Created: 2026-05-25
Model: GPT-5 Codex
Completed: 2026-05-25

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- 0067

## Summary

Rename the SDK attachment helper currently exposed as `workerUpload` and
`worker-upload.ts` to Provider vocabulary. This child owns the attachment
filename, function, result/options types, local comments, and callers that use
that helper.

## Rationale

Parent issue #0067 found an active filename and helper under
`packages/sdk/src/attachments/worker-upload.ts`. Current direct callers include
`packages/sdk/src/attachments/upload.ts` and
`packages/sdk/src/adapters/nostr/provider-service.ts`. The helper already
performs provider-side proof attachment preparation; the old name is not a
wire field.

## Acceptance

- `packages/sdk/src/attachments/worker-upload.ts` is replaced by a
  Provider-named file.
- `workerUpload`, `WorkerUploadOptions`, and `WorkerUploadResult` are replaced
  by Provider-named symbols without compatibility aliases.
- SDK attachment callers import and call the Provider-named helper.
- No active filename under `packages/sdk/src/attachments/` contains
  `worker` or `Worker`.

## Verification

- No matches are expected:
  `rg -n "workerUpload|WorkerUpload|worker-upload|Worker-side|worker's device" packages/sdk/src/attachments packages/sdk/src/adapters/nostr/provider-service.ts`
- No matching filenames are expected:
  `rg --files packages/sdk/src/attachments | rg 'worker|Worker'`
- `deno task test:unit`
- `deno task lint:strict`

## Plan

- Rename the attachment helper file and exported symbols to Provider
  terminology.
- Update imports and inferred return types at direct callers.
- Run the focused vocabulary checks before the broader unit and lint checks.

## Resolution

Implemented by updating:

- `packages/sdk/src/attachments/provider-upload.ts`
- `packages/sdk/src/attachments/upload.ts`
- `packages/sdk/src/attachments/mod.ts`
- `packages/sdk/src/adapters/nostr/provider-service.ts`

Verified with:

- `rg -n "workerUpload|WorkerUpload|worker-upload|Worker-side|worker's device" packages/sdk/src/attachments packages/sdk/src/adapters/nostr/provider-service.ts`
- `rg --files packages/sdk/src/attachments | rg 'worker|Worker'`
- `deno task check`
- `deno task test:all`

Harness update:

- None - this was a one-time SDK vocabulary rename verified by focused negative grep checks plus the existing type, lint, and test suite.

Review residuals:

- None

Follow-up:

- None
