# 普遍部分を specs に昇格する

Created: 2026-05-09
Model: Codex GPT-5

## Priority

design

## Dependencies

Depends on:
- #0005 - 証明スキーマ URL を定義する
- #0008 - セキュリティ不変条件を文書化する
- #0012 - component 境界を agnostic に定義する

Blocks:
- None

## Summary

component agnostic 化で残る普遍的な protocol、message、state transition、security invariant を `specs/` にまとめ、現在の実装が使われなくなっても reference implementation として生きる状態にする。

## Rationale

実験的技術の採用取消が起きても、Anchr として検証済みの設計判断、wire format、state machine、security invariant は資産として残るべきである。実装詳細ではなく仕様として記録することで、別技術による再実装や検証が可能になり、現在の codebase は spec に対する reference implementation として評価できる。

## Plan

- `specs/` に置くべき universal contract と、`docs/` に置くべき architecture/threat-model 記述を切り分ける。
- message format、state transition、capability requirements、security invariant を具体技術に依存しない形で文書化する。
- Provider preflight、preflight ticket、redeem gate、expected release authority、audit-only correlation fields の universal contract を #0008 から抽出して仕様化する。
- reference implementation が spec のどの節を実装しているかを追跡できるリンクまたはテスト名の方針を決める。
- 具体 adapter/plugin の仕様は、universal spec とは別に implementation profile として記録する。
