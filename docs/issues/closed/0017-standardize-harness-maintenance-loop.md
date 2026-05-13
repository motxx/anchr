# ハーネス保守ループを標準化する

Created: 2026-05-09
Model: Codex GPT-5
Completed: 2026-05-13

## Priority

maintenance

## Dependencies

Depends on:
- #0016 - 人間レビュー領域をハーネスへ写像する

Blocks:
- #0018 - 人間レビュー残差を追跡する

## Summary

AI の出力を見て人間が発見したズレを、都度どのハーネスへ戻すかの保守手順にする。単発のレビューコメントで終わらせず、再発するズレはテスト、lint、skill、仕様ロック、issue のいずれかへ変換する運用を定義する。

## Rationale

このリポジトリは `docs/issues`、`skills/`、`scripts/`、`docs/threat-model.lock.json` を使って、設計判断と検査をリポジトリ内に残せる構造を持っている。AI がコーディングを担当するほど、ハーネス側の更新判断を明示しないと、人間レビューが同じ境界違反を繰り返し検出することになる。

## Plan

- AI 出力のズレを `bug regression`、`boundary drift`、`semantic bypass`、`missing invariant`、`unclear universal decision` に分類する手順を書く。
- 各分類を追加すべき場所、例えば unit/e2e test、`scripts/*lint*.ts`、repository skill、`docs/threat-model.md`、pending issue に対応付ける。
- issue を閉じる前に「ハーネス更新が不要なら理由を書く」ルールを追加するか決める。

## Resolution

Implemented by updating:

- `docs/review-harness.md` — added a "Maintenance Loop" section that lists the
  five drift classes (`bug regression`, `boundary drift`, `semantic bypass`,
  `missing invariant`, `unclear universal decision`), routes each to its
  default harness home, and defines the "harness update or one-line rationale"
  requirement for issue resolution notes. Removed the obsolete "Not Yet
  Covered" row that pointed at #0017.
- `docs/issues/README.md` — the closing template now requires a `Harness
  update:` field that names the harness change or records the rationale, and
  points at the maintenance loop.
- `skills/resolve-issues/SKILL.md` — added a classification step before
  closing and a required `Harness update:` bullet in the resolution template.

Verified with:

- `deno task lint:strict`

Harness update:

- The maintenance loop itself is the harness for this class of finding. The
  required `Harness update:` bullet in the closing template is the
  enforcement; rationale text is free-form by design, so no deterministic
  lint is added. The rule is socially enforced by `skills/resolve-issues`.

Follow-up:

- #0018 should define the residual human-review checklist after the harness
  passes, including which `human universal decision` calls remain for
  maintainers.
