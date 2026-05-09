# ホスト REST を Nostr に置き換える

Created: 2026-05-09
Model: Codex GPT-5

## Priority

feature

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
