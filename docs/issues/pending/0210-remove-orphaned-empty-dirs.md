# Remove orphaned empty directories under e2e/ and examples/

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

Empty, unregistered directories exist outside the sanctioned structure: two e2e
buckets with no `deno task` (so any test dropped there would silently never
run) and an empty example dir referenced nowhere. The pre-1.0 rule is to delete
replaced/dead paths outright.

## Rationale

- `e2e/web/` and `e2e/pentest/` are empty; not among the five documented buckets
  (protocol/relay/regtest/frost/tlsn) and have no `deno.json` task (~lines
  63-67), so "bucket = deno task" discovery does not cover them.
- `examples/browser-customer-server-provider/` is empty; not in the `deno.json`
  workspace or the README examples table.

## Acceptance

- The empty orphaned directories are removed, or each is wired into a documented
  task/workspace entry with real content.

## Verification

- `ls e2e/web e2e/pentest examples/browser-customer-server-provider` — the dirs
  are gone (or contain registered, runnable content).

## Plan

- Delete the empty dirs (default), or populate + register if intended.
