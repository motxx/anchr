# Document resolver-led issue splitting

Created: 2026-05-20
Model: GPT-5

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Update the repository issue workflow and agent skills so broad issue splitting
happens when an issue is about to be resolved, not when the original issue is
created.

`make-issues` should capture the problem, known constraints, and obvious
dependencies without forcing a full implementation design. `resolve-issues`
should inspect the current repository state before editing, decide whether the
target issue is small enough to close directly, and create sub-issues first when
the work should be solved as several smaller independent changes.

This is a documentation and skill-guidance issue. It should make the resolver's
decision point explicit without prescribing the exact child issue split or
turning the parent issue into a broad implementation task.

## Rationale

Anchr's issue flow is intentionally session-friendly: a future agent should be
able to pick up a pending issue, re-read the repository, and solve the current
small unit without depending on overfit planning from the issue creation
session.

If `make-issues` eagerly decomposes a broad finding into detailed implementation
steps, it can bake in design decisions before the resolver has enough local
context. That weakens the repository's preferred flow of creating a tracking
issue, starting a fresh resolution session, and letting the resolver split the
work based on current code, dependencies, and verification scope.

Relevant references:

- Zenn: <https://zenn.dev/erukiti/articles/2512-full-ai-cofing>
- `docs/issues/README.md`
- `docs/review-harness.md`
- `skills/make-issues/SKILL.md`
- `skills/make-sub-issues/SKILL.md`
- `skills/resolve-issues/SKILL.md`
- `CLAUDE.md`

## Research notes

The Zenn article's useful takeaway for Anchr is not "add more prompt rules."
Its core fit is the same direction Anchr already uses: make AI coding reliable
through deterministic lint, clear boundaries, integration/E2E checks, review
routing, and small verifiable tasks.

For Anchr, issue handling should be treated as several separate tasks, not one
large planning act:

1. Initial issue creation captures the problem, known constraints, and why the
   work matters.
2. Resolution starts in a later context by re-reading current code and finding
   the best solution shape.
3. The resolver turns that solution shape into a plan only after it has current
   local context.
4. If the plan is too broad for one coherent change, the resolver creates
   sub-issues before implementation.
5. Each child issue is then solved as a small independently verifiable unit.

This keeps issue creation from pretending to know details that only become clear
when a fresh resolver inspects the current repository state.

Observed similarities:

- Anchr already routes recurring review findings into automated checks,
  semantic skills, universal docs, or follow-up issues through
  `docs/review-harness.md`.
- Anchr already has strong completion bars in `CLAUDE.md`: strict lint, unit,
  integration, protocol E2E, example checks, FROST/TLSN/regtest buckets, and
  Docker-backed verification.
- Anchr already treats architecture boundaries as a harness concern, with a
  documented protocol/primitives/SDK/adapters/apps stack and `lint:arch`.
- Repository-local skills such as `arch-lint-llm` and `check-silent-bypass`
  already cover semantic review classes that deterministic lint cannot prove.

Important differences:

- The article assumes a Node/ESLint/Vitest-style stack. Anchr is Deno-first and
  should keep improving Deno tasks and custom lints rather than importing that
  stack wholesale.
- The article is more permissive about adding explanatory comments and TSDoc.
  Anchr's current rule is stricter: comments should explain non-obvious current
  invariants only, and history comments are linted.
- The article favors eager task decomposition, but Anchr's file-based issue
  workflow benefits from resolver-led decomposition: initial issues should
  capture the problem and constraints, while the resolver re-reads current code
  and creates sub-issues only when the work is ready to split.
- The article's "mock avoidance" guidance maps to Anchr's status/runbook model
  rather than a blanket ban. Simulations and mocks are acceptable when labeled,
  scoped, and covered by smoke or E2E expectations.

Resolver-facing implications:

- Prefer updating issue workflow, skills, and review-harness routing over adding
  broad new agent instructions.
- Preserve the separation between `make-issues` as problem capture and
  `resolve-issues` as the place where implementation-aware decomposition
  happens.
- Treat boundary parsing, session re-sync, and maintained-app QA notes as
  review-harness examples to route carefully, not as a pre-decided
  implementation breakdown.

## Non-goals

- Do not prescribe the exact child issue split in this parent issue.
- Do not require every issue to be split. Split only when the resolver's current
  context shows that one coherent change would be too broad.
- Do not turn this into a broad code implementation task.
- Do not change implementation code unless a resolver-created child issue
  explicitly calls for it.

## Plan

- Clarify in issue workflow docs that initial issue creation should capture the
  problem, constraints, and obvious dependencies, not a detailed implementation
  decomposition.
- Clarify in `make-issues` that broad findings should not be eagerly converted
  into over-specific implementation plans before a resolver has current local
  context.
- Clarify in `resolve-issues` that resolution begins by re-reading the current
  repository state and deciding whether the target issue is closeable as one
  coherent change.
- Document that broad issues should be split by the resolver before
  implementation, using `make-sub-issues` and the existing `Depends on` /
  `Blocks` relationship model.
- State that once a parent issue is split, child issues should be resolved as
  independently verifiable units instead of implementing the whole parent at
  once.
- Add only concise review-harness guidance needed to support this workflow.
