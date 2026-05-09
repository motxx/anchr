# ホスト REST を Nostr に置き換える

Created: 2026-05-09
Model: Codex GPT-5

## Priority

feature

## Summary

プロトコル向けの REST と worker-api フローを削除し、Customer、Provider、Oracle の通信を Nostr ベースに置き換える。

## Rationale

外部プロトコルトラフィックは Nostr を使うべきである。Customer と Provider には DVM events、Customer と Oracle には Nostr messages、Provider と Oracle の preimage 配信には NIP-44 DM、大きな証明 payload には Blossom を使う。Oracle 間の FROST トラフィックは内部 gRPC のままでよい。

## Plan

- query、selection、proof、hash、preimage の各フローで使う Nostr events と tags を仕様化する。
- プロトコル文書から Customer 向け `/queries/...` と Oracle 向け REST の前提を取り除く。
- SDK による置き換え経路ができた後、ホスト提供の worker-api 依存を削除する。
