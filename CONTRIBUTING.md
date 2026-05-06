# Contributing

Issues and PRs welcome.

## Running the test suite

```bash
deno task lint:strict          # deno lint + arch + invariants + paths + types
deno task test:unit            # unit tests across packages
deno task test:packages        # per-package tests, each in isolation
deno task test:bounty          # Bounty pattern invariants (trustless / attacks / vulns / quorum)
deno task test:frost           # FROST threshold signing
deno task test:integration     # worker-api + MCP HTTP/stdio surface
deno task test:example         # all example apps
deno task test:scripts         # lint script self-tests
deno task test:pentest         # penetration tests
deno task test:relay           # Nostr relay + Blossom E2E (Docker)
deno task test:regtest         # full Cashu + Lightning E2E (Docker)
deno task test:tlsn            # TLSNotary E2E (needs verifier server + Rust prover binary)
./scripts/test-all.sh --local  # what CI runs in Phase 1
```

CI gates `./scripts/test-all.sh --local` plus `test:all:docker` for the
relay + regtest phases. Run the local script before pushing.

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
deno task test:regtest
```

The [`/test-regtest`](.claude/skills/test-regtest/SKILL.md) and
[`/test-tlsn`](.claude/skills/test-tlsn/SKILL.md) runbooks document the
deep flow.
