# Strip platform-specific media tooling from the attachment surface

Created: 2026-06-12
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
