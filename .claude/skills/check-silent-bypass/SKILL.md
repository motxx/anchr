---
name: check-silent-bypass
description: Review recently-changed TypeScript code in src/ and packages/ for SILENT BYPASS patterns — code that looks normal but skips a load-bearing security or correctness check on a plausible-looking branch. **Invoke this skill proactively** after editing or writing files that touch verification, validation, settlement, redemption, authentication, authorization, escrow, payment, signing, or quorum logic. Also invoke before committing changes that touch those areas, when finishing a task that modified verifier/validator/escrow/auth code, or when the user says "silent bypass check", "silent bypass", "/check-silent-bypass", "サイレントバイパスチェック", or "バイパスチェック". This is the LLM-driven counterpart to the deterministic `deno task lint:no-stubs` — that lint catches explicit stub markers via regex, this skill catches semantic bypasses by reading code. Runs inside the existing Claude Code session, no API key required.
disable-model-invocation: false
argument-hint: "[<file-or-glob>...]"
---

# Silent-Bypass Review

Read the in-scope `.ts` / `.tsx` files, apply the rubric below, and report findings inline. Do NOT modify any files — this is read-only review.

## Scope

- **Include:** `src/(domain|application|infrastructure)/**/*.ts(x)`, `packages/<pkg>/src/**/*.ts(x)`
- **Exclude:** `*.test.ts(x)`, `*.d.ts`, `src/testing/`, `src/ui/`, `e2e/`, `scripts/`, `example/`, `mobile/`, `dist/`, `node_modules/`

`src/ui/` is intentionally out of scope: silent bypass is a server-side trust enforcement concern, and the browser cannot enforce trust. Form validation in UI is a UX hint, not a security control.

If the user supplies file paths or globs as arguments, scan exactly those (still respecting the exclude list). Otherwise, default behaviour:

1. If you (Claude) just edited files in scope as part of the current turn, scan those edits.
2. Else, run `git diff --name-only origin/main...HEAD` and scan in-scope files from the diff.
3. Else, run `git diff --name-only HEAD` and scan unstaged in-scope files.

If no files are in scope, say so and stop — do NOT scan the whole repository unless the user explicitly asks.

## Auto-trigger

A single hook is wired in `.claude/settings.json`:

- **PreToolUse / Bash** → `scripts/silent-bypass-verify.ts`

  Fires only when the Bash command is a "shipping" verb (`git push`, `gh pr create`, including compound forms like `cd foo && git push` and env-prefixed forms like `NODE_ENV=prod git push`). On match the hook:

  1. Computes the in-scope diff (load-bearing files in `src/(domain|application|infrastructure)/` or `packages/<pkg>/src/`, ≥50 lines).
  2. SHA-256 hashes the diff content.
  3. Reads `.silent-bypass-verified.json` at the repo root.
  4. If the recorded hash matches the current diff hash → push proceeds with a brief acknowledgement.
  5. If the hash is missing or stale → push is denied with a list of the files that need review and instructions to invoke this skill.

  Other Bash commands, and pushes whose diff touches no load-bearing files, pass silently.

There are no per-edit nudges and no Stop-time reminders. The skill description above is what makes the model reach for the skill during interactive work; the hook is the deferred backstop that catches a forgotten review at ship time.

## How to read each file

For each file in scope:

1. Read the **full** file (not just the diff hunk — naming and return-type analysis need surrounding context).
2. Walk the body looking for the three patterns below.
3. For each candidate, decide: real bypass or one of the documented negatives?
4. Lines ending with `// allow-bypass: <reason>` are author-acknowledged — drop those candidates.

## Rubric — three patterns

### Pattern A — Trust-boundary skipped on a plausible branch

A real validation path is gated behind a condition that *looks* like a sanity check (well-formed input shape, expected prefix, common case), and the "other" branch silently accepts the input without performing the check.

**Flag this:**
```ts
if (token.startsWith("cashuB")) {
    const decoded = verify(token);          // ← only well-formed
    return { valid: decoded.ok };           //   tokens get verified
}
return { valid: true };                      // ← anything else passes
```

**Flag this:**
```ts
if (env.NODE_ENV === "production") {
    await checkRateLimit(req);
}
return handler(req);                         // ← dev/test/staging skip
```

**Do NOT flag:**
- Validation that returns a clear error on the "other" branch (`return { ok: false, error: "..." }`).
- Type narrowing whose "other" branch is a compile-time impossibility (exhaustive switch with `assertNever`).
- Dispatch tables where each branch fully handles its own type (`if (escrow.type === "htlc") return verifyHtlc(...); if (escrow.type === "p2pk_frost") return verifyFrost(...);`).

### Pattern B — Error swallowed and converted to success

A try/catch wraps a load-bearing operation; the catch discards the error and returns a success-shaped value, OR the function returns success when the operation provably failed.

**Flag this:**
```ts
try {
    const decoded = getDecodedToken(token);
    return { ok: true, decoded };
} catch {
    return { ok: true };                     // ← swallows decode failure
}
```

**Flag this:**
```ts
const result = await db.update(...);
return { updated: true };                    // ← ignores result.rowsAffected
```

**Do NOT flag:**
- Catch that LOGS the error and returns a clearly-failed result (`catch (err) { log.error(err); return { ok: false, error: err.message }; }`).
- Catch that re-throws or wraps the error.
- Catch handling a SPECIFIC narrow error type and re-throwing everything else.
- Optional best-effort operations whose failure is documented as OK.

### Pattern C — Function returns success without doing claimed work

A function whose name implies a side effect (`settle`, `verify`, `validate`, `persist`, `send`, `redeem`, `finalize`, `commit`, …) returns a success-shaped value without performing that side effect.

**Flag this:**
```ts
async settle(token: string): Promise<{ settled: boolean }> {
    return { settled: true };                // ← name claims work, body none
}
```

**Do NOT flag:**
- Functions named `is*`, `has*`, `can*`, `should*`, `get*`, `from*`, `format*`, `build*`, `compute*` — read-only by name.
- Stubs returning a clearly-failed result with an explicit error (`return { settled: false, error: "...not wired through this path..." };` is the correct loud-failure surface).
- Pass-through wrappers that delegate to another function.
- Idempotency short-circuits (`if (alreadySettled) return { settled: true };`).
- No-op default implementations on a port interface where the consumer is expected to override.

## Borderline cases — how to decide

The hardest call is "is this branch a defensible default, or a silent bypass?" Use these heuristics in order:

1. **Naming** — what does the function name promise? `verify`, `validate`, `authenticate`, `authorize`, `settle`, `redeem`, `persist`, `commit`, `finalize`, `enforce`, `require`, `assert`, `guard` all promise a load-bearing side effect or check. If the body returns success without performing it, that is a bypass.
2. **Return shape** — `{ valid: boolean }` is a contract. Returning `{ valid: true }` from a path that did not validate breaks it. `{ ok: false, error: string }` is the correct way to say "I cannot honour this contract."
3. **Caller assumptions** — if upstream code does `if (result.ok) proceed()`, a false-positive `{ ok: true }` is load-bearing. If the result is purely advisory (logging, metrics), it is not.
4. **Symmetry** — does the "expected" branch perform the check while the "other" branch silently doesn't? That asymmetry is the signal.

## Severity

- **HIGH** — clear bypass with security or correctness impact, OR the function name implies a load-bearing guarantee and the body fails to honour it.
- **MEDIUM** — suspicious shape worth a human look, but the impact is unclear without more context.
- **LOW** — suppress entirely. False positives erode trust in this guard.

When in doubt, lean towards NOT reporting. A missed real bypass will surface in the next review; a flood of false positives trains the user to ignore the tool.

## Reporting format

If no findings:
```
✓ check-silent-bypass: no silent-bypass patterns detected in <N> file(s)
```

If findings:
```
✗ check-silent-bypass: <N> finding(s) — <H> HIGH, <M> MEDIUM

  [HIGH] src/path/file.ts:42  pattern=A
      why:     verify() is only called for cashuB tokens; non-cashuB tokens silently accepted as valid
      excerpt: if (token.startsWith("cashuB")) verify(token); else return { valid: true };

  [MEDIUM] packages/sdk/src/foo.ts:88  pattern=B
      why:     catch returns { ok: true } after a decode failure that the caller treats as authoritative
      excerpt: try { decode(input); } catch { return { ok: true }; }
```

After the report, suggest the next step:

- For HIGH findings: name the specific fix (restore the check on the "other" branch, return `{ ok: false, error: "..." }` instead, perform the side effect or rename the function).
- For MEDIUM findings: ask the user to confirm whether the pattern is intentional, and offer to add `// allow-bypass: <reason>` if so.

This skill is read-only review. Do not modify files automatically.

## Recording the verification (lifts the pre-ship hook)

When the review completes — findings absent, or the user has explicitly accepted them in this session — write `.silent-bypass-verified.json` at the repo root so the pre-ship hook recognises the diff as reviewed:

```bash
deno run --allow-read --allow-run --allow-write --allow-env - <<'JS'
const root = (await new Deno.Command("git", { args: ["rev-parse", "--show-toplevel"], stdout: "piped" }).output()).stdout;
const repo = new TextDecoder().decode(root).trim();
const base = Deno.env.get("BYPASS_BASE") ?? "origin/main";
const names = await new Deno.Command("git", {
  args: ["diff", "--name-only", `${base}...HEAD`],
  cwd: repo,
  stdout: "piped",
}).output();
const inScope = new TextDecoder().decode(names.stdout).split("\n")
  .map((s) => s.trim())
  .filter((f) =>
    /^(src\/(domain|application|infrastructure)|packages\/[^/]+\/src)\/.+\.(ts|tsx)$/
      .test(f)
  );
const filtered: string[] = [];
for (const f of inScope) {
  try {
    const txt = await Deno.readTextFile(`${repo}/${f}`);
    if (txt.split("\n").length >= 50) filtered.push(f);
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
await Deno.writeTextFile(`${repo}/.silent-bypass-verified.json`, JSON.stringify(record, null, 2) + "\n");
console.log("✓ wrote", `${repo}/.silent-bypass-verified.json`);
JS
```

(The hook uses the same scope filter and the same diff range, so the hash is reproducible.) Only write the record when HIGH findings are addressed and the user has accepted any MEDIUM ones.

## Relationship to `lint:no-stubs`

- `deno task lint:no-stubs` (deterministic, always-on in `lint:strict`) — catches explicit TODO/FIXME/placeholder identifiers via regex. Mechanical, zero false positives, but cannot see semantic bypasses (the body of an `if` branch that silently skips a check still looks like normal code to a regex).
- This skill — applies the three-pattern rubric the deterministic lint cannot encode. Runs inside the existing Claude Code session, no API key needed. Best invoked while the user is actively editing verifier / escrow / auth code, or before committing changes to those areas.

The two are complementary: the deterministic lint catches explicit markers (cheap, always-on); this skill catches semantic bypasses (more expensive, invoked when the diff justifies it).
