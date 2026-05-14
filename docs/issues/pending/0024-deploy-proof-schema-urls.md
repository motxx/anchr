# Deploy proof schema URLs

Created: 2026-05-15
Model: Codex (GPT-5)

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
