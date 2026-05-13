# ホスト REST を Nostr に置き換える

Created: 2026-05-09
Model: Codex GPT-5
Completed: 2026-05-13

## Priority

feature

## Dependencies

Depends on:
- #0001 - 三者アーキテクチャを確定する
- #0002 - bounty を SDK に分割する
- #0005 - 証明スキーマ URL を定義する
- #0008 - セキュリティ不変条件を文書化する

Blocks:
- #0004 - Reference Host を削除する

## Summary

プロトコル向けの REST、worker-api、Oracle HTTP fallback フローを削除し、Customer、Provider、Oracle の通信を Nostr ベースに置き換える。

## Rationale

外部プロトコルトラフィックは Nostr を使うべきである。Customer と Provider には DVM events、Customer と Oracle には Nostr messages、Provider と Oracle の preimage 配信には NIP-44 DM、大きな証明 payload には Blossom を使う。Oracle 間の FROST トラフィックは内部 gRPC のままでよい。

Oracle HTTP fallback は一時的な host-shaped 実装の名残として扱い、最終アーキテクチャでは廃止する。preimage 配信の信頼性は複数 relay への NIP-44 DM、ack/retry、再送可能な encrypted event、または Nostr 上の provider-authenticated pull pattern で満たし、Anchr protocol と SDK は Oracle HTTP endpoint を前提にしない。

## Plan

- query、selection、proof、hash、preimage の各フローで使う Nostr events と tags を仕様化する。
- プロトコル文書から Customer 向け `/queries/...`、Oracle 向け REST、`GET /oracle/preimage/:queryId` fallback の前提を取り除く。
- Provider が preimage を取り逃した場合の回復手段を、HTTP ではなく Nostr-native な再送または pull flow として仕様化する。
- SDK による置き換え経路ができた後、ホスト提供の worker-api 依存を削除する。

## Resolution

Implemented by updating:

- `specs/messaging.md`
- `packages/bounty/src/infrastructure/oracle-service/htlc-routes.ts`
- `packages/bounty/src/infrastructure/oracle-service/server.ts`
- `packages/bounty/src/infrastructure/oracle-service/nostr-service.ts`
- `packages/bounty/src/infrastructure/oracle-service/server.test.ts`
- `packages/bounty/src/infrastructure/oracle-service/nostr-service.test.ts`

Verified with:

- `deno test --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys --config packages/bounty/deno.json packages/bounty/src/infrastructure/oracle-service/server.test.ts packages/bounty/src/infrastructure/oracle-service/nostr-service.test.ts`
- `deno task lint:strict`
- `deno task test:unit`
- `deno task test:all`
- `deno task test:all:docker`

Harness update:

- `packages/bounty/src/infrastructure/oracle-service/server.test.ts` now locks that `POST /preimage` is not exposed as an Oracle HTTP fallback.
- `packages/bounty/src/infrastructure/oracle-service/nostr-service.test.ts` now locks that failed relay delivery returns failure and retains the preimage for Nostr retry.
- `specs/messaging.md` now specifies Nostr-native release retry and recovery instead of an HTTP fallback endpoint.

Review residuals:

- None.

Follow-up:

- #0004 remains responsible for deleting the temporary reference host and worker-api adapter scaffolding after #0007 is closed.
