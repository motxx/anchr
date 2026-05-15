# Deploy proof schema URLs

Created: 2026-05-15
Model: Codex (GPT-5)
Completed: 2026-05-15

## Priority

feature

## Dependencies

Depends on:
- None

Blocks:
- 0025

## Summary

Deploy the proof schema URLs advertised in the README as stable public HTTPS
documents, starting with:

- `https://anchr-spec.org/spec/proof/tlsn/v1`
- `https://anchr-spec.org/spec/proof/c2pa-image/v1`

The URLs are used as exact schema identifiers in SDK requests, but the public
URLs should also resolve to durable human-readable schema documentation.

## Rationale

`README.md` and `packages/sdk/README.md` list the `anchr-spec.org` schema URLs
under "Verification Schemas" / "Proof Schema URLs". `specs/proof-schemas.md`
defines the URL shape and initial schemas, but there is no repository-tracked
deployment path proving those URLs resolve.

If the public URLs are not deployed, SDK examples appear to depend on
nonexistent external documentation even though implementations compare the
schema strings exactly.

Relevant files:

- `README.md`
- `packages/sdk/README.md`
- `specs/proof-schemas.md`
- `specs/`

## Plan

- Decide the static hosting/deployment path for `anchr-spec.org`.
- Add or generate per-schema pages for `tlsn/v1` and `c2pa-image/v1` from the
  repository specs.
- Ensure each deployed page states the predicate shape, proof payload shape,
  response data shape, and verification requirements.
- Add a lightweight check or documented release step that verifies the schema
  URLs resolve before README examples are advertised as complete.
- Update README/spec links if the deployed URL layout differs from the current
  table.

## Resolution

Implemented by updating:

- `spec-site/`
- `.github/workflows/deploy-proof-schema-site.yml`
- `scripts/check-proof-schema-pages.ts`
- `deno.json`
- `specs/proof-schemas.md`
- `docs/issues/pending/0025-complete-testnet-reference-examples.md`
- `docs/issues/pending/0027-complete-c2pa-media-example.md`
- `docs/issues/pending/0028-complete-tlsn-fiat-swap-example.md`

Verified with:

- `deno task lint:proof-schema-pages`
- `deno task lint:strict`

Harness update:

- Added `deno task lint:proof-schema-pages` to check the `anchr-spec.org`
  static source, CNAME, canonical schema URLs, and required documentation
  sections before deployment.

Review residuals:

- None

Follow-up:

- None
