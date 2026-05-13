# MCP アダプターを切り出す

Created: 2026-05-09
Model: Codex GPT-5
Completed: 2026-05-13

## Priority

maintenance

## Dependencies

Depends on:
- #0001 - 三者アーキテクチャを確定する
- #0002 - bounty を SDK に分割する

Blocks:
- #0004 - Reference Host を削除する

## Summary

MCP 対応を core SDK paths から外し、CLI、HTTP gateway、Discord bot、Web UI 統合と並ぶ一つのアダプター兼 example として扱う。

## Rationale

MCP は agent runtime integration であり、Anchr protocol の一部ではない。SDK から `@modelcontextprotocol/sdk` への依存を取り除くことで、ブラウザービルドを小さく保ち、SDK が主要な統合面であることを明確にする。

## Plan

- MCP の統合点として `example/anchr-mcp/` を作成または更新する。
- protocol と actor SDK packages から MCP 依存を取り除く。
- その方針を維持する場合は、`anchr-reference-host` を `anchr-mcp` に置き換えて example 数を安定させる。

## Resolution

Implemented by updating:

- `example/anchr-mcp/`
- `example/data-marketplace/server.ts`
- `example/data-marketplace/src/mcp-marketplace-handlers.ts`
- `example/anchr-reference-host/`
- `packages/bounty/deno.json`
- `packages/bounty/src/infrastructure/runtime.ts`
- `packages/bounty/src/mod.ts`
- `packages/bounty/src/domain/types.ts`
- `docs/architecture.md`
- `deno.json`

Verified with:

- `deno check packages/bounty/src/mod.ts example/anchr-mcp/server.ts example/data-marketplace/server.ts`
- `deno test --allow-all example/anchr-mcp/src/`
- `deno test --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys --config packages/bounty/deno.json packages/bounty/src/infrastructure/worker-api.test.ts packages/bounty/src/infrastructure/worker-api-auth.test.ts packages/bounty/src/infrastructure/worker-api.integration.test.ts`
- `deno task lint:strict`
- `deno task test:unit`
- `deno task test:examples`
- `deno task test:all`
- `deno task test:all:docker`

Harness update:

- MCP adapter tests moved under `example/anchr-mcp/src/` so adapter behavior remains covered outside `@anchr/bounty`.
- `deno task lint:strict` plus the package-boundary search for `@modelcontextprotocol`, `mcp-server`, and `mcp-query-backend` covers accidental MCP reintroduction into core SDK paths.
- `docs/architecture.md` now documents `example/anchr-mcp/` as the MCP adapter boundary.

Review residuals:

- None.

Follow-up:

- #0004 can now remove the remaining reference host runtime.
