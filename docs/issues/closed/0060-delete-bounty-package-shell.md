# Delete bounty package shell

Created: 2026-05-23
Model: GPT-5
Completed: 2026-05-24

## Priority

maintenance

## Dependencies

Depends on:
- 0057
- 0058
- 0059

Blocks:
- 0054

## Summary

After reusable bounty code has moved to SDK-owned modules, rewrite remaining
package and e2e references and delete the `packages/bounty/` manifest, README,
barrels, and package directory.

## Rationale

This is the final cleanup child for #0054. It should run only after lifecycle,
transport/Oracle adapters, and residual helper moves have landed, so it does
not preserve compatibility shims or make product/API decisions.

Relevant current surfaces:

- `packages/bounty/`
- `deno.json`
- `e2e/protocol/`
- `e2e/relay/`
- `e2e/regtest/`
- `e2e/tlsn/`
- `e2e/frost/`

## Acceptance

- `packages/bounty/` is deleted.
- Root `deno.json` workspace, import map, lint exclusions, and publish dry-run
  task no longer reference `packages/bounty` or `@anchr/bounty`.
- Package and e2e code no longer imports from `packages/bounty/src/...`.
- The remaining public Anchr package manifests are `packages/sdk/deno.json` and
  `packages/protocol/deno.json`, leaving #0056 to verify the broader package
  collapse across all absorbed package directories.

## Verification

- No matches are expected:
  `rg -n "@anchr/bounty|@anchr/sdk/bounty|packages/bounty/src|packages/bounty" packages e2e deno.json`
- `find packages -maxdepth 2 -name deno.json -print | sort`
- `deno task test`

## Plan

- Re-run bounty package import searches after #0057, #0058, and #0059 close.
- Rewrite any remaining e2e imports to SDK or protocol modules.
- Remove `packages/bounty` from workspace, publish dry-run, import maps, and
  lint exclusions.
- Delete the empty package shell and verify the package/e2e test suite.

## Resolution

Implemented by updating:

- `deno.json`
- `Dockerfile`
- `packages/bounty/README.md`
- `packages/bounty/deno.json`

Verified with:

- `rg -n "@anchr/bounty|@anchr/sdk/bounty|packages/bounty/src|packages/bounty" packages e2e deno.json`
- `find packages -maxdepth 2 -name deno.json -print | sort`
- `test ! -e packages/bounty`
- `deno test scripts/lint-dockerfile-workspace.test.ts --allow-read`
- `deno task test`
- `deno task lint:strict`

Harness update:

- Existing `scripts/lint-dockerfile-workspace.ts` and
  `scripts/lint-dockerfile-workspace.test.ts` caught the stale Dockerfile
  workspace copy after `packages/bounty` left the workspace.

Review residuals:

- None

Follow-up:

- #0054 can now be resolved when its remaining acceptance is verified.
