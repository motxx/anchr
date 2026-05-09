# セキュリティ不変条件を文書化する

Created: 2026-05-09
Model: Codex GPT-5

## Priority

design

## Dependencies

Depends on:
- #0001 - 三者アーキテクチャを確定する

Blocks:
- #0002 - bounty を SDK に分割する
- #0003 - ホスト REST を Nostr に置き換える
- #0014 - 普遍部分を specs に昇格する

## Summary

セキュリティに関わるフローをリファクタリングする前に、二条件の Cashu lock、Provider preflight、redeem gate、cancel-race behavior を明示する。

## Rationale

Escrow の redemption には oracle release material と bound Provider signature の両方が必要でなければならない。Oracle preimage release はホストや coordinator の cancel state ではなく proof validity に依存するべきである。

不可逆な actions を行う Providers には、lock structure、mint support、locktime、oracle liveness、customer commitment を検査する first-class preflight API が必要である。ただし Provider policy は preflight 時点で閉じるべきであり、redeem 時に mutable policy を再評価して回収可能な支払いを止めてはならない。redeem gate は、preflight 済みの escrow と release material が cryptographic/token 上で一致しているかだけを検査する。

Settlement-critical な条件は Cashu lock と expected Oracle authority に寄せる。`request_event_id` のような Nostr threading / audit 用の相関 ID は mismatch を記録するが、単独では redeem を止める hard gate にしない。protocol upgrade、breaking change、または実装バグで補助メタデータがずれても、Provider が valid proof に対して正しい release material を受け取り、現在の bound token を redeem できるなら資金回収を妨げない設計にする。

Unexpected Oracle から届いた release material は hard reject する。物理的に hashlock を unlock できる preimage であっても、Provider は quote 時点で expected Oracle または expected Oracle group の trust / liveness risk を受け入れている。release authority を曖昧にしないため、別 Oracle からの release は保証対象外として扱う。

## Design Notes

- Provider preflight は `ok`、`errors`、`warnings`、`details` を持つ structured report を返す。`true | false` だけにはしない。
- Provider preflight が成功したら、`query_id`、expected Oracle、Provider pubkey、mint URL、payment hash、token fingerprint、accepted amount、locktime、quote amount、policy version を含む preflight ticket を残す。
- Provider redeem gate は現在の Provider policy を再評価せず、preflight ticket と release material を照合する。
- `request_event_id` や Nostr reply thread の mismatch は anomaly として audit record に残す。preimage が bound token の hashlock に一致し、token が Provider に bind され、expected Oracle authority が検証できるなら、それだけで redeem を止めない。
- expected Oracle が valid proof に対して release しない liveness failure は、Oracle selection policy または FROST threshold 構成で事前に引き受ける risk として扱う。
- release material は単なる preimage ではなく、payment hash、Provider pubkey、`query_id`、Oracle pubkey または group key、署名を含む構造にする。FROST の場合は expected group key からの release として検証する。

## Candidate Invariants

- 盗まれた preimage だけでは escrow を redeem できない。redeem には bound Provider signature も必要である。
- Provider は `produce()` の前に、bound token が quote 額以上、expected mint、expected payment hash、Provider pubkey lock、十分な locktime、expected Oracle authority を満たすことを preflight する。
- Provider preflight で accepted された escrow は、redeem 時に mutable policy で拒否されない。redeem 時は preflight ticket と release material の一致だけを検査する。
- expected Oracle または expected Oracle group 以外からの release material は、hashlock が一致しても protocol 上の valid release として扱わない。
- `request_event_id` mismatch は audit anomaly であり、単独では redeem failure の理由にしない。
- Oracle release は coordinator cancel state ではなく proof validity と expected authority に基づく。valid proof 後の cancel は release を阻止できない。
- locktime は Provider が proof 作成、Oracle verification、release delivery、mint redemption を終えられる猶予を含まなければならない。

## Plan

- 盗まれた preimage だけでは escrow を redeem できない、という invariant を `docs/threat-model.md` に追加する。
- Provider preflight ticket と redeem gate の責務分離を `docs/threat-model.md` と protocol docs に追加する。
- unexpected Oracle release を hard reject し、`request_event_id` mismatch を audit-only にする rule を仕様化する。
- release material の署名付き構造を定義し、expected Oracle / FROST group key の検証を required check にする。
- protocol docs で Oracle cancel-race behavior を仕様化する。
- Provider preflight checks を Provider SDK API に昇格させる。
- 既存の HTLC attack tests に注記するか拡張し、上記 candidate invariants をカバーする。
