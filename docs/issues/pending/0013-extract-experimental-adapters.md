# 実験的技術を adapter/plugin に分離する

Created: 2026-05-09
Model: Codex GPT-5

## Priority

feature

## Dependencies

Depends on:
- #0002 - bounty を SDK に分割する
- #0012 - component 境界を agnostic に定義する

Blocks:
- #0006 - SDK を三つの実行環境に対応させる

## Summary

Nostr、Cashu、TLSNotary、Blossom などの実験的または置換可能な技術を、core component から直接参照される実装ではなく adapter/plugin として差し替えられる構造にする。

## Rationale

採用技術の一部が要件、運用性、セキュリティ、保守性の面で不適と判明した場合でも、Anchr の普遍的な protocol と SDK surface は残せるようにしたい。component は port 型と capability contract に依存し、具体技術は reference adapter として同梱する形にすると、採用取消や代替実装の評価を局所化できる。

## Plan

- core component が必要とする storage、transport、payment、proof、media 配布などの port/capability を定義する。
- 既存の具体技術実装を、それぞれ port を満たす adapter/plugin として切り出す。
- example と tests を、直接具体技術に結合する形から adapter 注入または plugin 選択の形へ移行する。
- adapter/plugin ごとの conformance test を用意し、差し替えても core contract が保たれることを確認する。
