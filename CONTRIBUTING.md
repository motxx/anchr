# Contributing

PRs welcome.

## Issues

This repository tracks issues as Markdown files in [`docs/issues`](docs/issues)
instead of GitHub Issues.

- Add new work items under `docs/issues/pending/` with the next number from
  `docs/issues/SEQUENCE`.
- Close work by moving the same file to `docs/issues/closed/` and adding a
  resolution note.
- Do not include sensitive security details in repo-tracked issue files.

See [`docs/issues/README.md`](docs/issues/README.md) for the file format and
workflow.

## Running the test suite

Three tiers, mapped 1:1 to deno tasks:

| Tier | Suffix / location | Task |
|---|---|---|
| **unit** | `packages/<pkg>/src/**/*.test.ts` (no I/O) | `deno task test:unit` |
| **integration** | `packages/<pkg>/src/**/*.integration.test.ts` (in-process HTTP/WS, no Docker) | `deno task test:integration` |
| **e2e** | `e2e/<bucket>/*.test.ts` (one bucket per infra profile) | `deno task test:e2e:<bucket>` |

```bash
deno task lint:strict           # deno lint + arch + invariants + paths + types
deno task test                  # unit + integration + e2e:protocol + scripts + examples (no Docker)
deno task test:unit             # all unit tests under packages/
deno task test:integration      # all *.integration.test.ts under packages/
deno task test:scripts          # lint script self-tests
deno task test:examples         # all example apps

# E2E buckets — directory = task = infra profile
deno task test:e2e:protocol     # pure protocol (no infra)
deno task test:e2e:relay        # Nostr relay + Blossom (Docker)
deno task test:e2e:regtest      # full Cashu + Lightning (Docker)
deno task test:e2e:frost        # FROST threshold signing (needs frost-signer binary)
deno task test:e2e:tlsn         # TLSNotary (needs verifier Docker + Rust prover binary)

./scripts/test-all.sh --local   # everything that does not need Docker (= what CI Phase 1 runs)
./scripts/test-all.sh --docker  # Docker-backed e2e buckets (relay + regtest + tlsn)
deno task test:all              # alias for --local
deno task test:all:docker       # alias for --docker
```

`test-all.sh --docker` runs Docker Compose with a worktree-derived project
name and host port block, so parallel worktrees get separate containers,
networks, volumes, and port bindings. It also tears down those containers and
volumes on exit. Plain `docker compose up` keeps the historical shared `anchr`
project and ports unless you explicitly source `scripts/docker-compose-env.sh`
with `ANCHR_DOCKER_ISOLATION=worktree`.

**Adding a new test:**
- Pure logic with no I/O → drop a `*.test.ts` next to the source under `packages/<pkg>/src/`.
- Needs in-process HTTP / WebSocket / Blossom → name it `*.integration.test.ts`.
- Needs external services → drop into the matching `e2e/<bucket>/`. The bucket *is* the deno task — no `deno.json` edit required.

CI gates `./scripts/test-all.sh --local` plus the Docker-backed e2e buckets.
Run the local script before pushing.

## Quality bar

Enforced by lint and CI; full detail in [`CLAUDE.md`](CLAUDE.md).

- Full TypeScript strict; no `--no-check` anywhere in test tasks.
- No `as` casts or `any` in `src/` or `packages/`. `unknown` only at
  HTTP / JSON boundaries with a `// type-lint-allow:` reason.
- Architecture lint enforces a single shared root (`core-runtime`); no
  other inter-package dependencies (`deno task lint:arch`).
- Every threat-model invariant must have a test
  (`deno task lint:invariants`).
- `console.*` in non-UI code routes through logTape via
  `@anchr/core-runtime/logger`.

## Local infrastructure

The full E2E suite needs Bitcoin regtest, a Cashu mint, a Nostr relay,
and Blossom storage:

```bash
docker compose up -d && sleep 25 && ./scripts/init-regtest.sh
deno task test:e2e:regtest
```

Use `deno task test:e2e:regtest`, `deno task test:e2e:tlsn`, or
`deno task test:all:docker` for the maintained deep flows. Keep any new
infrastructure instructions in this file, `deno.json`, or `scripts/` unless
they need a cross-file review rubric.
