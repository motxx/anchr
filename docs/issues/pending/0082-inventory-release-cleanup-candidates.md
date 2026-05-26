# Inventory release cleanup candidates

Created: 2026-05-27
Model: GPT-5 Codex

## Priority

investigation

## Dependencies

Depends on:
- 0088

Blocks:
- 0080
- 0083
- 0084
- 0085

## Summary

Create an explicit inventory of files and directories that should be kept,
internalized, archived, or deleted before external public release. This issue
should classify the repository shape before destructive cleanup begins.

## Rationale

The cleanup scope spans root files, `docs/`, `skills/`, examples, scripts,
generated artifacts, local database files, package entry points, and stale
configuration. Some files are public product contract, some are maintainer
workflow, and some are likely obsolete. The correct deletion split depends on a
current repository read after protocol conformance, SDK dogfooding, and example
revival have clarified what is actually needed.

## Acceptance

- A tracked inventory document or issue resolution section classifies root
  files, `docs/`, `skills/`, `examples/`, `example/`, `scripts/`, `specs/`,
  package manifests, generated outputs, and local artifacts as keep, internal,
  archive, or delete.
- Every delete candidate has a short reason and a focused verification command
  or manual check.
- Maintainer workflow files that should remain in the repo are distinguished
  from public-facing docs.
- No broad destructive deletion is performed in this issue except obviously
  generated or local-only artifacts if the resolver verifies they are ignored
  and unneeded.
- Follow-up cleanup issues are created if the inventory reveals independent
  deletion batches beyond #0083, #0084, and #0085.

## Verification

- `rg --files | sort`
- `git status --short`
- Manual check: each cleanup candidate has exactly one classification and no
  sensitive material is copied into the issue text.

## Plan

- List the repository top level and major docs/skills/examples/scripts trees.
- Classify each candidate by public value and maintenance value.
- Create narrower follow-up issues only for independently closeable cleanup
  batches discovered during inventory.
