# ハーネス保守ループを標準化する

Created: 2026-05-09
Model: Codex GPT-5

## Priority

maintenance

## Summary

AI の出力を見て人間が発見したズレを、都度どのハーネスへ戻すかの保守手順にする。単発のレビューコメントで終わらせず、再発するズレはテスト、lint、skill、仕様ロック、issue のいずれかへ変換する運用を定義する。

## Rationale

このリポジトリは `docs/issues`、`skills/`、`scripts/`、`docs/threat-model.lock.json` を使って、設計判断と検査をリポジトリ内に残せる構造を持っている。AI がコーディングを担当するほど、ハーネス側の更新判断を明示しないと、人間レビューが同じ境界違反を繰り返し検出することになる。

## Plan

- AI 出力のズレを `bug regression`、`boundary drift`、`semantic bypass`、`missing invariant`、`unclear universal decision` に分類する手順を書く。
- 各分類を追加すべき場所、例えば unit/e2e test、`scripts/*lint*.ts`、repository skill、`docs/threat-model.md`、pending issue に対応付ける。
- issue を閉じる前に「ハーネス更新が不要なら理由を書く」ルールを追加するか決める。
