---
name: arch-lint-llm
description: >-
  Review TypeScript architecture for semantic violations that `deno task
  lint:arch` cannot catch: god modules, hidden service locators, duplicated
  logic/state machines, inappropriate intimacy, oversized functions, domain
  leakage of time, I/O, randomness, or config without injected ports, and
  single-purpose boundary violations. Invoke after structural refactors, new
  ports/packages, or large changes under `packages/<pkg>/src/`, and before
  shipping a branch that touches substantial package files. Also invoke for
  "arch review", "architecture review", "semantic arch lint", "/arch-lint-llm",
  "single-purpose review", "UNIX design review", "アーキテクチャレビュー", or
  "アーキテクチャ違反チェック". Runs inside the existing session; no API key
  required.
disable-model-invocation: false
argument-hint: "[<file-or-glob>...]"
---

# Architecture Review (LLM)

Read the in-scope `.ts` / `.tsx` files, apply the rubric below, and report
findings inline. Do NOT modify any files — this is read-only review.

This skill owns the semantic half of architecture enforcement. The
deterministic half — package dependency direction, public-surface imports,
vocabulary leaks, env-read placement — is owned by `deno task lint:arch`;
its rule catalogue lives in `scripts/arch-lint.ts`.

## Scope

- **Include:** `packages/<pkg>/src/**/*.ts(x)`
- **Exclude:** `*.test.ts(x)`, `*.d.ts`, `dist/`, `node_modules/`
- `examples/`, `e2e/`, and `scripts/` are reviewed only when the user names
  them explicitly.

File selection, in order:

1. If the user supplies paths or globs as arguments, scan exactly those
   (still respecting the exclude list).
2. If files in scope were edited in the current session, scan those.
3. Otherwise scan the branch diff the pre-ship hook will check:
   `git diff --name-only origin/main...HEAD`, filtered to in-scope files
   with ≥150 lines. This is the set that must be reviewed before a push.
4. For a broader sweep, `deno task lint:arch:candidates` lists the largest
   files per package/group (`-- --full` for everything, `-- --layer <name>`
   for one group).

If nothing is in scope, say so and stop — do NOT scan the whole repository
unless the user explicitly asks.

## Step 0 — static lint must pass first

Semantic review only matters when the deterministic rules already hold:

```bash
deno task lint:arch --errors-only
```

If it reports errors, **stop** and tell the user to fix those first.

## Project design principle

Apply the UNIX-style rule from `CLAUDE.md`: each changed function, module,
package, adapter, or SDK surface should have one owner responsibility that
can be stated in a sentence. This is an ownership rule, not a line-count
rule.

## How to read each file

1. Read the **full** file — cohesion judgement needs context, not hunks.
2. When the file is half of a pair (an aggregate and its service, a port and
   its adapter), read both to detect duplication and intimacy.
3. Walk it against the seven categories below.
4. For each candidate, decide: real violation, or a documented negative case?
5. Lines ending with `// allow-arch: <reason>` are author-acknowledged — drop
   those candidates.

## Rubric — seven categories

### L001 — Cohesion / god module

A single file mixes unrelated responsibilities.

**Flag:**

- A router file serving five unrelated route families.
- A "service" file with a dozen unrelated `do*` methods spanning submit,
  expire, purge, quote, select, settle, and a publish helper.
- A package barrel that defines types + errors + the client + polling +
  an HTTP wrapper instead of re-exporting them.

**Do NOT flag:**

- Long files that are tightly cohesive (one purpose, just verbose).
- Re-export barrels (`index.ts`, `mod.ts`) that only re-export.
- Test-fixture files grouping several related fakes.

Evidence required: list 3+ distinct concerns the file owns and propose a
split in one sentence.

### L002 — Hidden service locator

Mutable module-level state acting as dependency injection.

**Flag:**

```ts
let _wallet: Wallet | null = null;
export async function getWallet(): Promise<Wallet> {
  if (!_wallet) _wallet = await createWallet(Deno.env.get("MINT_URL")!);
  return _wallet;
}
```

- Reads env at first call, caches a singleton, blocks per-test isolation.
- `export const store = new InMemoryStore();` — module-level mutable state.

**Do NOT flag:**

- Memoised pure functions (no env / I/O dependency).
- Module-level `const` holding a value object.
- Module-private state confined to a factory function.

### L003 — Logic duplication across files

Two files implement the same logic in parallel.

**Flag:**

- A lifecycle state machine implemented in both a domain aggregate and an
  application service.
- A timing-safe compare or an ID generator copy-pasted into two files.

Detect by **reading** both files, not by name matching. Quote the duplicated
bodies (or summarise structure if too long).

**Do NOT flag:**

- A port interface and its implementation sharing a name (contract vs
  definition).
- Test fixtures that re-create domain values.

### L004 — Inappropriate intimacy

A module reaches into another module's internals.

**Flag:**

- Importing a deep internal subpath of another package when a public entry
  point or port exists.
- Importing a test-only export (`_setFooForTest`) from non-test code.
- Depending on three concrete sub-files of another feature folder instead of
  its one stable interface.

**Do NOT flag:**

- Public package entry points (`@anchr/<pkg>` or its declared subpaths).
- A consumer importing a documented re-export.

### L005 — SRP violation within a function

A single function does N unrelated things.

**Flag:**

- A function that validates input, talks to an external service, mutates a
  store, fires hooks, AND returns a transformation — all inline, all >50
  lines.
- A body that splits naturally into ≥3 named, independently testable helpers.

**Do NOT flag:**

- Orchestrators that call a handful of named helpers (orchestration is one
  responsibility).
- Pure transformation pipelines of one-liners.

### L006 — Domain leakage

Pure domain code does I/O, time, or randomness without an injected port.

**Flag:**

- `Date.now()` inside an invariant check without a `Clock` port.
- Inline `crypto.getRandomValues` the caller cannot override.
- A direct `fetch(...)` or file read inside a domain function.
- Reading config from a global without injection.

In this repository the pure-domain area is `packages/sdk/src/requests/domain/`
and its ports (`Clock`, `IdGenerator`, `NonceGenerator`) are defined in
`packages/sdk/src/requests/domain/ports.ts`. Flag domain functions that should
accept a port but don't.

**Do NOT flag:**

- Adapter or runtime code using `Date.now()` — platform-aware layers may.
- Domain functions that already accept the relevant port via
  `options` / `services`.

### L007 — Single-purpose boundary violation

A changed boundary becomes a second owner for behavior that belongs
elsewhere, or bundles responsibilities that should stay independently
replaceable.

**Flag:**

- An actor SDK surface constructs concrete Nostr, Cashu, Blossom, TLSNotary,
  or HTTP clients instead of consuming injected ports.
- A convenience facade re-implements behavior owned by a lower-level module
  rather than delegating to it.
- One public surface mixes actor orchestration with adapter implementation,
  proof-engine policy, and runtime config.
- A migration adds the new owner while leaving the old owner active as a
  compatibility path.

**Do NOT flag:**

- Example- or app-owned composition that wires SDK, adapters, and product
  policy together without owning reusable semantics.
- Thin entry points that only re-export owned public surfaces.
- A cohesive adapter whose helpers all serve binding one technology to one
  port.

Evidence required: name the boundary, state its intended one-sentence
responsibility, identify the extra responsibility it took on, and name the
existing or proposed owner that should receive it.

## Explicit non-goals

Do **not** emit findings about:

- Anything `deno task lint:arch` already owns — see the rule catalogue at the
  top of `scripts/arch-lint.ts`. The static lint reports those itself.
- Pure style: formatting, naming, comments — unless they reveal a structural
  problem (e.g. a misleading file name).
- Anything you cannot back with concrete code evidence quoted from the file.

When in doubt, **don't** flag. False positives erode trust in this guard.

## Severity

- **HIGH** — clear structural violation with concrete cost: testability
  blocked, divergence bug risk, a second semantic owner created.
- **MEDIUM** — suspicious shape worth a human look; impact unclear without
  more context.
- **LOW** — suppress entirely.

L002 and L006 are usually HIGH (they block testability). L003 is HIGH when
the bodies have drifted, MEDIUM while identical. L001 is usually MEDIUM
unless the file is unambiguously a god module. L007 is HIGH when it creates
a second owner or makes an adapter hard to replace.

## Reporting format

If no findings:

```text
✓ arch-lint-llm: no semantic violations detected in <N> file(s)
```

If findings:

```text
✗ arch-lint-llm: <N> finding(s) — <H> HIGH, <M> MEDIUM

  [HIGH] packages/sdk/src/requests/domain/query.ts:53  L006 (domain-leakage)
      why:     expiry check uses Date.now() inline; Clock port exists in ports.ts but is not accepted
      excerpt: if (query.expires_at < Date.now()) { return { ...query, status: "expired" }; }
      fix:     thread `clock: Clock` through the function; default realClock at the call site
```

After the report:

- For HIGH findings, name the specific fix (introduce the port, delete the
  duplicate, split along the named seam).
- For MEDIUM findings, ask whether the pattern is intentional and offer to
  add `// allow-arch: <reason>` on the relevant line.

## Recording the verification

A PreToolUse hook (`scripts/arch-lint-llm-verify.ts`) denies `git push` and
`gh pr create` while the branch diff touches substantial package files
without a matching review record. When the review completes — no findings,
or the user has explicitly accepted them — write the record:

```bash
deno run --allow-read --allow-run --allow-write --allow-env \
  scripts/arch-lint-llm-verify.ts --record
```

The script computes the diff hash with the same scope filter the hook uses,
so the record always matches. Only write it when Step 0 passes and HIGH
findings are addressed. Any later edit to an in-scope file invalidates the
record automatically; re-run the review and re-record.

## Relationship to the other guards

- `deno task lint:arch` — deterministic import-graph and content rules; runs
  on every Edit/Write hook and in `lint:strict`.
- `deno task lint:arch:candidates` — pure file selection for broad sweeps.
- `/check-silent-bypass` — sibling semantic skill for trust-boundary bypass
  patterns in the same code.
- `docs/review-harness.md` — the routing table that says which guard owns
  which class of finding.

## Quick reference — what each surface should look like

- `packages/protocol/` — the Nostr/Cashu wire contract. Depends on no other
  `@anchr/*` package. Event helpers, schema identifiers, protocol types.
- `packages/sdk/` — actor orchestration (Customer / Provider / Oracle),
  payments, proofs, attachments, adapters. Depends only on
  `@anchr/protocol`. Pure request-lifecycle logic lives in
  `packages/sdk/src/requests/domain/` behind injected ports; adapters bind
  concrete technologies to those ports.
- `examples/`, `e2e/`, `scripts/` — reach Anchr through `@anchr/sdk` /
  `@anchr/protocol` public subpaths only.

If a file's contents disagree with this picture, that is where to look.
