# セキュリティ不変条件を文書化する

Created: 2026-05-09
Model: Codex GPT-5

## Priority

design

## Summary

セキュリティに関わるフローをリファクタリングする前に、二条件の Cashu lock、Provider preflight、cancel-race behavior を明示する。

## Rationale

Escrow の redemption には oracle release material と bound Provider signature の両方が必要でなければならない。Oracle preimage release はホストや coordinator の cancel state ではなく proof validity に依存するべきである。不可逆な actions を行う Providers には、lock structure、mint support、locktime、oracle liveness、customer commitment を検査する first-class preflight API も必要である。

## Plan

- 盗まれた preimage だけでは escrow を redeem できない、という invariant を `docs/threat-model.md` に追加する。
- protocol docs で Oracle cancel-race behavior を仕様化する。
- Provider preflight checks を Provider SDK API に昇格させる。
- 既存の HTLC attack tests に注記するか拡張し、この invariant をカバーする。
