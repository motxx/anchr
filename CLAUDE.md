# CLAUDE.md

Project notes Claude can't infer from the code. Everything else: read
the code and `docs/`.

## Runtime
- **Deno**, not Node. `deno run --allow-all`, `deno test`, `deno install`,
  `deno task <name>`. Never `npm`/`yarn`/`pnpm`/`ts-node`/`vitest`/`jest`.
- HTTP: `Deno.serve()` + Hono. WebSocket: built-in. Env: `Deno.env.get/set/delete`.
  Never `express`, `ws`, `process.env`, `dotenv`.
- Runtime helpers belong in `packages/sdk/src/` unless they define the
  interoperable Nostr/Cashu contract owned by `@anchr/protocol`.

## Logging
**No `console.*`** in `packages/` — emit through the shared
logtape-backed `getLogger`
(`packages/sdk/src/internal/runtime/logger.ts`).

## Type bar
`any` and double casts (`as unknown as T`) are forbidden everywhere in
`packages/` — `lint:types` hard errors. Plain `as` casts are warned:
narrow with type predicates instead; keep a cast only at a real parser
boundary, justified with `// type-lint-allow: <reason>`. `unknown` only
at boundaries (HTTP body, `JSON.parse`, `catch (err)`).

## Versioning (pre-1.0)
Delete replaced paths outright. No `@deprecated`, "legacy", or
"backward compat" shims. Lock new behaviour with a test. Enforced by
`lint:deprecation` (Markdown excluded).

## Comments
Default to none. Keep only when the WHY is non-obvious (hidden
invariant, referenced workaround, surprising ordering). Never narrate
history (`added for X` / `previously did Y`) — caught by
`lint:no-history-comments`.

## Documentation prose
Live docs, specs, README files, and architecture notes describe the current
target contract only. Do not include meta-commentary about removed designs,
discarded alternatives, or repository history when that history has no runtime
surface in the current code. Record durable trade-offs in ADRs only when they
meet the ADR bar; otherwise delete the historical explanation.

## Single-purpose design
Project architecture follows the UNIX rule: write components that do one thing
and do it well. This is a design gate, not a file-size rule.

Before accepting a proposed direction, check whether each changed function,
module, package, adapter, SDK, app, or example has one clear owner
responsibility that can be stated in a sentence. Stop and challenge proposals
that bundle unrelated responsibilities, hide concrete adapters behind SDKs,
make apps/examples own reusable package logic, or add "convenience" facades that
become second owners for existing behavior. Offer a smaller composition of
single-purpose parts instead.

## Verification bar
"Done" = local pass plus CI Docker coverage:
- `deno task test:all` — lint:strict + cargo dep audit + test:unit +
  test:integration + test:e2e:protocol + test:scripts + test:examples +
  Rust crate gate (clippy + cargo test, all four crates) +
  frost-signer build + test:e2e:frost. Needs the Rust toolchain.
- `deno task test:all:docker` — Docker-backed e2e
  (test:e2e:relay + test:e2e:regtest + test:e2e:tlsn). CI runs this on
  pull requests and main pushes; run it locally when changing Docker-backed
  e2e, compose infrastructure, or release-critical payment/proof paths.
- `deno task test:all:full` — both local and Docker-backed suites in one run.
- The pre-push hook runs `deno task test:all` with a 2-hour pass marker
  (`RUN_TESTS=1 git push` forces a local re-run). Docker-backed e2e is CI-only
  by default; run `deno task test:all:docker` explicitly when needed locally.

Use `docs/review-harness.md` to route recurring review findings to automated
checks, semantic skills, universal docs, or follow-up issues.

Issue creation captures the problem and constraints. Issue resolution re-reads
the current repository state and splits broad work into child issues with
`make-issues` before implementation when one coherent verified change would be
too large.

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
  `frost`, `tlsn`. Run via `deno task test:e2e:<bucket>`.

Adding a new test means dropping the file in the right place — no
`deno.json` edit. The `.unit.` / `.domain.` / `.application.` suffixes
are forbidden (single source of truth: `*.test.ts` *is* the unit tier).

## Lint
`deno task lint:strict` chains every gating lint. Rule catalogue and
allowed-package-deps map: `scripts/arch-lint.ts`. A fast subset runs on
every Edit/Write via PostToolUse hook; the full chain runs on every
commit via the pre-commit hook. Install hooks once with
`deno task setup:hooks`.

Threat-model invariants are drift-locked: every `INV-NN` in
`docs/threat-model.md` needs a matching test and a hash entry in
`docs/threat-model.lock.json` (`lint:invariants`). Editing an
invariant body means bumping its lock hash with a justification.

Shipping is gated: PreToolUse hooks block `git push` / `gh pr create`
until the `arch-lint-llm` and `check-silent-bypass` skills have
recorded a clean review of the exact `packages/` diff being shipped
(diff-hash records in `.arch-lint-llm-verified.json` /
`.silent-bypass-verified.json`; small diffs are exempt).

## Layout
- `packages/protocol/` — Nostr/Cashu v0 wire contract, event helpers,
  protocol types, schema identifiers, and Nostr compatibility helpers.
- `packages/sdk/` — Customer, Provider, Oracle orchestration, payment helpers,
  proof helpers, attachments, adapters, request internals, testing helpers, and
  the developer-facing SDK surface.
- `crates/<name>/` — Rust sidecar binaries (FROST release authority
  `frost-signer`, TLSNotary `tlsn-prover` / `tlsn-server` /
  `tlsn-verifier`). Built with
  `cargo build --release --manifest-path crates/<name>/Cargo.toml`;
  the Deno-only runtime rule does not apply here (toolchain pinned by
  `rust-toolchain.toml`, gated by clippy + cargo test in test:all).
- `examples/<name>/` — small demos, sketches, fixtures, and testnet flows.
  **Must reach Anchr through `@anchr/*` only** — relative paths into
  `packages/<pkg>/src/...` are an E023 violation (`e2e/` and `scripts/`
  are held to the same rule).
- `specs/` — wire-format specs (CC0)
- `docs/architecture.md` — package layout
- `docs/threat-model.md` — invariants
- `docs/issues/` — tracked issues (`pending/` → `closed/`); manage with
  the `make-issues` / `resolve-issues` skills.
- `CONTEXT.md` — domain glossary; use its vocabulary in code, docs, and
  specs.

Application vocabulary (`market`, `marketplace`, …) is forbidden in
`packages/` (E022). Concrete applications own their vocabulary in
`examples/<name>/`.

## Skill routing
When a request matches an available skill, invoke it via `Skill` as the
first action. Available skills appear in the system reminder; trust
their own descriptions.

Repository-local skills are shared with Codex. The canonical definitions live in
`skills/<skill-name>/SKILL.md`; `.claude/skills` and `.codex/skills` are symlinks
to that directory. Add or edit skills under `skills/` only.
