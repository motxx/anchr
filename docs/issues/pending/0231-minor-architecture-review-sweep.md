# Sweep minor findings from the 2026-07-02 architecture review

Created: 2026-07-02
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Small, independent findings from the 2026-07-02 whole-repo architecture review
that are worth fixing but too small to own an issue each. Each item is
resolvable in isolation; resolve or explicitly decline per item.

## Rationale

- `packages/sdk/src/internal/runtime/env.ts` is misnamed: it contains only
  `moduleDir(meta)` and no environment logic — rename or fold into
  `fs.ts`/`runtime.ts`.
- `packages/sdk/src/adapters/oracle-service/server-entry.ts:17-21` reads five
  `Deno.env` vars directly instead of through `AnchrConfigPort`
  (`internal/runtime/config.ts:84-90`). It is E028-allowlisted, but it
  sidesteps the one config seam every other module uses — route it through
  `serverConfigPort` or record why process entrypoints read raw env.
- `packages/sdk/src/proofs/verification/checks/empty-submission.ts:18-20`: the
  generic check's default failure copy is photo-specific ("photos are
  required…"), and the bare singleton (`:25`) is reused verbatim by the C2PA
  bundle (`c2pa-image-schema.ts:9,20`) — schema vocabulary leaking out of a
  generic module; parameterize the message per schema bundle.

## Acceptance

- Each item is fixed, or declined with a one-line reason in the resolution
  note.

## Verification

- `deno task lint:strict` and `deno task test:unit` pass.
- Per item: the rename/fold is reflected in imports; `server-entry.ts` env
  access goes through the config port (or the recorded exception explains it);
  the empty-submission default message no longer names photos for non-photo
  schemas.

## Plan

- Fix the three items in one small change; update any affected tests.
