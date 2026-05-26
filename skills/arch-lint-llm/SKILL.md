---
name: arch-lint-llm
description: >-
  Review TypeScript architecture for semantic violations that `deno task
  lint:arch` cannot catch: god modules, hidden service locators, duplicated
  logic/state machines, inappropriate intimacy, oversized functions, and domain
  leakage of time, I/O, randomness, or config without injected ports. Also
  checks Anchr's single-purpose design rule in reviewed TypeScript: each
  changed function, module, package, adapter, or SDK surface should do one
  thing well. Invoke after structural refactors, new ports/packages, large
  layer-file changes, or before PRs touching `src/domain/`, `src/application/`,
  ports, or large
  `src/infrastructure/` files. Also invoke for "arch review", "architecture
  review", "semantic arch lint", "/arch-lint-llm", "single-purpose review",
  "UNIX design review", "アーキテクチャレビュー", or
  "アーキテクチャ違反チェック". Runs inside the existing Claude Code session; no
  API key required.
disable-model-invocation: false
argument-hint: "[<file-or-glob>...]"
---

# Architecture Review (LLM)

Read the relevant `.ts` / `.tsx` files, apply the rubric below, and report findings inline. Do NOT modify any files — this is read-only review.

## Scope

- **Include:** `src/**/*.ts(x)`, `packages/**/*.ts(x)`
- **Exclude:** `*.test.ts(x)`, `src/testing/`, `e2e/`, `scripts/`, `apps/`, `examples/`, `mobile/`, `dist/`, `node_modules/`

If the user supplies file paths or globs as arguments, scan exactly those (still respecting the exclude list). Otherwise, default behavior:

1. If the user just edited files in scope as part of the current turn, scan those edits.
2. Else, run `deno task lint:arch:candidates` to get the largest candidate files per layer (top 4 per layer ≈ 26 files) and scan those.
3. For a "full" review, run `deno task lint:arch:candidates -- --full` instead.
4. For a single-layer drill-down, `deno task lint:arch:candidates -- --layer <name>`.

If no files are in scope, say so and exit — do NOT scan the whole repo unless the user explicitly asks.

## Project design principle

Apply the UNIX-style project rule from `CLAUDE.md`: changed components should
do one thing and do it well. This is not a line-count or file-count rule. It is
an ownership rule: a function, module, package, adapter, or SDK surface should
have one responsibility that can be stated in one sentence.

For code review, enforce this rule only when the violation is visible in the
changed TypeScript architecture. Use `unix-software-design` before
implementation or while reviewing a proposal; use this skill after code exists.

## Auto-trigger

A single hook is wired in `.claude/settings.json`:

- **PreToolUse / Bash** → `scripts/arch-lint-llm-verify.ts`

  Fires only when the Bash command is a "shipping" verb (`git push`, `gh pr create`, including compound forms like `cd foo && git push` and env-prefixed forms like `CI=1 git push`). On match the hook:

  1. Computes the in-scope diff (TypeScript files in `src/(domain|application|infrastructure|ui)/` or `packages/<pkg>/src/`, ≥150 lines, excluding `*.test.ts(x)` and `*.d.ts`).
  2. SHA-256 hashes the diff content.
  3. Reads `.arch-lint-llm-verified.json` at the repo root.
  4. If the recorded hash matches the current diff hash → push proceeds with a brief acknowledgement.
  5. If the hash is missing or stale → push is denied with a list of the files that need review and instructions to invoke this skill.

  Other Bash commands, and pushes whose diff touches no substantial layer files, pass silently.

There are no per-edit nudges and no Stop-time reminders. The skill description above is what makes the model reach for the skill during interactive work; the hook is the deferred backstop that catches a forgotten review at ship time.

## Step 0 — verify the static lint passes first

Semantic review only matters when the static rules already hold. Run:

```bash
deno task lint:arch -- --errors-only
```

If it reports errors, **stop**. Tell the user to fix the static violations first. Do not proceed.

## How to read each file

For each file in scope:

1. Read the **full** file (not a hunk — context matters for cohesion judgement).
2. When the file is part of a pair (e.g. `query-aggregate.ts` ↔ `query-service-methods.ts`), read both to detect duplication and intimacy.
3. Walk it looking for the six categories below.
4. For each candidate site, decide: is this a real violation, or one of the documented negative cases?

Lines that end with `// allow-arch: <reason>` are author-acknowledged — drop those candidates.

## Rubric — seven categories

### L001 — Cohesion / god module

A single file mixes unrelated responsibilities.

**Flag this:**
- Routes for HTLC + DKG + verification + signer + signing-session all in one router file.
- A "service" file with 11 unrelated `do*` methods covering submit, expire, purge, quote, select, begin, record, complete, cancel, and a Nostr publish helper.
- An SDK barrel that defines types + errors + the client + polling + photo helpers + an HTTP wrapper.

**Do NOT flag:**
- Files >300 lines that are tightly cohesive (one purpose, just verbose).
- Re-export barrels (`index.ts`) that only re-export.
- Test fixture files that group several related fakes.

Evidence required: list 3+ distinct concerns the file owns, and propose a split (one sentence).

### L002 — Hidden service locator

Mutable module-level state acting as DI.

**Flag this:**
```ts
let _wallet: Wallet | null = null;
export async function getCashuWallet(): Promise<Wallet> {
  if (!_wallet) _wallet = await createWallet(Deno.env.get("CASHU_MINT_URL")!);
  return _wallet;
}
```
- Reads env at first call, caches a singleton, blocks per-test isolation.

**Flag this:**
```ts
export const queryStore = new InMemoryStore(); // module-level mutable
```

**Do NOT flag:**
- Memoised pure functions (no env / I/O dependency).
- Module-level `const` that holds a value object (e.g. `const NONCE_CHARS = "..."`).
- Module-private state confined to a factory function.

### L003 — Logic duplication across files

Two files implement the same logic in parallel.

**Flag this:**
- A state machine implemented both in `domain/foo-aggregate.ts` and `application/foo-service.ts`.
- A timing-safe `safeCompare` copy-pasted into two infra files.
- An ID generator `generateQueryId` defined in both domain and application.

Detect by **reading** both files, not by file-name matching. Quote the duplicated bodies (or summarise structure if too long).

**Do NOT flag:**
- A pure function and a port interface with the same name (one is a definition, the other is a contract).
- Test fixtures that re-create domain values (legitimate test scaffolding).

### L004 — Inappropriate intimacy

A module reaches into another module's internals.

**Flag this:**
- Imports from a deep subpath like `@anchr/frost-oracle/internal/signing-coordinator` when a public port exists.
- Imports a test-only export (`_setFooForTest`) from non-test code.
- A package depending on three concrete sub-files of another package instead of one stable interface.

**Do NOT flag:**
- Public package entry points (`@anchr/<pkg>` or its declared subpaths).
- A consumer importing a documented re-export.

### L005 — SRP violation within a function

A single function does N unrelated things.

**Flag this:**
- A function that validates input, talks to an external service, mutates store, fires hooks, AND returns a transformation — all inline, all >50 lines.
- A function whose body could be split into ≥3 named helpers, each independently testable.

**Do NOT flag:**
- Orchestrator functions that call a handful of named helpers (the orchestration itself is one responsibility).
- Pure transformation pipelines where each step is a one-liner (`return xs.filter(p).map(f).reduce(g, init)`).

### L006 — Domain leakage

Domain code does I/O, time, or randomness without injecting a port.

**Flag this:**
- `Date.now()` used inside an invariant check (`if (query.expires_at < Date.now())`) without a `Clock` port.
- Inline `crypto.getRandomValues` use that the caller cannot override (no `IdGenerator` / `NonceGenerator` port).
- A direct `fetch(...)` or file I/O inside a domain function.
- Reading config from a global without injection.

For anchr specifically, ports are defined in `src/domain/ports.ts` (`Clock`, `IdGenerator`, `NonceGenerator`). Flag domain functions that should accept a port but don't.

**Do NOT flag:**
- Application-layer code using `Date.now()` (allowed — application is platform-aware).
- Domain functions that already accept the relevant port via `options` / `services`.

### L007 — Single-purpose boundary violation

A changed boundary becomes a second owner for behavior that belongs somewhere
else, or combines responsibilities that should remain independently
replaceable.

**Flag this:**
- An actor SDK constructs concrete Nostr, Cashu, Blossom, TLSNotary, photo, or
  HTTP clients instead of consuming injected ports.
- A convenience package or facade re-implements behavior owned by a lower-level
  package rather than re-exporting or delegating to it.
- A package mixes actor orchestration with adapter implementation, proof engine
  policy, and runtime config in one public surface.
- A migration change adds the new owner while leaving the old owner active as a
  temporary facade or compatibility path.

**Do NOT flag:**
- App-owned composition that wires SDKs, adapters, config, and product policy
  together without owning reusable semantics.
- Thin package entry points that only re-export owned public surfaces.
- A cohesive adapter that contains several helpers needed to bind one concrete
  technology to one port.

Evidence required: name the boundary, state its intended one-sentence
responsibility, identify the extra responsibility it took on, and name the
existing or proposed owner that should receive that behavior.

## Explicit non-goals

You **must not** emit findings about:

- Layer crossings already enforced by the deterministic lint (E001 / E003 / E005 / E006). The static lint owns those.
- Banned packages (E004), `Deno.*` in domain (E007 content rule), `console.*` in application/infrastructure (E021), domain-purity import bans (E007 import rule), application `Deno.*` direct calls (E008), `src/testing/` import from non-test (E009), src→@anchr/sdk (E018), packages→src (E020).
- Pure style: formatting, naming, comments — unless they reveal a structural problem (e.g. a misleading file name).
- Things you cannot back with concrete code evidence quoted from the file.

When in doubt, **don't** flag. False positives erode trust in this guard.

## Severity

- **HIGH** — clear structural violation with concrete cost: testability blocked, bug risk from divergence, cross-layer leakage that will compound.
- **MEDIUM** — suspicious shape worth a human look, but the impact is unclear without more context (e.g. mid-size cohesion smells, partial intimacy).
- **LOW** — suppress entirely. If the only argument for "smell" is style or aesthetic, do not report.

A cohesion finding (L001) is usually MEDIUM unless the file is unambiguously a god module. Service-locator (L002) and domain-leak (L006) are usually HIGH because they block testability. Duplication (L003) is HIGH when the bodies actually drift; MEDIUM if they're identical and harmless today.
Single-purpose boundary violations (L007) are usually HIGH when they create a
second semantic owner or make a concrete adapter hard to replace; MEDIUM when
the ownership risk is real but still local.

## Reporting format

If no findings:
```
✓ arch-lint-llm: no semantic violations detected in <N> file(s)
```

If findings:
```
✗ arch-lint-llm: <N> finding(s) — <H> HIGH, <M> MEDIUM

  [HIGH] src/domain/query-aggregate.ts:53  L006 (domain-leakage)
      why:     submitResult uses Date.now() inline; domain has Clock port at src/domain/ports.ts but doesn't accept it
      excerpt: if (query.expires_at < Date.now()) { return { ... status: "expired" }; }
      fix:     thread `clock: Clock` through submitResult/recordResult, default realClock at the call site

  [HIGH] src/application/query-service-methods.ts:166  L003 (duplication)
      why:     generateQueryId duplicates src/domain/query-aggregate.ts:42 — both call randomBytes
      excerpt: function generateQueryId(): string { return `query_${Date.now()}_${randomBytes(8).toString("hex")}`; }
      fix:     delete the application copy; have doCreateQuery delegate to createQueryAggregate

  [MEDIUM] src/infrastructure/oracle/oracle-server.ts:1  L001 (cohesion)
      why:     481-line router mixing 5 unrelated route families (HTLC + verify + FROST signer + DKG + signing sessions)
      excerpt: (file overview — too large to quote)
      fix:     split into oracle/htlc-routes.ts, verify-routes.ts, frost-signer-routes.ts, frost-dkg-routes.ts, frost-sign-routes.ts; compose in buildOracleApp
```

After the report, suggest the next step:

- For HIGH findings: name the specific fix (introduce the port, delete the duplicate, split the file along the named seam).
- For MEDIUM findings: ask the user to confirm whether the pattern is intentional, and offer to add `// allow-arch: <reason>` on the relevant line if so.

Do NOT modify any files automatically — this skill is read-only review. Wait for the user to direct the fix.

## Recording the verification (lifts the pre-ship hook)

When the review completes — findings absent, or the user has explicitly accepted them in this session — write `.arch-lint-llm-verified.json` at the repo root so the pre-ship hook recognises the diff as reviewed:

```bash
deno run --allow-read --allow-run --allow-write --allow-env - <<'JS'
const root = (await new Deno.Command("git", { args: ["rev-parse", "--show-toplevel"], stdout: "piped" }).output()).stdout;
const repo = new TextDecoder().decode(root).trim();
const base = Deno.env.get("ARCH_BASE") ?? "origin/main";
const names = await new Deno.Command("git", {
  args: ["diff", "--name-only", `${base}...HEAD`],
  cwd: repo,
  stdout: "piped",
}).output();
const inScope = new TextDecoder().decode(names.stdout).split("\n")
  .map((s) => s.trim())
  .filter((f) =>
    /^(src\/(domain|application|infrastructure|ui)|packages\/[^/]+\/src)\/.+\.(ts|tsx)$/
      .test(f) &&
    !f.endsWith(".test.ts") && !f.endsWith(".test.tsx") && !f.endsWith(".d.ts")
  );
const filtered: string[] = [];
for (const f of inScope) {
  try {
    const txt = await Deno.readTextFile(`${repo}/${f}`);
    if (txt.split("\n").length >= 150) filtered.push(f);
  } catch {}
}
filtered.sort();
const diff = await new Deno.Command("git", {
  args: ["diff", `${base}...HEAD`, "--", ...filtered],
  cwd: repo,
  stdout: "piped",
}).output();
const hashBuf = await crypto.subtle.digest("SHA-256", diff.stdout);
const hash = Array.from(new Uint8Array(hashBuf))
  .map((b) => b.toString(16).padStart(2, "0")).join("");
const record = {
  diff_sha256: hash,
  reviewed_at: new Date().toISOString(),
  files: filtered,
};
await Deno.writeTextFile(`${repo}/.arch-lint-llm-verified.json`, JSON.stringify(record, null, 2) + "\n");
console.log("✓ wrote", `${repo}/.arch-lint-llm-verified.json`);
JS
```

(The hook uses the same scope filter and the same diff range, so the hash is reproducible.) Only write the record when Step 0 (static lint) passes and HIGH findings are addressed.

## Relationship to the other guards

- `deno task lint:arch` (deterministic, runs on every Edit/Write hook + `lint:strict`) — catches import-graph violations and content patterns the regex can encode (codes E001-E021). Mechanical, zero false positives, but cannot see semantic smells.
- `deno task lint:arch:candidates` (deterministic helper) — picks the largest non-test files per layer for review. No analysis, just selection.
- `/check-silent-bypass` (sibling skill) — reviews for silent-bypass patterns in verification / settlement / auth code. Same skill pattern, different rubric.
- This skill — runs inside the existing Claude Code session, no API key needed. Best for interactive review during a coding session or before a PR.

The four are complementary, not redundant: the deterministic lint catches structural violations cheaply, the candidate helper picks files to review, this skill catches semantic smells during editing, and `check-silent-bypass` covers the security side of the same pattern.

## Quick reference — what each layer should look like

- `src/domain/`: pure business logic. Functions take values in, return values out. No `Date.now()` inside invariants — accept a `Clock` port. No I/O. No randomness without `IdGenerator` / `NonceGenerator`.
- `src/application/`: orchestrates use cases. Defines ports (`escrow-port.ts`, `oracle-port.ts`, `frost-signature-port.ts`, etc.). Calls domain functions. Does not call `Deno.*` directly.
- `src/infrastructure/`: implements ports. May talk to HTTP, DB, Cashu, Nostr, FROST. The only layer allowed to call `Deno.*` and external SDKs.
- `src/ui/`: React frontend. Imports types from domain, calls the worker API via `src/ui/api-config.ts::apiFetch`.
- `packages/sdk/`: downstream-consumer SDK. Should be platform-neutral; depends only on `@anchr/core-runtime`.

If a file's contents disagree with this picture, that's where to look.
