---
name: check-silent-bypass
description: >-
  Review recently-changed TypeScript in `packages/` for SILENT BYPASS
  patterns — code that looks normal but skips a load-bearing security or
  correctness check on a plausible-looking branch. **Invoke proactively**
  after editing files that touch verification, validation, settlement,
  redemption, authentication, authorization, escrow, payment, signing, or
  quorum logic, and before committing changes to those areas. Also invoke
  when the user says "silent bypass check", "silent bypass",
  "/check-silent-bypass", "サイレントバイパスチェック", or
  "バイパスチェック". Deterministic lints catch explicit stub markers; this
  skill catches semantic bypasses by reading code. Runs inside the existing
  session; no API key required.
disable-model-invocation: false
argument-hint: "[<file-or-glob>...]"
---

# Silent-Bypass Review

Read the in-scope `.ts` / `.tsx` files, apply the rubric below, and report
findings inline. Do NOT modify any files — this is read-only review.

## Scope

- **Include:** `packages/<pkg>/src/**/*.ts(x)`
- **Exclude:** `*.test.ts(x)`, `*.d.ts`, `packages/sdk/src/testing/`,
  `dist/`, `node_modules/`

UI, examples, and scripts are out of scope: silent bypass is a trust
enforcement concern, and trust is enforced in package code. Client-side
validation is a UX hint, not a security control.

File selection, in order:

1. If the user supplies paths or globs as arguments, scan exactly those
   (still respecting the exclude list).
2. If files in scope were edited in the current session, scan those.
3. Otherwise scan in-scope files from `git diff --name-only
   origin/main...HEAD`.
4. Otherwise scan unstaged in-scope files from `git diff --name-only HEAD`.

If nothing is in scope, say so and stop — do NOT scan the whole repository
unless the user explicitly asks.

## How to read each file

1. Read the **full** file — naming and return-type analysis need
   surrounding context, not just the diff hunk.
2. Walk the body looking for the three patterns below.
3. For each candidate, decide: real bypass, or a documented negative case?
4. Lines ending with `// allow-bypass: <reason>` are author-acknowledged —
   drop those candidates.

## Rubric — three patterns

### Pattern A — Trust boundary skipped on a plausible branch

A real validation path is gated behind a condition that *looks* like a
sanity check (well-formed input, expected prefix, common case), and the
other branch silently accepts the input without performing the check.

**Flag:**

```ts
if (token.startsWith("cashuB")) {
  const decoded = verify(token); // only well-formed tokens get verified
  return { valid: decoded.ok };
}
return { valid: true }; // anything else passes
```

```ts
if (env.NODE_ENV === "production") {
  await checkRateLimit(req);
}
return handler(req); // dev/test/staging skip the limit
```

**Do NOT flag:**

- Validation whose other branch returns a clear error
  (`return { ok: false, error: "..." }`).
- Type narrowing whose other branch is a compile-time impossibility
  (exhaustive switch with `assertNever`).
- Dispatch tables where each branch fully handles its own type.

### Pattern B — Error swallowed and converted to success

A try/catch wraps a load-bearing operation; the catch discards the error
and returns a success-shaped value, or the function reports success when
the operation provably failed.

**Flag:**

```ts
try {
  const decoded = getDecodedToken(token);
  return { ok: true, decoded };
} catch {
  return { ok: true }; // swallows the decode failure
}
```

```ts
const result = await db.update(...);
return { updated: true }; // ignores result.rowsAffected
```

**Do NOT flag:**

- A catch that logs and returns a clearly-failed result.
- A catch that re-throws or wraps the error.
- A catch handling one specific narrow error type and re-throwing the rest.
- Best-effort operations whose failure is documented as acceptable.

### Pattern C — Success claimed without doing the work

A function whose name implies a side effect (`settle`, `verify`,
`validate`, `persist`, `send`, `redeem`, `finalize`, `commit`, …) returns a
success-shaped value without performing it.

**Flag:**

```ts
async settle(token: string): Promise<{ settled: boolean }> {
  return { settled: true }; // name claims work, body does none
}
```

**Do NOT flag:**

- Functions named `is*`, `has*`, `can*`, `should*`, `get*`, `from*`,
  `format*`, `build*`, `compute*` — read-only by name.
- Stubs returning a clearly-failed result with an explicit error — loud
  failure is the correct surface.
- Pass-through wrappers that delegate.
- Idempotency short-circuits (`if (alreadySettled) return { settled: true };`).
- No-op defaults on a port interface the consumer is expected to override.

## Borderline cases — how to decide

The hardest call is "defensible default, or silent bypass?" Apply in order:

1. **Naming** — `verify`, `validate`, `authenticate`, `authorize`, `settle`,
   `redeem`, `persist`, `commit`, `finalize`, `enforce`, `require`,
   `assert`, `guard` promise a load-bearing check or side effect. Returning
   success without performing it is a bypass.
2. **Return shape** — `{ valid: boolean }` is a contract. Returning
   `{ valid: true }` from a path that did not validate breaks it;
   `{ ok: false, error }` is how a path says "I cannot honour this".
3. **Caller assumptions** — if upstream does `if (result.ok) proceed()`, a
   false positive is load-bearing. Purely advisory results are not.
4. **Symmetry** — the expected branch performs the check while the other
   silently doesn't. That asymmetry is the signal.

## Severity

- **HIGH** — clear bypass with security or correctness impact, or a
  function name that promises a guarantee its body does not honour.
- **MEDIUM** — suspicious shape worth a human look; impact unclear.
- **LOW** — suppress entirely.

When in doubt, lean towards NOT reporting. A missed bypass surfaces in the
next review; a flood of false positives trains the user to ignore the tool.

## Reporting format

If no findings:

```text
✓ check-silent-bypass: no silent-bypass patterns detected in <N> file(s)
```

If findings:

```text
✗ check-silent-bypass: <N> finding(s) — <H> HIGH, <M> MEDIUM

  [HIGH] packages/sdk/src/payments/redeem.ts:42  pattern=A
      why:     verify() runs only for cashuB tokens; others silently accepted as valid
      excerpt: if (token.startsWith("cashuB")) verify(token); else return { valid: true };
```

After the report:

- For HIGH findings, name the specific fix (restore the check on the other
  branch, return `{ ok: false, error }`, perform the side effect or rename
  the function).
- For MEDIUM findings, ask whether the pattern is intentional and offer to
  add `// allow-bypass: <reason>`.

## Recording the verification

A PreToolUse hook (`scripts/silent-bypass-verify.ts`) denies `git push` and
`gh pr create` while the branch diff touches load-bearing package files
without a matching review record. When the review completes — no findings,
or the user has explicitly accepted them — write the record:

```bash
deno run --allow-read --allow-run --allow-write --allow-env \
  scripts/silent-bypass-verify.ts --record
```

The script computes the diff hash with the same scope filter the hook uses,
so the record always matches. Only write it when HIGH findings are
addressed and the user has accepted any MEDIUM ones. Any later edit to an
in-scope file invalidates the record automatically; re-run and re-record.

## Relationship to the other guards

- `deno task lint:strict` — deterministic guards (explicit markers, type
  bar, invariant locks). Cheap and always-on, but a regex cannot see a
  branch that silently skips a check.
- `deno task lint:invariants` — locks the threat-model invariants this
  skill protects against drift.
- `/arch-lint-llm` — sibling semantic skill for structural smells in the
  same code.
- `docs/review-harness.md` — the routing table that says which guard owns
  which class of finding. New bypass shapes found in review get added to
  this rubric via that loop.
