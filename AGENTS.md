# AGENTS.md

Project notes for Codex and other coding agents.

Read `CLAUDE.md` for the core project rules. This repository keeps the main
runtime, logging, type, test, lint, and layout guidance there so Claude and
Codex share one source of truth.

Current package, app, and example boundaries are documented in `CLAUDE.md` and
`docs/architecture.md`; keep agent-specific notes as pointers instead of
duplicating the layout rules here.

## PR review guidelines

When reviewing a pull request, lead with defects that could change behavior,
weaken trust boundaries, lose funds, leak private data, or make the protocol
harder to interoperate with. Treat style, naming, and wording as findings only
when they obscure a load-bearing requirement or public vocabulary.

Review against the PR's base branch and the current documented model, not
against older repository history. For stacked PRs, distinguish issues
introduced by the head branch from context inherited from the base PR.

For changes under `packages/`, check the relevant actor boundary:

- `packages/protocol/` defines interoperable Nostr/Cashu message formats.
- `packages/sdk/` owns Customer, Provider, Oracle, payment, proof, attachment,
  adapter, and request orchestration.
- Examples and apps must not become a second owner for reusable package logic.

For payment, verification, redemption, signing, auth, or quorum changes, look
for silent-bypass shapes: branches that appear valid but skip the load-bearing
check, catches that turn failure into success, or functions whose name promises
work they do not perform. Prefer a focused test or harness update over a broad
rewrite recommendation.

## Shared skills

- Canonical skill definitions live in `skills/<skill-name>/SKILL.md`.
- `.claude/skills` and `.codex/skills` must remain symlinks to `../skills`.
- Add or edit skills under `skills/` only. Do not create divergent copies under
  agent-specific directories.
- Keep `SKILL.md` content portable by default. If a skill needs Claude-only or
  Codex-only behavior, label that section explicitly.
- When a request matches an available skill, use that skill first. If the
  current agent does not expose the skill runner directly, follow the relevant
  `skills/<skill-name>/SKILL.md` manually.
