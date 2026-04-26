---
description: Use Deno instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, deno.json"
alwaysApply: false
---

Default to using Deno instead of Node.js.

- Use `deno run --allow-all <file>` instead of `node <file>` or `ts-node <file>`
- Use `deno test` instead of `jest` or `vitest`
- Use `deno task build:ui` to build frontend bundles (esbuild under the hood)
- Use `deno install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `deno task <name>` instead of `npm run <name>` (tasks defined in `deno.json`)
- Use `npx <package> <command>` for CLI tools not yet on JSR
- Deno auto-loads `.env` via `--env` flag in task definitions. Don't use dotenv.

## Task completion (execute, then prove)

Follow the user's instructions to the end. A task is done when the requested work is actually performed and verified—not when it sounds done in prose.

- **Tests:** Run the tests (or checks) the task calls for. If you report that tests pass, include the relevant terminal output so the result is verifiable.
- **Browser / mobile / UI:** If verification requires a desktop browser, mobile web (responsive or device viewport), or a native/simulator flow (for example iOS Simulator, Android emulator, or physical device), do that verification and report with concrete evidence—screenshots, short screen recordings, simulator/device logs, or described observable state—not a generic "verified" or "works on mobile" claim.
- **Parallel work:** Wait for agents, subtasks, or CI-style checks to finish before writing a closing summary. Summarize outcomes after everything relevant has completed.
- **Tools and failures:** If a command or tool fails, returns an error, or yields an unexpected result, say so in the same turn and continue from the real state—do not imply success or skip over it.

Prefer running commands and using tools over telling the user what they could run. If something is blocked or out of scope, say that explicitly instead of marking the task complete.

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

Use `deno test` to run tests. Tests use JSR standard library:

```ts#index.test.ts
import { test } from "@std/testing/bdd";
import { expect } from "@std/expect";

test("hello world", () => {
  expect(1).toBe(1);
});
```

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
| `deno task lint:strict` | deno lint + arch + invariants + paths + refactor | No |
| `deno task test:packages` | per-package tests across all 7 workspace members | No |
| `deno task test:all` | deno lint + arch + invariants + paths + dep audit + unit + protocol + frost + integration + example + pentest | No |
| `deno task test:all:docker` | e2e relay + regtest (starts/stops Docker) | Yes |
| `deno task test:all:full` | all of the above combined | Yes |
| `./scripts/test-all.sh --ci` | same as full, CI-optimized | Yes |

Quality invariants the CI enforces:
- No `--no-check` in test tasks (full TypeScript checking)
- No `as unknown as` casts in source
- No dynamic `await import(...)` in libraries (only platform conditionals + scripts)
- No `process.env` in `src/`/`packages/` (use `Deno.env`)
- No `console.*` in `src/infrastructure/` or `packages/` (use `getLogger` from `@anchr/core-runtime/logger`)

## Type-safety bar

- `as` casts and `any` are forbidden in `src/` and `packages/`. Narrow with type predicates (`x is T`) or runtime helpers in `src/infrastructure/lib/runtime-types.ts`.
- `unknown` is allowed only at genuine boundaries (HTTP body parsing, `JSON.parse`, `catch (err)`) — narrow before use. Anywhere else, write the precise type.
- Enforced by `deno task lint:refactor` (runs in CI via `scripts/test-all.sh`).

## Verification bar

- A change is "done" only after a full local run passes: `deno task test:all` (lint + unit + protocol + frost + integration + example + pentest) **plus** `deno task test:all:docker` (Docker-backed e2e: relay + regtest). Don't claim done after only unit tests.
- If a test or check fails, fix the implementation. Do not skip the test, weaken the assertion, delete the case, or `--no-check` around it. Iterate on root cause until tests pass with the correct behavior.

## Architecture Lint

`deno task lint:arch` enforces Clean Architecture layer dependencies:

| Rule | Layer | Must NOT import from |
|------|-------|---------------------|
| E001 | `domain/` | application, infrastructure, ui, runtime |
| E002 | `runtime/` | domain, application, infrastructure, ui |
| E003 | `ui/` | infrastructure, application |
| E004 | Any | `express`, `dotenv`, `ws` (banned packages) |
| E005 | `application/` | infrastructure, ui, runtime |
| W001 | Any | npm: when JSR equivalent exists |

- Runs automatically on every Edit/Write via Claude Code hook (PostToolUse)
- Runs in CI before typecheck
- Errors (E*) cause non-zero exit; warnings (W*) are informational

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
