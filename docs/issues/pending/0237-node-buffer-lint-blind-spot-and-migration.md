# Close the node:buffer blind spot: migrate to Uint8Array and lint it

Created: 2026-07-03
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

The planned port-lint extension (0194) covers `node:fs`, `node:os`,
`node:crypto`, and `node:child_process` but not `node:buffer`, and Buffer
usage is already spread through the attachment/proof pipeline: value
imports in `attachments/{upload,upload-helpers,attachment-helpers}.ts`,
type imports in `attachments/types.ts`, `proofs/c2pa-validation.ts`, and
`proofs/exif-validation.ts` — including on publicly exported interfaces.
In a Deno-first codebase the idiomatic byte type is `Uint8Array`; Node
`Buffer` in public types couples the SDK surface to a Node builtin the
port lints will still not catch after 0194 lands. Migrate the pipeline to
`Uint8Array` and add `node:buffer` to the lint list so it stays out.

## Rationale

- Value imports: `attachments/upload.ts:1`, `upload-helpers.ts:5`,
  `attachment-helpers.ts:5`. Type imports: `attachments/types.ts:1`,
  `proofs/c2pa-validation.ts:9`, `proofs/exif-validation.ts:8`
  (survey 2026-07-03; re-verify at resolution).
- 0194's extension list omits `node:buffer`; coordinate the lint rule with
  it (same allowlist model) whichever lands first.
- 0236 may delete `attachments/types.ts`'s Buffer-bearing interface first;
  migrate whatever remains.

## Acceptance

- Non-adapter `packages/` modules use `Uint8Array` (or a justified,
  allowlisted exception) instead of Node `Buffer`; no public interface
  exposes the `Buffer` type.
- The port lint flags new `node:buffer` imports in non-allowlisted modules.

## Verification

- `rg "node:buffer" packages/sdk/src --glob '!*.test.ts'` returns only
  allowlisted matches (expected: none, or the recorded exceptions).
- Introducing a `node:buffer` import in a non-adapter module fails
  `deno task lint:strict`.
- `deno task test:unit` and `deno task test:integration` pass.

## Plan

- Migrate call sites to `Uint8Array`; adjust dependent code.
- Add `node:buffer` to the port-lint list alongside 0194's rules.
