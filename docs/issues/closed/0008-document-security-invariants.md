# セキュリティ不変条件を文書化する

Created: 2026-05-09
Model: Codex GPT-5
Completed: 2026-05-10

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

不可逆な actions を行う Providers には、lock structure、mint support、locktime、oracle liveness、customer commitment を検査する first-class preflight API が必要である。ただし Provider policy は preflight 時点で閉じるべきであり、redeem 時に mutable policy を再評価して回収可能な支払いを止めてはならない。

Redeem decision、clean settlement decision、reputation / audit decision は分ける。Mint-level redeem は Cashu lock spendability に寄せ、preimage が bound token の hashlock に一致し、bound token が Provider pubkey に lock され、Provider が署名できるなら資金回収を妨げない。`request_event_id`、`query_id`、expected Oracle signature のような protocol correlation / authority metadata は clean settlement と audit の判定に使うが、spendable token の redeem を止める主条件にしない。

Unexpected Oracle から届いた release material は clean valid release として扱わない。ただし、その material が現在の bound token を実際に unlock するなら、Provider SDK は経済的な redeem を妨げない。unexpected source、signature mismatch、`query_id` mismatch、`request_event_id` mismatch は、Oracle の漏洩、誤配送、実装バグ、または protocol upgrade drift の証拠として audit / reputation に記録する。

## Design Notes

- Provider preflight は `ok`、`errors`、`warnings`、`details` を持つ structured report を返す。`true | false` だけにはしない。
- Provider preflight が成功したら、`query_id`、expected Oracle、Provider pubkey、mint URL、payment hash、token fingerprint、accepted amount、locktime、offer amount、policy version を含む preflight ticket を残す。
- Provider redeem gate は現在の Provider policy を再評価せず、preflight ticket の token fingerprint / payment hash / Provider pubkey lock と release material の preimage を照合する。
- `query_id`、`request_event_id`、Nostr reply thread、expected Oracle authority の mismatch は anomaly として audit record に残す。preimage が bound token の hashlock に一致し、token が Provider に bind されているなら、それだけで redeem を止めない。
- expected Oracle が valid proof に対して release しない liveness failure は、Oracle selection policy または FROST threshold 構成で事前に引き受ける risk として扱う。
- release material は単なる preimage ではなく、payment hash、Provider pubkey、`query_id`、Oracle pubkey または group key、署名を含む構造にする。FROST の場合は expected group key からの release として検証する。この検証は clean settlement / reputation 用であり、spendable token の資金回収可否とは分離する。

## State Transition Sketch

Happy path:

| Phase | Customer | Provider | Oracle | Mint |
| --- | --- | --- | --- | --- |
| Request | Query と accepted Oracle を公開し、Oracle hash commitment を取得する | schema、mint、Oracle policy を見て offer 可否を決める | query 用 preimage を保持し hash を返す | まだ final bound lock は持たない |
| Offer | offer を集め Provider を選ぶ | offer 額と条件を提示する | 待機する | 変化なし |
| Selection | selected Provider 向け bound token を作る | bound token を受け取り preflight する | selected Provider / query context を観測する | hashlock + Provider lock + refund locktime を持つ token を発行する |
| Work | result / proof を待つ | preflight ticket を保存して `produce()` する | proof を待つ | token を保持する |
| Release | result / proof を受け取る | release material を受け取る | valid proof なら release material を送る | token 条件だけを enforcement する |
| Redeem | redeemed されれば完了扱いにする | preimage + Provider signature で redeem する | clean settlement / anomaly を記録する | 条件を満たせば Provider に支払う |
| Timeout | 未redeemなら refund を試みる | redeem できなければ loss / dispute evidence を記録する | liveness failure を記録する | locktime 後は refund path を許可する |

Failure handling:

| Condition | Provider action | Clean settlement | Audit / reputation |
| --- | --- | --- | --- |
| offer 前に Oracle / schema / mint が policy 外 | offer しない | なし | optional policy log |
| selection 後 token が amount / mint / hash / Provider lock / locktime を満たさない | preflight reject。`produce()` しない | なし | Customer / implementation anomaly |
| valid proof 後、expected Oracle が release しない | redeem できない | 失敗 | Oracle liveness failure |
| release source、signature、`query_id`、`request_event_id` が ticket とずれる | token spendability があれば redeem を妨げない | clean valid release ではない | leak / misdelivery / drift evidence |
| preimage が bound token hashlock に合わない | redeem しない | 失敗 | bad release / wrong token evidence |
| token が Provider pubkey に bind されていない | redeem 不能。preflight で止めるべき | 失敗 | Customer / implementation anomaly |
| locktime が迫っている | preflight では reject。release 後なら即 redeem を試みる | 状況次第 | short-locktime risk |

## Candidate Invariants

- 盗まれた preimage だけでは escrow を redeem できない。redeem には bound Provider signature も必要である。
- Provider は `produce()` の前に、bound token が offer 額以上、expected mint、expected payment hash、Provider pubkey lock、十分な locktime を満たすことを preflight する。
- Provider preflight で accepted された escrow は、redeem 時に mutable policy で拒否されない。redeem 時は token spendability と preflight ticket の token fingerprint / payment hash / Provider pubkey lock だけを hard gate にする。
- expected Oracle または expected Oracle group 以外からの release material は、protocol 上の clean valid release として扱わない。ただし hashlock が一致し、Provider が redeem できる場合は資金回収を妨げず、audit / reputation event として記録する。
- `query_id` または `request_event_id` mismatch は audit anomaly であり、単独では redeem failure の理由にしない。
- Oracle release は coordinator cancel state ではなく proof validity と expected authority に基づく。valid proof 後の cancel は release を阻止できない。
- locktime は Provider が proof 作成、Oracle verification、release delivery、mint redemption を終えられる猶予を含まなければならない。

## Plan

- 盗まれた preimage だけでは escrow を redeem できない、という invariant を `docs/threat-model.md` に追加する。
- Provider preflight ticket と redeem gate の責務分離を `docs/threat-model.md` と protocol docs に追加する。
- Mint-level redeem、clean settlement、audit / reputation の三つの判定を protocol docs で分離する。
- unexpected Oracle release、`query_id` mismatch、`request_event_id` mismatch を audit-only にし、spendable token の redeem を止めない rule を仕様化する。
- release material の署名付き構造を定義し、expected Oracle / FROST group key の検証を clean settlement / reputation check にする。
- protocol docs で Oracle cancel-race behavior を仕様化する。
- Provider preflight checks を Provider SDK API に昇格させる。
- 既存の HTLC attack tests に注記するか拡張し、上記 candidate invariants をカバーする。

## Resolution

Implemented by updating:

- `docs/threat-model.md`
- `docs/threat-model.lock.json`
- `specs/messaging.md`
- `packages/sdk/README.md`
- `e2e/regtest/regtest-htlc-attacks.test.ts`

Verified with:

- `deno fmt --check docs/threat-model.md specs/messaging.md packages/sdk/README.md e2e/regtest/regtest-htlc-attacks.test.ts docs/threat-model.lock.json`
- `deno task lint:invariants`
- `deno task test:unit --filter provider`
- `deno task lint:strict`
- `deno task test:all`

Follow-up:

- None
