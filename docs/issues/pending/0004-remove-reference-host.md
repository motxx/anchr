# Reference Host を削除する

Created: 2026-05-09
Model: Codex GPT-5

## Priority

maintenance

## Summary

直接 SDK を使う examples が用意できたら、`example/anchr-reference-host/` とホスト固有の `@anchr/bounty` ランタイムコードを削除する。

## Rationale

Reference Host は三つの役割を一つのプロセスにまとめるデプロイ上の便宜であり、独立したプロトコル主体ではない。SDK 分割後も残すと、誤ったメンタルモデルを温存し、HTTP gateway コードも不要に残る。

## Plan

- `worker-api`、`composeHost`、HTTP gateway、関連するランタイムコードを特定して削除する。
- ホスト依存の example wiring を、直接 SDK を使う形に置き換える。
- ホストされた参照サーバーを案内している README と docs を更新する。
