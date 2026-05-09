# bounty を SDK に分割する

Created: 2026-05-09 Model: Codex GPT-5

## Priority

feature

## Dependencies

Depends on:
- #0001 - 三者アーキテクチャを確定する
- #0008 - セキュリティ不変条件を文書化する
- #0012 - component 境界を agnostic に定義する

Blocks:
- #0003 - ホスト REST を Nostr に置き換える
- #0004 - Reference Host を削除する
- #0006 - SDK を三つの実行環境に対応させる
- #0007 - MCP アダプターを切り出す
- #0013 - 実験的技術を adapter/plugin に分離する

## Summary

`@anchr/bounty` を protocol、customer、provider、oracle
の各パッケージに分解し、三つの actor SDK がそれぞれローカル状態と環境依存 ports
を所有する構造にする。

## Rationale

このリファクタリングでは
`@anchr/protocol`、`@anchr/customer-sdk`、`@anchr/provider-sdk`、`@anchr/oracle-sdk`
が必要になる。各主体がホストランタイムに依存せず、自身のローカル状態と環境アダプターを所有できるようにするためである。

`@anchr/protocol` は pure protocol contract に限定する。Nostr relay、Cashu
wallet、signer、storage、proof producer/verifier のような実行環境依存 ports は
actor SDK 側に置き、protocol package から adapter や host runtime に依存しない。

## Plan

- Nostr イベント定義、wire payload 型、schema identifiers、versioned
  compatibility helpers、純粋な状態遷移ヘルパーを `@anchr/protocol` に移す。
- `@anchr/protocol` には Deno、HTTP、MCP、relay client、wallet、storage、proof
  generation、verification implementation に依存する ports を置かない。
- Customer の escrow と refund ロジックを `@anchr/customer-sdk` に移す。
- Provider の証明フロー、preflight ticket、redeem gate、lock 検証ロジックを
  `@anchr/provider-sdk` に移す。Provider policy は preflight で閉じ、redeem
  時は #0008 で定義する token spendability checks を hard gate にし、clean
  settlement / audit checks は資金回収と分離する。
- Oracle の検証と release フローを `@anchr/oracle-sdk` に移す。
- `requester_*`、`worker_*`、`requester_only`、`worker_selected` は既存
  wire/domain 互換名として扱い、新 SDK API では Customer/Provider の名前を使う。
- `@anchr/protocol` に versioned replacements を導入した後は、requester/worker
  語彙を alias として残さず、wire/domain からも削除する。
