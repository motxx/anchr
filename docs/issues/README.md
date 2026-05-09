# Issues

This repository tracks issues in `docs/issues` instead of GitHub Issues. The
layout follows the file-based issue style used by
<https://github.com/shiguredo/http3-rs/tree/develop/issues>.

## Layout

- `pending/`: open issues.
- `closed/`: completed issues.
- `SEQUENCE`: the last allocated issue number.

Issue files use a zero-padded sequence number and a short kebab-case title:

```text
docs/issues/pending/0001-short-title.md
```

Numbers are never reused, even when an issue is closed or abandoned.

## Creating an Issue

1. Increment `SEQUENCE`.
2. Add a Markdown file under `pending/` using the new number.
3. Keep the issue scoped enough to close in one change when possible.

Use this structure:

```text
# Short title

Created: YYYY-MM-DD
Model: <model name, if created with an agent>

## Priority

<bug | feature | design | maintenance | investigation>

## Summary

What needs to change, and why.

## Rationale

Links, code references, logs, threat-model notes, or compatibility constraints.

## Plan

- Concrete next step
- Another concrete next step
```

## Closing an Issue

Move the file from `pending/` to `closed/`, keep the same filename, and add:

```text
Completed: YYYY-MM-DD

## Resolution

What changed, including important PRs, commits, files, or follow-up notes.
```

Do not renumber files when moving them. If the work reveals a separate task,
create a new issue with a new number.

## Security

Do not put private keys, proofs, personal data, fund-bearing details, or
unpatched vulnerability details in `docs/issues`. Coordinate privately with
maintainers before filing security-sensitive work.
