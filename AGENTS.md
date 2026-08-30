# AGENTS.md

Project rules that coding agents cannot reliably infer from the repository.
Use `docs/architecture.md` for ownership and dependency boundaries,
`CONTEXT.md` for domain vocabulary, and `deno.json` for available commands.

## Editing rules

- Do not use `console.*` in `packages/`. Use the shared LogTape-backed logger.
- Do not introduce `any` or double casts in `packages/`. Prefer type predicates;
  keep `unknown` and justified casts at parser or I/O boundaries.
- Before 1.0, delete replaced implementation paths. Do not add compatibility
  aliases, deprecated shims, or parallel implementations. Required
  agent-entrypoint symlinks are exempt. Lock changed behavior with a test.
- Use top-level imports. Dynamic and type-position import expressions require a
  same-line `// allow-dynamic-import: <reason>`. Dynamic `node:*` imports and
  imports inside an `import.meta.main` entrypoint block are exempt.
- Comments explain only a non-obvious current reason, invariant, workaround, or
  ordering constraint. Do not narrate change history.
- Live documentation describes current behavior. Put durable design trade-offs
  in an ADR; otherwise remove historical explanation.
- Give each function, module, package, adapter, public surface, app, and example
  one owner responsibility. Challenge convenience layers that duplicate an
  existing owner or bundle independently replaceable concerns.

## Tests and completion

- Unit tests are `*.test.ts` beside package source and perform no I/O.
- In-process HTTP, WebSocket, or Blossom tests are
  `*.integration.test.ts` beside package source.
- Tests requiring external services belong in the matching `e2e/<bucket>/`.
- A failed check is fixed, not skipped, weakened, or run with `--no-check`.
- Run focused checks while editing and `deno task test:all` before completion.
  Run `deno task test:all:docker` when changing Docker-backed E2E,
  infrastructure, or release-critical payment and proof paths.
- Keep each `INV-NN` threat-model invariant linked to a test and its lock-file
  hash; changing the invariant requires a stated justification.
- Before shipping substantial package changes, run `arch-lint-llm`. Also run
  `check-silent-bypass` for payment, verification, settlement, redemption,
  authentication, authorization, signing, or quorum changes.

## PR review guidelines

Lead with defects that could change behavior, weaken trust boundaries, lose
funds, leak private data, or reduce interoperability. Treat style, naming, and
wording as findings only when they obscure a load-bearing requirement or public
vocabulary.

Review against the PR base and current documented model. For stacked PRs,
separate defects introduced by the head branch from inherited context.

For changes under `packages/`, verify that:

- `packages/protocol/` remains the sole owner of interoperable Nostr and Cashu
  message formats;
- `packages/sdk/` owns actor orchestration and runtime implementations;
- apps and examples do not become another owner of reusable package behavior.

For payment, verification, redemption, signing, authentication, authorization,
or quorum changes, look for plausible branches that skip the load-bearing
check, turn failure into success, or promise work they do not perform. Prefer a
focused regression test over a broad rewrite recommendation.

## Shared skills

- Canonical skill definitions live in `skills/<skill-name>/SKILL.md`.
- `.claude/skills` and `.codex/skills` remain symlinks to `../skills`.
- Edit skills under `skills/` only. Keep them portable unless a section is
  explicitly agent-specific.
- When a request matches an available skill, use it first. If no skill runner is
  exposed, follow its `SKILL.md` directly.
