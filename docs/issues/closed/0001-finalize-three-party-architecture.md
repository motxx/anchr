# 三者アーキテクチャを確定する

Created: 2026-05-09
Model: Codex GPT-5
Completed: 2026-05-09

## Priority

design

## Summary

Reference Host をプロトコル上の主体から外し、Customer、Provider、Oracle が Nostr と Cashu を介して直接連携するリファクタリング前のアーキテクチャを決定する。

## Rationale

プロトコルの主張は信頼された仲介者を置かないことだが、現在のホスト中心の実装では Reference Host が第四の主体のように見えている。この決定では、プロトコル、暗号プリミティブ、三つの対称的な SDK、アダプター、examples という五層構造を確定する必要がある。

## Plan

- 目標とする主体モデルとレイヤー境界を `docs/architecture.md` と関連する仕様に記録する。
- Customer/Provider/Oracle への命名移行方針と、旧 Requester/Worker 用語を消すべき場所を決める。
- ホストされた参照 URL と agent のデフォルトエンドポイントがなくなることを含め、想定されるトレードオフを記録する。

## Resolution

Implemented by updating:

- `docs/architecture.md`
- `specs/README.md`
- `specs/messaging.md`
- `specs/oracle-registry.md`
- `specs/conditional-swap.md`

Verified with:

- `deno fmt --check docs/architecture.md specs/README.md specs/messaging.md specs/oracle-registry.md specs/conditional-swap.md`
- `deno task lint:strict`
- `deno task test:all`

Follow-up:

- `docs/issues/pending/0002-split-bounty-into-sdks.md`
- `docs/issues/pending/0003-replace-host-rest-with-nostr.md`
- `docs/issues/pending/0004-remove-reference-host.md`
- `docs/issues/pending/0007-extract-mcp-adapter.md`
