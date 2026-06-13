# Strip platform-specific media tooling from the attachment surface

Created: 2026-06-12
Completed: 2026-06-13
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0143

## Summary

The attachment surface bundles platform-specific media processing that does
not belong in a portable SDK: image preview generation by spawning
`sips`/`magick`/`convert` with `process.platform` checks
(`packages/sdk/src/attachments/access.ts:77-116`), and EXIF stripping via
external tooling and `node:fs` (`attachments/exif-strip-helpers.ts`).
Decide the owner for each and remove the subprocess/platform code from
`packages/`. The attachment core keeps what is load-bearing: encryption,
upload/download, key material, URL validation, and `AttachmentRef`.

## Rationale

- **Simplicity**: preview generation is presentation, not part of the
  verifiable-paid-request contract; it exists for one consumer pattern and
  drags `internal/runtime` process tooling with it.
- **Portability**: `process.platform` checks and `sips`/`magick` spawns can
  never run in a browser; deleting them shrinks 0149's port surface.
- **Privacy caution**: EXIF stripping is privacy-load-bearing (it removes
  location/device metadata before upload). Do not silently drop the
  capability — either reimplement it portably (pure-TS/WASM re-encode), move
  it to the producing schema's adapter, or document explicitly that callers
  must strip metadata before `upload()` and lock that contract with a test
  or threat-model note.

## Acceptance

- No subprocess invocation or `process.platform` check remains under
  `packages/sdk/src/attachments/`.
- The EXIF decision is recorded (portable implementation, schema-adapter
  ownership, or documented caller contract with a guard) and covered by a
  test or threat-model entry.
- Preview generation is deleted or relocated outside `packages/`
  (example/app territory).

## Verification

- No matches are expected:
  `rg "sips|magick|convert|process\.platform|exiftool" packages/sdk/src/attachments/`
- `deno task test:all` passes.

## Plan

- Inventory current callers of preview generation and EXIF stripping
  (examples, e2e, oracle paths).
- Make the EXIF ownership decision first (privacy-relevant), then delete or
  relocate preview generation.
- Re-check `internal/runtime/` afterwards: remove process helpers that lost
  their last caller.

## Resolution

Implemented by updating:

- `docs/architecture.md`
- `packages/sdk/src/attachments/access.ts`
- `packages/sdk/src/attachments/blossom.ts`
- `packages/sdk/src/attachments/provider-upload.ts`
- `packages/sdk/src/attachments/provider-upload.test.ts`
- `packages/sdk/src/attachments/upload.ts`
- `packages/sdk/src/attachments/url-validation.ts`
- `packages/sdk/src/attachments/exif-strip.ts` (deleted)
- `packages/sdk/src/attachments/exif-strip-helpers.ts` (deleted)
- `packages/sdk/src/attachments/exif-strip.test.ts` (deleted)

EXIF decision:

- Callers must strip private metadata before `uploadAttachment()` /
  `providerUpload()`. The SDK upload path preserves the bytes it receives and
  does not strip EXIF/GPS/device metadata.
- Locked by
  `packages/sdk/src/attachments/provider-upload.test.ts` —
  `does not strip metadata before upload; callers are responsible`.

Preview generation:

- Deleted from `packages/sdk/src/attachments/access.ts`.
- `rg -n "generatePreview|preview|stripExif|exif" packages/ examples/ e2e/ scripts/`
  found no example, e2e, or script consumer of preview generation, so nothing
  was relocated.

Orphaned runtime follow-up:

- `spawn` and `which` remain used by proof code outside this issue.
- Preview config fields remain in
  `packages/sdk/src/internal/runtime/config.ts` and its test, but that path is
  guarded by this issue's scope. Defer removing those config fields to 0149.

Verified with:

- `rg "sips|magick|convert|process\.platform|exiftool" packages/sdk/src/attachments/`
  returned no matches.
- `deno task check` passed.
- `deno task lint:strict` passed.
- `deno test packages/sdk/src/attachments/ --allow-env --allow-net --allow-read`
  passed: 12 passed, 0 failed.
- `deno test packages/sdk/src/attachments/` was also run exactly as requested;
  it failed only because the existing attachment tests require env permission
  (`BLOSSOM_SERVERS` / `ANCHR_ALLOW_LOCALHOST_ATTACHMENTS`). No failure was in
  attachment behavior.

Harness update:

- The caller-owned metadata contract is locked by
  `packages/sdk/src/attachments/provider-upload.test.ts`; the attachment
  surface docs in `docs/architecture.md` record the same ownership boundary.

Review residuals:

- Privacy-posture change (maintainer-acknowledged via option (b)): the
  provider upload path previously stripped EXIF by default; the SDK now
  preserves submitted bytes and the `stripExif` capability is deleted, so any
  caller wanting metadata stripped must implement it themselves. In-repo this
  is benign — the only consumer is the GPS-proof flow (`uploadAttachment`),
  which must retain EXIF GPS for INV-06 verification — but a future
  private-work-product uploader gains no SDK-provided stripper. Owner: the
  evidence-production / caller layer per the documented contract in
  `docs/architecture.md` and `packages/sdk/src/attachments/upload.ts`.

Follow-up:

- 0149 owns the deferred runtime config cleanup.
