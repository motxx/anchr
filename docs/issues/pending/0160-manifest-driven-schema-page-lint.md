# Manifest-driven proof-schema-page lint

Created: 2026-06-13
Model: Claude Fable 5

## Priority

maintenance

## Dependencies

Depends on:
- 0159

Blocks:
- 0148

## Summary

Child of 0148. `scripts/check-proof-schema-pages.ts` hardcodes the two built-in
proof-schema URLs (TLSN, C2PA-image) and their page paths, so a third-party
schema URL has no manifest to join. Replace the hardcoded list with a manifest
(e.g. `spec-site/schemas.json`) that maps each published schema URL to its
spec-site page path; the lint reads the manifest.

## Rationale

- Once 0159 makes schema registration open, the schema-page check must also be
  open: a new schema URL should be addable by editing a manifest, not the lint
  script source.
- Keeps the "anyone can define a schema" premise consistent across the
  registration API and the published-page check.

## Acceptance

- `scripts/check-proof-schema-pages.ts` reads `spec-site/schemas.json` (or an
  equivalent manifest) instead of a hardcoded URL list.
- The manifest lists the built-in TLSN and C2PA-image schema pages and is the
  single source the lint iterates.
- `deno task lint:proof-schema-pages` passes against the manifest.

## Verification

- `deno task lint:proof-schema-pages` passes.
- Removing a page entry from the manifest (or deleting its page) makes the lint
  fail; restoring it passes. No hardcoded schema URL list remains in
  `scripts/check-proof-schema-pages.ts`.

## Plan

- Add `spec-site/schemas.json` listing schema URL → page path for the built-in
  schemas.
- Update `scripts/check-proof-schema-pages.ts` to read and iterate the manifest.
