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
- Runtime compat layer at `src/runtime/mod.ts` provides: `spawn`, `readFile`, `writeFile`, `fileExists`, `fileLastModified`, `which`, `moduleDir`
- `WebSocket` is built-in. Don't use `ws`.

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

## Architecture Lint

`deno task lint:arch` enforces Clean Architecture layer dependencies:

| Rule | Layer | Must NOT import from |
|------|-------|---------------------|
| E001 | `domain/` | application, infrastructure, ui, runtime |
| E002 | `runtime/` | domain, application, infrastructure, ui |
| E003 | `ui/` | infrastructure, application |
| E004 | Any | `express`, `dotenv`, `ws` (banned packages) |
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
