---
description: Use Deno instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, deno.json"
alwaysApply: false
---

## Deno over Node

- `deno run --allow-all <file>`, not `node` / `ts-node`
- `deno test`, not `jest` / `vitest`
- `deno install`, not `npm` / `yarn` / `pnpm install`
- `deno task <name>` for tasks defined in `deno.json`; `npx <pkg>` only for CLI not on JSR
- `.env` is loaded via `--env` in task definitions — don't use `dotenv`

## Import Map (deno.json)

JSR packages (supply-chain safe, no npm):
- `hono` → `jsr:@hono/hono`
- `zod` → `jsr:@zod/zod`
- `@noble/hashes` → `jsr:@noble/hashes`
- Test imports: `@std/testing/bdd` + `@std/expect`

npm packages (via `npm:` prefix):
- `@cashu/cashu-ts`, `nostr-tools`, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`
- React/UI: `react`, `react-dom`, `@tanstack/react-query`, `lucide-react`, `radix-ui`, `clsx`, `tailwind-merge`, `class-variance-authority`

## APIs

- `Deno.serve()` for HTTP servers. Use Hono for routing. Don't use `express`.
- `Deno.upgradeWebSocket()` for WebSocket support.
- Runtime compat layer at `packages/core-runtime/` exposes: `spawn`, `readFile`, `writeFile`, `fileExists`, `fileLastModified`, `which`, `moduleDir`. Import as `@anchr/core-runtime` (or subpaths like `@anchr/core-runtime/logger`).
- Env access: use `Deno.env.get/set/delete` — never `process.env` (caught by lint).
- `WebSocket` is built-in. Don't use `ws`.

## Logging

Use logTape via `@anchr/core-runtime/logger` (re-exposed for the host as `src/infrastructure/logger.ts`). Don't call `console.*` in `src/infrastructure/` or `packages/` — `console` is reserved for UI/scripts and the `log-stream` tee.

```ts
import { getLogger } from "@anchr/core-runtime/logger";
const log = getLogger(["anchr", "verifier"]);
log.info("verification passed", { queryId, oracleId });
```

The level is read from `ANCHR_LOG_LEVEL` (or `LOG_LEVEL`) — `info` by default.

## Testing

Tests use `@std/testing/bdd` (`describe`/`it`/`test`) + `@std/expect`. Run with `deno test`.

## Frontend

UI is pre-built with esbuild (`deno task build:ui`) and served as static files via Hono's `serveStatic`:

```ts
import { serveStatic } from "hono/deno";
app.get("/", serveStatic({ path: "./dist/ui/index.html" }));
app.get("/assets/*", serveStatic({ root: "./dist/ui/" }));
Deno.serve({ port }, app.fetch);
```

Run the server:
```sh
deno task build:ui && deno task build:css && deno task dev
```

## Test Commands

| Command | Scope | Docker |
|---------|-------|--------|
| `deno task lint` | recommended deno-lint rules + no-eval / no-self-compare / default-param-last | No |
| `deno task lint:strict` | deno lint + arch + invariants + paths + types + deprecation + no-history-comments + no-dynamic-import | No |
| `deno task test:packages` | per-package tests across all 7 workspace members | No |
| `deno task test:all` | deno lint + arch + invariants + paths + dep audit + unit + protocol + frost + integration + example + pentest | No |
| `deno task test:all:docker` | e2e relay + regtest (starts/stops Docker) | Yes |
| `deno task test:all:full` | all of the above combined | Yes |
| `./scripts/test-all.sh --ci` | same as full, CI-optimized | Yes |

Additional CI invariants beyond what the APIs / Logging sections already require: no `--no-check` in test tasks; no dynamic `await import(...)` in libraries (platform conditionals + scripts only). The dynamic-import rule is enforced by `deno task lint:no-dynamic-import`, which auto-exempts `node:*` targets, lines inside `if (import.meta.main)` blocks, test files, and the `scripts/`/`tools/`/`mobile/`/`e2e/`/`example/` directories. Per-line opt-out: `allow-dynamic-import: <reason>`.

## Type-safety bar

- `as` casts and `any` are forbidden in `src/` and `packages/`. Narrow with type predicates (`x is T`) or runtime helpers in `src/infrastructure/lib/runtime-types.ts`.
- `unknown` is allowed only at genuine boundaries (HTTP body parsing, `JSON.parse`, `catch (err)`) — narrow before use.
- Enforced by `deno task lint:types`. (`deno task lint:refactor` is a separate complexity / size lint — files >300 lines, functions >50 lines, cyclomatic complexity >10. Not chained into `lint:strict` by default.)

## Versioning + deprecation policy

Pre-1.0 (current): when a function, field, or endpoint is replaced, **delete the old path outright**. No `@deprecated` aliases, "legacy" fallbacks, or "backward compat" shims. If regression is the worry, lock the new behavior with a test.

Post-1.0 (future): `@deprecated` only on minor/patch boundaries, naming the introduce + remove versions (`@deprecated since v1.4, removed in v2.0. Use X.`). Major versions delete.

Enforced by `deno task lint:deprecation`, which bans `@deprecated`, "deprecated", "legacy", "backward(s) compat" in `*.ts`/`*.tsx`/`*.rs`. Per-line opt-out: `allow-deprecation-vocab: <reason>` (reserved for legitimate post-1.0 notices). Markdown is not scanned.

## Comments

Default to no comments. Delete any comment that restates the code, narrates the change ("added for X", "previously did Y", "belt and suspenders so…"), or paraphrases an explicit expression. Keep one only for a non-obvious WHY (hidden invariant, workaround for a referenced bug, surprising ordering). When editing, strip violating comments in the touched region — don't preserve them out of politeness.

## Verification bar

- A change is "done" only after a full local run passes: `deno task test:all` (lint + unit + protocol + frost + integration + example + pentest) **plus** `deno task test:all:docker` (Docker-backed e2e: relay + regtest). Don't claim done after only unit tests.
- If a test or check fails, fix the implementation. Do not skip the test, weaken the assertion, delete the case, or `--no-check` around it. Iterate on root cause until tests pass with the correct behavior.

## Architecture Lint

`deno task lint:arch` enforces Clean Architecture layer dependencies and content rules:

**Import rules (src/):**

| Rule | Layer | Must NOT import from |
|------|-------|---------------------|
| E001 | `domain/` | application, infrastructure |
| E004 | Any | `express`, `dotenv`, `ws` (banned packages) |
| E005 | `application/` | infrastructure |
| E009 | non-test code | `src/testing/` |
| E018 | `src/` | `@anchr/sdk` (the SDK is downstream of the host) |
| W001 | Any | npm: when JSR equivalent exists |

**Content rules (src/ and packages/):**

| Rule | Layer | Disallowed content |
|------|-------|-------------------|
| E007 | `domain/` | `Deno.*` (must wrap behind a port) |
| E008 | `application/` | `Deno.*` (inject a port) |
| E021 | `application/`, `infrastructure/` | `console.*` (use `@anchr/core-runtime/logger`; `src/infrastructure/log-stream.ts` is the sanctioned tee) |
| E022 | `src/`, `packages/` | application-layer vocabulary (`market`, `marketplace`) — concrete apps belong in `example/` |

**Package rules:**

| Rule | Constraint |
|------|-----------|
| E010-E017 | Per-package allowed-deps allowlist (see `scripts/arch-lint.ts` `ALLOWED_PACKAGE_DEPS`) |
| E020 | `packages/` must not import from `src/` (one-way: src → packages, never the reverse) |

Per-line opt-out for content rules: `// allow-arch: <reason>`. Reserve for genuinely sanctioned exceptions; the named-file exemption set in `arch-lint.ts` is preferred for stable carve-outs.

- Runs automatically on every Edit/Write via Claude Code hook (PostToolUse)
- Runs in CI before typecheck
- Errors (E*) cause non-zero exit; warnings (W*) are informational

## Design System

`DESIGN.md` is the source of truth for fonts, colors, spacing, and visual direction. Don't deviate without explicit approval; in QA mode, flag drift.

## Skill routing

When a request matches an available skill, invoke it via the `Skill` tool as the first action — don't answer directly or run other tools first. Available skills are listed in the system reminder; trust their own descriptions for routing.
