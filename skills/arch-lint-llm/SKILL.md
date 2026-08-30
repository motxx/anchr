---
name: arch-lint-llm
description: Review TypeScript architecture for semantic ownership violations that static lint cannot detect. Use for architecture reviews and substantial structural changes under packages/.
---

Review architecture without modifying files.

Run `deno task lint:arch --errors-only` first. Stop if it fails; static lint owns structural violations.

Read each relevant non-test file in full, plus the modules that share or should own its responsibility. If the user gives no scope, review changed `packages/*/src/**/*.ts(x)` files from `origin/main...HEAD` that have at least 150 lines.

Apply the single-purpose rule from `AGENTS.md`: every function, module, package, adapter, and public surface has one owner responsibility.

Report only findings supported by concrete code:

- **L001 Cohesion:** one module owns unrelated responsibilities.
- **L002 Service locator:** mutable ambient state hides I/O, configuration, or dependency injection.
- **L003 Duplication:** two owners implement the same decision, invariant, or state machine.
- **L004 Intimacy:** a module depends on another module's internals instead of its public API.
- **L005 Function responsibility:** one function contains independently replaceable responsibilities rather than orchestrating named parts.
- **L006 Domain leakage:** domain logic reads time, randomness, configuration, or I/O without an injected port.
- **L007 Boundary ownership:** a boundary becomes a second owner or bundles concerns that should remain independently replaceable.

Do not report file length, style, re-export-only barrels, tests, or rules already owned by static lint. When intent is unclear, do not guess.

For each finding, give severity, path and line, category, evidence, consequence, and the smallest ownership correction. Use HIGH for a concrete second owner, divergence risk, or blocked isolation; MEDIUM only when the structure is suspicious but may be intentional.

After a clean review, or after the user explicitly accepts every finding, record the exact reviewed diff:

```bash
deno run --allow-read --allow-run --allow-write --allow-env \
  scripts/arch-lint-llm-verify.ts --record
```
