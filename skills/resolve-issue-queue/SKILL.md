---
name: resolve-issue-queue
description: >-
  Resolve Anchr `docs/issues/pending/` as a queue while keeping context clean.
  Use when the user asks to automatically resolve many issues, drain the issue
  queue, run issues with fresh context, avoid context pollution while resolving
  issues, or run a short-lived issue worker loop. This skill processes one
  dependency-ready issue at a time, delegates only with minimal repo-grounded
  context when explicitly requested/available, splits broad issues, and stops
  after each coherent unit unless the user explicitly asks to continue.
argument-hint: "[--one | --continue] [issue-number]"
---

# Resolve Issue Queue

Run repository issues as short, isolated work units. The goal is throughput
without carrying stale assumptions from one issue into the next.

## Core Rules

- Default to one issue per run. Stop after the issue is closed, split, blocked,
  or judged too broad.
- Use `skills/resolve-issues/SKILL.md` for the actual issue resolution rules.
- Use `skills/make-sub-issues/SKILL.md` when an issue is too broad for one
  coherent verified change.
- Do not resolve a broad parent and its children in the same run.
- Do not continue to the next issue unless the user explicitly asked for a
  queue run that continues.
- Keep state in the repo, not in chat: issue files, docs, tests, lint, commits.

## Select the Next Issue

1. Read `CLAUDE.md`, `docs/issues/README.md`, `docs/issues/SEQUENCE`, and list
   `docs/issues/pending/*.md`.
2. If the user named an issue, use that issue.
3. Otherwise choose the lowest-numbered pending issue whose `Depends on` entries
   are all closed or `None`.
4. If no issue is dependency-ready, report the blockers and stop.

## Clean-Context Execution

Prefer a fresh worker/new session for implementation when the user explicitly
asks for agents, delegation, or queue automation and the environment supports
it. Pass only:

- `CLAUDE.md`
- `docs/issues/README.md`
- `skills/resolve-issues/SKILL.md`
- `skills/make-sub-issues/SKILL.md`
- the target issue file
- `git status --short`
- exact instruction: "Resolve exactly this one issue; if broad, split and stop."

Do not pass prior discussion, suspected fixes, or stale conclusions unless the
target issue explicitly depends on them. The parent agent reviews the returned
diff, runs verification, and reports the outcome.

If fresh execution is unavailable or not explicitly requested, run the same
one-issue workflow locally and be strict about stopping after the unit.

## Import and Type Sanity Gate

Before closing a code-changing issue or moving to the next queue item, run
`deno task check` from the repository root. This is a required fast sanity gate
for unresolved imports, stale export names, missing files after moves, and
TypeScript errors that may not be exercised by a focused test path.

If `deno task check` fails, fix the code and rerun it. Do not close the issue,
delegate the next issue, or report the queue unit as done while import or type
errors remain. If the failure is environmental rather than code-related, leave
the issue pending with the exact blocker recorded.

## Worker Prompt

Use this shape for a short-lived worker:

```text
Resolve exactly docs/issues/pending/NNNN-title.md in this repository.
Follow CLAUDE.md, docs/issues/README.md, skills/resolve-issues/SKILL.md, and
skills/make-sub-issues/SKILL.md.

If the issue is too broad for one coherent verified change, create child issues
and stop. Do not implement the parent and children together.

Do not use conversation history as truth. Re-read current repo files. Preserve
unrelated changes. List changed files and verification commands in the final
answer.

For any code change, run `deno task check` before closing the issue. Treat
unresolved imports, stale exports, or TypeScript errors as blockers until fixed.
```

## Completion Gate

Before reporting done for a run:

- The selected issue is either closed with a valid resolution note, split into
  pending child issues, or left pending with a concrete blocker.
- Required focused verification has been run, or the blocker is recorded.
- For any non-docs-only code change, `deno task check` has been run and passes.
- For any non-docs-only code change, `deno task test:all` has been run.
- `git status --short` has been checked.
- The response names the processed issue and says whether the queue should stop
  because of the one-issue rule, a split, a blocker, or user-requested limit.
