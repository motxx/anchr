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

## Local hooks

Install [Deno](https://deno.com/) and
[gitleaks](https://github.com/gitleaks/gitleaks/releases), then enable the
repository-managed git hooks:

```bash
brew install gitleaks
# or
nix profile install nixpkgs#gitleaks

deno task setup:hooks
```

The pre-commit hook fails closed when `gitleaks` is not on `PATH`. This keeps
the local staged-change secret scan aligned with CI's gitleaks backstop instead
of silently relying on the post-push scan.

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

Lint and CI enforce the mechanical checks. Coding-agent rules that require
judgment live in [`AGENTS.md`](AGENTS.md).

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
