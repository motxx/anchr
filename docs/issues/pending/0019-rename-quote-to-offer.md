# Quote を Offer に改名する

Created: 2026-05-09
Model: Codex GPT-5

## Priority

maintenance

## Dependencies

Depends on:
- #0002 - bounty を SDK に分割する
- #0008 - セキュリティ不変条件を文書化する

Blocks:
- None

## Summary

Provider が request に対して価格と履行意思を返す概念を `Quote` ではなく `Offer` として表現する。商取引英語として `quote` は見積もりを意味するため誤りではないが、Anchr のフローでは Provider が「この条件なら受ける」という意思と条件を提示しており、`offer` のほうが役割を直感的に表す。

pre-1.0 のため後方互換 alias や deprecated shim は置かず、public SDK、domain state、wire payload、spec、tests、docs の `Quote` / `quote` vocabulary を可能な限り完全に `Offer` / `offer` へ置き換える。

## Rationale

現在の SDK / bounty 実装では `ProviderQuote`、`QuoteSelector`、`quoteWindowMs`、`NoQuotesReceivedError`、`QuoteFeedbackPayload`、`quote_event_id`、`awaiting_quotes` などの語彙が使われている。これらの多くは `Offer` へ移しても意味が壊れず、むしろ `ProviderOffer`、`OfferSelector`、`offerWindowMs` のほうが「価格 + 条件 + 受諾意思」を表しやすい。

後方互換性は気にしない。既存イベントや host-shaped code に `quote_event_id`、`awaiting_quotes`、`quotes` などが残っていても、同じ変更で versioned replacement なしに `offer_event_id`、`awaiting_offers`、`offers` へ改名する。`shouldQuote` のような動詞は機械的に `shouldOffer` へ置き換えず、`canOfferForRequest` や `shouldSubmitOffer` のように自然な API 名を選ぶ必要がある。NIP-90 の `status=payment-required` feedback に近い wire 層では、`OfferFeedbackPayload` または `PaymentRequiredFeedbackPayload` のどちらが適切かも決める。

## Plan

- `Quote` 系の public SDK vocabulary と wire/domain compatibility vocabulary を棚卸しする。
- 新 SDK API では `ProviderOffer`、`OfferSelector`、`NoOffersReceivedError`、`offerWindowMs` などの命名に寄せる。
- `shouldQuote` のような動詞 API は機械的改名を避け、Provider が request に offer を出せるかを表す自然な名前へ置き換える。
- 既存 wire field / host-shaped domain state の `quote_event_id`、`awaiting_quotes`、`quotes` も `offer_event_id`、`awaiting_offers`、`offers` へ改名し、旧名 alias は残さない。
- `specs/messaging.md` と SDK README の用語を Customer request、Provider offer、Customer selection の流れに揃える。
- 旧 `Quote` / `quote` vocabulary が public API、wire schema、domain state、tests、docs に残っていないことを `rg "Quote|quote|quotes|awaiting_quotes|quote_event_id"` で確認する。
