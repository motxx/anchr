# Finalize package collapse

Created: 2026-05-23
Model: GPT-5

## Priority

maintenance

## Dependencies

Depends on:
- 0050
- 0051
- 0052
- 0053
- 0054
- 0055

Blocks:
- 0047

## Summary

Finish #0047 after the absorption issues land by removing remaining absorbed
package manifests, stale package imports, and package/e2e references so the
repository exposes only `@anchr/sdk` and `@anchr/protocol` as public Anchr
packages.

## Rationale

The preceding children move code by responsibility. This final package-collapse
cleanup verifies the public package boundary as a whole before #0047 can close.
It deliberately does not prune apps/examples, which belongs to #0049, or final
workspace/lint/publish enforcement, which belongs to #0048.

Relevant current surfaces:

- `deno.json`
- `packages/`
- `e2e/`
- `scripts/`
- `packages/sdk/deno.json`
- `packages/protocol/deno.json`

## Acceptance

- Only `packages/sdk/deno.json` and `packages/protocol/deno.json` remain as
  Anchr package manifests.
- Package and e2e imports use only `@anchr/sdk`, `@anchr/protocol`, external
  dependencies, or relative imports within the same owner boundary.
- Stale package README, SPEC, and manifest files for absorbed packages are
  removed with their directories.
- #0047 can be closed with focused verification, leaving app/example pruning to
  #0049 and final enforcement to #0048.

## Verification

- `find packages -maxdepth 2 -name deno.json -print | sort`
- No matches are expected:
  `rg -n "@anchr/(customer-sdk|provider-sdk|oracle-sdk|core-runtime|core-cashu|frost-oracle|tlsn-toolkit|photo-verification|cashu-conditional-swap|blossom|adapters|bounty)|packages/bounty/src" packages e2e deno.json`
- `deno task test`

## Plan

- Re-run package-surface searches after #0050 through #0055 close.
- Remove any remaining absorbed package directories and manifests.
- Rewrite stale package and e2e imports to SDK/protocol or delete tests that
  only covered removed non-core package surfaces.
- Leave apps/examples and final publish/lint enforcement to #0049 and #0048.
