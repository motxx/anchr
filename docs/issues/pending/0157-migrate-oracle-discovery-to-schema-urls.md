# Migrate Oracle discovery to schema URLs

Created: 2026-06-13
Model: GPT-5.4-Codex

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- 0143

## Summary

Oracle discovery should follow `specs/oracle-registry.md`: kind 30088 registry
events advertise supported proof schemas with `supported_schemas` in content
and `s` tags containing exact proof schema URLs. The current implementation and
tests still use `supported_factors` and `anchr-oracle-<factor>` `t` tags.

Migrate the SDK discovery types, event builders, parser, and relay e2e test to
schema-URL capability keys. Delete `packages/sdk/src/adapters/oracle-client/built-in.ts`
and remove the default built-in Oracle whitelist from the SDK registry surface;
applications that want a static Oracle list may pass their own registry entries.

## Rationale

- `docs/architecture.md` defines the proof schema URI as the only verification
  dispatch key and keeps factor names schema-internal.
- `specs/oracle-registry.md` defines `supported_schemas` plus `s` tags for
  capability discovery.
- Current drift is visible in
  `packages/sdk/src/requests/domain/oracle-types.ts`,
  `packages/sdk/src/adapters/nostr/events/event-builders.ts`,
  `packages/sdk/src/adapters/oracle-client/oracle-discovery.ts`, and
  `e2e/relay/oracle-discovery.test.ts`.
- The built-in Oracle whitelist is an application opinion, not a universal SDK
  default.

## Acceptance

- Oracle announcement types expose `supported_schemas` as exact schema URL
  strings and no longer expose `supported_factors`.
- `buildOracleAnnouncementEvent` emits one `t` tag of `anchr-oracle` plus one
  `s` tag per supported schema URL.
- Relay discovery filters by `#s` schema URL when a capability filter is
  requested.
- `e2e/relay/oracle-discovery.test.ts` covers `supported_schemas` and `s` tags.
- `packages/sdk/src/adapters/oracle-client/built-in.ts` is deleted and the SDK
  no longer registers a default built-in Oracle whitelist.

## Verification

- `deno task test:e2e:relay`
- `deno task lint:strict`
- No matches are expected for old factor discovery:
  `rg "supported_factors|anchr-oracle-" packages/sdk/src e2e/relay`

## Plan

- Replace factor-based Oracle discovery types and parsers with schema URL
  arrays.
- Update announcement event builders and relay discovery filters to use `s`
  tags.
- Remove the built-in Oracle whitelist and update registry tests and callers to
  pass explicit application-owned Oracle entries.
