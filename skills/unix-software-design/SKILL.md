---
name: unix-software-design
description: >-
  Apply Anchr's UNIX-style single-purpose design gate before implementation or
  during design review. Use for architecture proposals, package or adapter
  boundaries, SDK/app/example responsibility changes, broad refactors, issue
  splitting, "do one thing", "single purpose", "UNIX philosophy", or when a
  proposed direction may combine unrelated responsibilities.
---

# UNIX Software Design

Use this skill as a pre-implementation gate. Its job is to stop designs that
violate "write components that do one thing and do it well" and replace them
with a smaller composition of clear parts.

## First Response

When this skill triggers, inspect the relevant repository guidance first:

1. Read `CLAUDE.md` section `Single-purpose design`.
2. Read `docs/architecture.md` for the package, actor, adapter, app, and
   example boundaries touched by the request.
3. If code already exists, read the current owner modules before proposing a
   split.

## Gate

Before accepting a plan, ask whether every changed unit has one responsibility
that can be stated in one sentence:

- **Function:** one transformation, decision, I/O call, or orchestration.
- **Module:** one concept, policy, port, adapter, or cohesive helper family.
- **Package:** one public responsibility and one owner for its semantics.
- **SDK:** actor orchestration and ports, not concrete technology ownership.
- **Adapter:** one runtime or technology binding behind a stable port.
- **App/example:** composition and product policy, not reusable package logic.

If the answer is no, stop before implementation. Name the mixed
responsibilities and propose a smaller composition.

## Block These Directions

Challenge a proposal when it:

- Creates or expands a god module, catch-all service, or broad "manager".
- Moves concrete adapter work into an SDK or domain package.
- Makes apps or examples own logic that packages should own.
- Adds a convenience facade that becomes a second owner for existing behavior.
- Duplicates a state machine, settlement rule, verification policy, or protocol
  parser across packages.
- Hides I/O, time, randomness, config, or network clients behind implicit
  module state instead of injected ports.
- Combines migration cleanup, new behavior, and compatibility shims instead of
  directly moving callers to the new owner and deleting the replaced path.

## Allow These Shapes

Do not block designs merely because they are small, layered, or composed:

- A short orchestrator that calls named single-purpose helpers.
- A cohesive module with many lines but one clear concept.
- An app-owned composition that wires packages and adapters together.
- A package entry point that only re-exports owned public surfaces.

## Response Pattern

When blocking a direction, be direct:

```text
Blocked by single-purpose design:
- mixed responsibilities: <A>, <B>, <C>
- cost: <testability / ownership / duplication / replacement risk>
- replacement: <smaller composition of components>
```

When the direction passes:

```text
Single-purpose check passed: <unit> owns <one-sentence responsibility>.
```

Keep this skill focused on design shape. Use `arch-lint-llm` after code changes
to review implemented TypeScript architecture.
