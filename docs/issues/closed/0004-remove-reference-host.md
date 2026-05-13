# Reference Host を削除する

Created: 2026-05-09
Model: Codex GPT-5
Completed: 2026-05-13

## Priority

maintenance

## Dependencies

Depends on:
- #0001 - 三者アーキテクチャを確定する
- #0002 - bounty を SDK に分割する
- #0003 - ホスト REST を Nostr に置き換える
- #0007 - MCP アダプターを切り出す

Blocks:
- None

## Summary

直接 SDK を使う examples が用意できたら、`example/anchr-reference-host/` とホスト固有の `@anchr/bounty` ランタイムコードを削除する。

## Rationale

Reference Host は三つの役割を一つのプロセスにまとめるデプロイ上の便宜であり、独立したプロトコル主体ではない。SDK 分割後も残すと、誤ったメンタルモデルを温存し、HTTP gateway コードも不要に残る。

## Plan

- `worker-api`、`composeHost`、HTTP gateway、関連するランタイムコードを特定して削除する。
- ホスト依存の example wiring を、直接 SDK を使う形に置き換える。
- ホストされた参照サーバーを案内している README と docs を更新する。

## Resolution

- `example/anchr-reference-host/`、`packages/bounty/src/infrastructure/runtime.ts`、共有 `worker-api` HTTP gateway、関連テストと stale e2e harness を削除した。
- `@anchr/bounty` の public exports から `composeHost` / `startReferenceRuntime` / `worker-api` schema exports を削除し、submission channel を transport-neutral な `adapter` に統一した。
- MCP example と data-marketplace example は直接 `createQueryService` を組み立てる形に変更し、data-marketplace は自前の HTTP adapter routes だけを登録するようにした。
- Reference Host / worker HTTP gateway 前提の README、architecture、review harness、threat model、regtest skill、contributing docs を更新した。
- `test:integration` は対象ファイルが 0 件のとき全リポジトリを誤実行しないようにした。

Verification:
- `deno check e2e/regtest/core-flow.test.ts e2e/regtest/regtest-cashu.test.ts e2e/relay/relay.test.ts e2e/tlsn/tlsn.test.ts`
- `deno check example/anchr-mcp/server.ts example/anchr-mcp/src/mcp-query-backend.ts example/anchr-mcp/src/mcp-server.integration.test.ts example/anchr-mcp/src/mcp-tool-handlers.ts example/data-marketplace/server.ts example/data-marketplace/src/marketplace/marketplace-routes.test.ts example/data-marketplace/src/marketplace/marketplace-schemas.ts example/data-marketplace/src/mcp-marketplace-handlers.ts`
- `deno check packages/bounty/src/application/escrow-flow-methods.ts packages/bounty/src/domain/query-aggregate.ts packages/bounty/src/domain/types.ts packages/bounty/src/infrastructure/config.ts packages/bounty/src/infrastructure/verification/verifier.ts packages/bounty/src/mod.ts`
- `deno test packages/bounty/src --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys '--ignore=**/*.integration.test.ts'`
- `deno test --allow-all example/anchr-mcp/src/mcp-query-backend.test.ts example/anchr-mcp/src/mcp-server.integration.test.ts example/data-marketplace/src/marketplace/marketplace-routes.test.ts`
- `deno test e2e/protocol/ --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys`
- `deno task lint:strict`
- `deno task lint:deps`
- `deno task test:integration`
- `deno task test:all`
