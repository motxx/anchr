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

## Verification bar
"Done" = full local pass:
- `deno task test:all` — lint:strict + test:unit + test:integration +
  test:e2e:protocol + test:scripts + test:examples + test:e2e:frost +
  test:e2e:pentest
- `deno task test:all:docker` — Docker-backed e2e
  (test:e2e:relay + test:e2e:regtest + test:e2e:tlsn)

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
  `frost`, `tlsn`, `pentest`, `web`. Run via `deno task test:e2e:<bucket>`.

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
  `frost-oracle`, `cashu-conditional-swap`, `blossom`, `bounty`,
  `sdk`). The host implementation (Query lifecycle, escrow,
  oracle-client/service, worker-api, MCP) lives in
  `packages/bounty/src/{domain,application,infrastructure}/`.
- `example/<app>/` — concrete apps; their own deno.json + design
  system. **Must reach Anchr through `@anchr/*` only** — relative
  paths into `packages/<pkg>/src/...` are an E023 violation. The
  reference deployment is `example/anchr-reference-host/`.
- `specs/` — wire-format specs (CC0)
- `docs/architecture.md` — package layout
- `docs/threat-model.md` — invariants

Application vocabulary (`market`, `marketplace`, …) is forbidden in
`packages/` (E022). Concrete apps own their vocabulary in
`example/<app>/`.

## Skill routing
When a request matches an available skill, invoke it via `Skill` as the
first action. Available skills appear in the system reminder; trust
their own descriptions.
