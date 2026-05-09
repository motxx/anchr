# bounty を SDK に分割する

Created: 2026-05-09
Model: Codex GPT-5

## Priority

feature

## Summary

`@anchr/bounty` を protocol、customer、provider、oracle の各パッケージに分解し、対称的なステートマシンとポート注入の構造にする。

## Rationale

このリファクタリングでは `@anchr/protocol`、`@anchr/customer-sdk`、`@anchr/provider-sdk`、`@anchr/oracle-sdk` が必要になる。各主体がホストランタイムに依存せず、自身のローカル状態と環境アダプターを所有できるようにするためである。

## Plan

- Nostr イベント定義、共有ステートマシン、ポート型、仕様ヘルパーを `@anchr/protocol` に移す。
- Customer の escrow と refund ロジックを `@anchr/customer-sdk` に移す。
- Provider の証明フローと lock 検証ロジックを `@anchr/provider-sdk` に移す。
- Oracle の検証と release フローを `@anchr/oracle-sdk` に移す。
