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
4. If the issue cannot be resolved until another issue is closed, record that
   prerequisite under `Depends on`.
5. If later work should wait for this issue, record those issue numbers under
   `Blocks`.

Initial issue creation is problem capture, not final implementation planning.
Record the problem, known constraints, important references, and obvious
dependencies. Do not force a detailed child-issue split before a resolver has
re-read the current repository state.

When a finding is broad but the correct implementation split depends on current
code, create a tracking issue with enough context for the future resolver. The
resolver decides whether to close it directly or split it first.

Use this structure:

```text
# Short title

Created: YYYY-MM-DD
Model: <model name, if created with an agent>

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

`Acceptance` should state observable completion conditions, not implementation
steps. `Verification` should state focused commands or manual checks that prove
the issue is resolved. Use `- Unknown until investigation` for investigation
issues where the correct verification depends on the root cause.

## Closing an Issue

Move the file from `pending/` to `closed/`, keep the same filename, and add:

```text
Completed: YYYY-MM-DD

## Resolution

Implemented by updating:

- `path/to/file`

Verified with:

- `deno task lint:strict`

Harness update:

- <which test, lint, skill, threat-model entry, universality-boundary entry, or
  spec edit absorbs this class of finding>; or
- None — <one-line rationale for why no harness update was needed, for example
  the finding is a one-time design decision now locked in docs, or it is a
  `human universal decision` that belongs to a maintainer call>.

Review residuals:

- None; or
- <human decision left after verification, with the owning doc/spec or pending
  issue number>.

Follow-up:

- None
```

Do not renumber files when moving them. If the work reveals a separate task,
create a new issue with a new number.

If the issue has unresolved `Depends on` entries, do not close it unless the
maintainer explicitly accepts the remaining dependency risk. When closing an
issue, update other pending issues whose `Depends on` or `Blocks` lists should
change as a result.

## Resolver-Led Splitting

Resolution starts by re-reading the current repository state. If the target
issue is too broad for one coherent, verifiable change, split it before editing
implementation code:

1. Use `skills/make-issues/SKILL.md` (child-issue mode) to create
   independently closeable child issues.
2. Set each child issue's `Blocks` list to the parent issue number.
3. Add each child issue number to the parent issue's `Depends on` list.
4. Leave the parent pending until the required children close, unless the
   parent is purely a tracking issue whose resolution is the split itself.
5. Resolve child issues one at a time with their own verification and
   resolution notes.

Do not implement a broad parent and all of its children in one change just
because the parent contains a detailed plan. The resolver's current context and
verification scope decide the split.

## Example Issues

Issues that create, promote, demote, or retire an advertised example must follow
[`docs/example-delivery-lifecycle.md`](../example-delivery-lifecycle.md).
Include the `Example requirements` section from that document before changing
example code when the target status, actors, real dependencies, simulated
dependencies, or non-production boundary is not already clear.

If the example work spans requirements, package boundaries, user-facing code,
runbook, smoke harness, and README promotion, split the issue before
implementation. The parent issue should lock the accepted requirements and the
child issues should own the concrete implementation, docs/runbook, and
verification work.

The harness-update field follows the maintenance loop in
[`docs/review-harness.md`](../review-harness.md#maintenance-loop). "Out of
scope" alone is not a rationale; pair it with the pending issue number that
will close the gap.

The review-residuals field follows
[`docs/review-harness.md`](../review-harness.md#residual-review). Use `None`
when no human decision remains after verification. If a residual remains, name
the decision and its owning document, or leave the issue pending unless the
maintainer explicitly accepts the risk.

## Security

Do not put private keys, proofs, personal data, fund-bearing details, or
unpatched vulnerability details in `docs/issues`. Coordinate privately with
maintainers before filing security-sensitive work.
