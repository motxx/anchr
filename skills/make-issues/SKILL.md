---
name: make-issues
description: Create repository-tracked Markdown issues under `docs/issues/pending/` for Anchr. Use when the user says `make-issues`, asks to file/create/add docs issues, wants a backlog split into tracked work items, or asks to convert findings/TODOs/plans into `docs/issues` entries. This skill updates `docs/issues/SEQUENCE`, writes zero-padded issue files, and follows `docs/issues/README.md`.
argument-hint: "<issue request, findings, TODOs, or plan>"
---

# Make Issues

Create one or more file-based issues in `docs/issues/pending/` and update
`docs/issues/SEQUENCE`.

## Workflow

1. Read `docs/issues/README.md` and `docs/issues/SEQUENCE`.
2. List `docs/issues/pending/*.md` and `docs/issues/closed/*.md`.
3. Determine the next number:
   - Parse `SEQUENCE` as the last allocated number.
   - Also parse existing issue filenames.
   - Use `max(sequence, highest_existing_number) + 1`.
   - Update `SEQUENCE` to the last number created.
4. Turn the user's request into issue-ready problem statements:
   - Capture the problem, known constraints, important references, and obvious
     dependencies.
   - Create multiple issues only when the independent changes are already clear
     without implementation-time repository inspection.
   - For broad findings whose correct split depends on current code, create a
     tracking issue and state that the resolver should split it before
     implementation if one coherent change is too broad.
   - For related issue queues, make each issue's owner responsibility explicit
     enough that another session or agent can resolve it without reading chat
     history.
   - Avoid sibling issues that own the same broad change. Put shared follow-up
     cleanup in one later issue that depends on the concrete owner issues.
   - If a verification command is a negative check, state the expected outcome
     explicitly, for example `No matches are expected: rg ...`.
   - Avoid baking in over-specific implementation plans during issue creation.
   - If the request is too vague to produce a useful issue, inspect relevant
     local context before asking a question.
5. Check the dependency graph before writing: no cycles, prerequisites listed in
   `Depends on`, parent/tracking issues depend on required children, and final
   cleanup issues depend on the concrete changes they verify.
6. Write each issue as `docs/issues/pending/NNNN-short-title.md`.
7. Report the created paths and numbers.

## Issue Format

Use exactly this shape unless the repository README changes:

```markdown
# Short title

Created: YYYY-MM-DD
Model: <current agent/model name>

## Priority

<bug | feature | design | maintenance | investigation>

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

What needs to change, and why.

## Rationale

Links, code references, logs, threat-model notes, or compatibility constraints.

## Acceptance

- Observable completion condition

## Verification

- Command or manual check to run

## Plan

- Concrete next step
- Another concrete next step
```

Priority must be one of:

- `bug`: incorrect behavior or regression.
- `feature`: new user-visible or developer-facing capability.
- `design`: architecture, API, UX, protocol, or product decision work.
- `maintenance`: cleanup, refactor, docs, tooling, dependency, or test debt.
- `investigation`: unknown root cause or research needed before implementation.

## Naming

- Number: four digits, zero-padded (`0001`).
- Slug: lowercase ASCII kebab-case.
- Keep slugs short and specific, usually 3-7 words.
- Do not reuse numbers, even if a file was closed or abandoned.
- If multiple issues would naturally share a slug, keep the slug and rely on the
  number for uniqueness.

## Content Rules

- Keep each issue closeable in one change when possible, but prefer a broad
  tracking issue over a guessed child split when the split requires resolver
  context.
- Record issue prerequisites in `Depends on` and downstream work in `Blocks`.
  Use `- None` when there is no known relationship.
- Include concrete file paths, commands, logs, or docs references only when they
  help the implementer act.
- Use `Acceptance` for observable completion conditions, not implementation
  steps.
- Use `Verification` for focused commands or manual checks that should prove the
  issue is resolved. Use `- Unknown until investigation` for investigation
  issues where the correct verification depends on the root cause.
- Use the `Plan` section for immediate orientation and acceptance cues, not a
  full implementation design when the resolver has not inspected current code.
- For delegated queues, separate decision, change, migration/pruning, and final
  enforcement work when those responsibilities can close independently.
- In `Acceptance`, name observable end states. In `Verification`, include the
  expected outcome of negative checks.
- Avoid vague shared verbs like "align everything" in sibling issues. If work is
  shared, choose one owner issue or defer it to a cleanup issue.
- Do not include private keys, proofs, personal data, fund-bearing details, or
  unpatched vulnerability details.
- For security-sensitive work, write a safe high-level tracking issue and say
  that operational details must be coordinated privately.
- Do not create GitHub Issues for this repository unless the user explicitly
  asks; `docs/issues` is the source of truth.

## Validation

After editing:

1. Confirm `docs/issues/SEQUENCE` equals the last allocated number.
2. Confirm every new file is under `docs/issues/pending/`.
3. Confirm each new filename starts with its allocated four-digit number.
4. Confirm every issue has `Acceptance` and `Verification`.
5. Confirm multi-issue dependencies are acyclic and blocked issues list
   prerequisites under `Depends on`.
6. Confirm sibling ownership does not overlap broadly; if siblings touch the
   same files, their responsibilities and sequencing are explicit.
7. Confirm negative verification commands say whether no matches are expected.
8. Confirm no sensitive material was added.
