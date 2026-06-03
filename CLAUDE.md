# CLAUDE.md

Project notes Claude can't infer from the code. Everything else: read
the code and `docs/`.

## Runtime
- **Deno**, not Node. `deno run --allow-all`, `deno test`, `deno install`,
  `deno task <name>`. Never `npm`/`yarn`/`pnpm`/`ts-node`/`vitest`/`jest`.
- `.env` is loaded via `--env` in task definitions — never `dotenv`.
- HTTP: `Deno.serve()` + Hono. WebSocket: built-in. Env: `Deno.env.get/set/delete`.
  Never `express`, `ws`, `process.env`.
- Cross-runtime helpers (spawn, fs, which, env, logger) live in
  `@anchr/core-runtime`.

## Logging
`getLogger(["anchr", "<name>"])` from `@anchr/core-runtime/logger`.
**No `console.*`** in `packages/bounty/src/(application|infrastructure)/`
or any `packages/` (E021). Level read from `ANCHR_LOG_LEVEL` / `LOG_LEVEL`.

## Type bar
`as` and `any` forbidden everywhere in `packages/`. Narrow with type
predicates or `packages/bounty/src/infrastructure/lib/runtime-types.ts`.
`unknown` only at boundaries (HTTP body, `JSON.parse`, `catch (err)`).

## Versioning (pre-1.0)
Delete replaced paths outright. No `@deprecated`, "legacy", or
"backward compat" shims. Lock new behaviour with a test. Enforced by
`lint:deprecation` (Markdown excluded).

## Comments
Default to none. Keep only when the WHY is non-obvious (hidden
invariant, referenced workaround, surprising ordering). Never narrate
history (`added for X` / `previously did Y`) — caught by
`lint:no-history-comments`.

## Documentation prose
Live docs, specs, README files, and architecture notes describe the current
target contract only. Do not include meta-commentary about removed designs,
discarded alternatives, or repository history when that history has no runtime
surface in the current code. Record durable trade-offs in ADRs only when they
meet the ADR bar; otherwise delete the historical explanation.

## Single-purpose design
Project architecture follows the UNIX rule: write components that do one thing
and do it well. This is a design gate, not a file-size rule.

Before accepting a proposed direction, check whether each changed function,
module, package, adapter, SDK, app, or example has one clear owner
responsibility that can be stated in a sentence. Stop and challenge proposals
that bundle unrelated responsibilities, hide concrete adapters behind SDKs,
make apps/examples own reusable package logic, or add "convenience" facades that
become second owners for existing behavior. Offer a smaller composition of
single-purpose parts instead.

## Verification bar
"Done" = full local pass:
- `deno task test:all` — lint:strict + test:unit + test:integration +
  test:e2e:protocol + test:scripts + test:examples + test:e2e:frost +
  local static checks
- `deno task test:all:docker` — Docker-backed e2e
  (test:e2e:relay + test:e2e:regtest + test:e2e:tlsn)

Use `docs/review-harness.md` to route recurring review findings to automated
checks, semantic skills, universal docs, or follow-up issues.

Issue creation captures the problem and constraints. Issue resolution re-reads
the current repository state and splits broad work with `make-sub-issues`
before implementation when one coherent verified change would be too large.

Failed test → fix the implementation. Never skip, weaken, or
`--no-check`.

## Tests
Three tiers, one suffix per tier, directory = task:
- **Unit:** `*.test.ts` next to source under `packages/<pkg>/src/`. No
  I/O. Discovered by `deno task test:unit`.
- **Integration:** `*.integration.test.ts` next to source under
  `packages/<pkg>/src/`. In-process HTTP/WS/Blossom only. Discovered
  by `deno task test:integration`.
- **E2E:** `e2e/<bucket>/*.test.ts`. Bucket directory = infra profile
  = deno task name. Buckets: `protocol` (no infra), `relay`, `regtest`,
  `frost`, `tlsn`. Run via `deno task test:e2e:<bucket>`.

Adding a new test means dropping the file in the right place — no
`deno.json` edit. The `.unit.` / `.domain.` / `.application.` suffixes
are forbidden (single source of truth: `*.test.ts` *is* the unit tier).

## Lint
`deno task lint:strict` chains every gating lint. Rule catalogue and
allowed-package-deps map: `scripts/arch-lint.ts`. Full list runs on
every Edit/Write via PostToolUse hook and on every `git push` via
pre-commit hook.

## Layout
- `packages/` — independently-published primitives
  (`core-runtime`, `core-cashu`, `tlsn-toolkit`, `photo-verification`,
  `frost-oracle`, `cashu-conditional-swap`, `blossom`, `adapters`,
  `protocol`, `oracle-sdk`, `customer-sdk`, `provider-sdk`, `bounty`,
  `sdk`). Transitional Query lifecycle scaffolding lives in
  `packages/bounty/src/{domain,application,infrastructure}/`; new protocol,
  adapter, proof, settlement, and actor SDK surfaces belong in their named
  packages.
- `apps/<app>/` — maintained runnable product or adapter surfaces with their
  own runtime/config/ops policy. **Must reach Anchr through `@anchr/*` only** —
  relative paths into `packages/<pkg>/src/...` are an E023 violation.
- `examples/<name>/` — small demos, sketches, fixtures, and testnet flows.
  Same E023 public-surface rule as `apps/`.
- `specs/` — wire-format specs (CC0)
- `docs/architecture.md` — package layout
- `docs/threat-model.md` — invariants

Application vocabulary (`market`, `marketplace`, …) is forbidden in
`packages/` (E022). Concrete apps own their vocabulary in
`apps/<app>/` or `examples/<name>/`.

## Skill routing
When a request matches an available skill, invoke it via `Skill` as the
first action. Available skills appear in the system reminder; trust
their own descriptions.

Repository-local skills are shared with Codex. The canonical definitions live in
`skills/<skill-name>/SKILL.md`; `.claude/skills` and `.codex/skills` are symlinks
to that directory. Add or edit skills under `skills/` only.
