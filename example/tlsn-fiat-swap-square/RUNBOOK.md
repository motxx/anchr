# TLSNotary Fiat Swap (Square) — Runbook

Square テスト決済を TLSNotary で証明し、Anchr 経由で BTC と trustless に交換する E2E 手順。

**検証対象**: Square Payments API (`connect.squareup.com`) の JSON レスポンス
**証明方式**: CLI (`tlsn-prove`) — Square は ECDSA 証明書のため MPC-TLS が ~2秒で完了

> **なぜ Square か:** Stripe は RSA 証明書を使用しており、MPC-TLS の RSA 署名検証が非常に遅い（数分以上ハング）。Square は ECDSA (P-256) 証明書のため、CoinGecko と同程度の速度で証明が完了する。

---

## 0. 準備

### 0-1. Square Developer アカウント

1. https://developer.squareup.com/apps でアカウント作成
2. アプリケーションを作成（または既存のものを使用）
3. **Sandbox** タブから:
   - **Sandbox Access Token** (`EAAAl...`) をコピー
   - **Sandbox Application ID** をメモ

### 0-2. Square Sandbox で Payment Link を作成

Sandbox Dashboard でテスト Payment Link を作成:
- https://squareupsandbox.com/dashboard → Payment Links

または API で作成:
```bash
curl -X POST https://connect.squareup.com/v2/online-checkout/payment-links \
  -H "Authorization: Bearer $SQUARE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "quick_pay": {
      "name": "Test Payment",
      "price_money": { "amount": 100, "currency": "JPY" },
      "location_id": "'$SQUARE_LOCATION_ID'"
    }
  }' | jq '.payment_link.url'
```

---

## 1. インフラ起動

```bash
docker compose up -d
docker compose restart cashu-mint  # 必要に応じて
docker compose ps
```

## 2. Anchr サーバー起動

```bash
BLOSSOM_SERVERS=http://localhost:3333 \
NOSTR_RELAYS=ws://localhost:7777 \
CASHU_MINT_URL=http://localhost:3338 \
bun run dev
```

---

## 3. Seller: オーダー作成

```bash
SQUARE_ACCESS_TOKEN=EAAAl... \
bun example/tlsn-fiat-swap-square/seller.ts
```

**このターミナルは開いたまま**にする。

---

## 4. Buyer: Square で支払い

Payment Link を開いて支払いを完了する。

Sandbox テストカード:
- カード番号: `4532 7597 3454 5858`
- 有効期限: 任意の未来の日付
- CVC: `111`
- 郵便番号: `94103`

## 5. Payment ID を取得

支払い後、Square Dashboard または API から Payment ID を取得:

```bash
curl -s https://connect.squareup.com/v2/payments \
  -H "Authorization: Bearer $SQUARE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sort_order": "DESC", "limit": 1}' | jq '.payments[0] | {id, status, amount_money}'
```

期待される出力:
```json
{
  "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "status": "COMPLETED",
  "amount_money": { "amount": 100, "currency": "JPY" }
}
```

---

## 6. Buyer: TLSNotary proof 生成

Square は ECDSA 証明書のため、CLI prover で ~2秒で完了する。

```bash
PAYMENT_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # Step 5 で取得

./crates/tlsn-prover/target/release/tlsn-prove \
  --verifier localhost:7046 \
  --max-recv-data 4096 \
  --max-sent-data 4096 \
  -H "Authorization: Bearer $SQUARE_ACCESS_TOKEN" \
  "https://connect.squareup.com/v2/payments/$PAYMENT_ID" \
  -o proof.presentation.tlsn
```

期待される出力:
```
[tlsn-prove] Target: connect.squareup.com:443/v2/payments/...
[tlsn-prove] MPC limits: max_sent=4096, max_recv=4096
[tlsn-prove] MPC connection established
[tlsn-prove] Connected to connect.squareup.com:443
[tlsn-prove] Sending HTTP request...
[tlsn-prove] Response status: 200 OK
[tlsn-prove] MPC complete, requesting attestation...
[tlsn-prove] Presentation saved to proof.presentation.tlsn
```

> **レスポンスサイズの確認:**
> ```bash
> curl -s --http1.1 -o /dev/null -w 'headers: %{size_header}\nbody: %{size_download}\n' \
>   -H "Authorization: Bearer $SQUARE_ACCESS_TOKEN" \
>   -H "Accept: application/json" \
>   -H "Accept-Encoding: identity" \
>   -H "Connection: close" \
>   "https://connect.squareup.com/v2/payments/$PAYMENT_ID"
> ```
> headers + body の合計が 4096 を超える場合は `--max-recv-data` を増やす。

---

## 7. Buyer: proof を Anchr に提出

```bash
QUERY_ID="query_xxxxx"  # seller.ts の出力から

curl -X POST http://localhost:3000/queries/${QUERY_ID}/submit \
  -H "Content-Type: application/json" \
  -d "{\"tlsn_presentation\": \"$(base64 < proof.presentation.tlsn)\"}"
```

---

## 8. 検証結果の確認

**Seller 側 (Terminal)**:
```
Order completed!
  Status: approved
  Payment verified — BTC released to buyer
  Verification checks:
    ✓ cryptographically verified from connect.squareup.com
    ✓ server name matches target_url
    ✓ "status":"COMPLETED" condition satisfied
```

---

## 9. クリーンアップ

```bash
docker compose down
```

---

## トラブルシューティング

| 問題 | 対処 |
|------|------|
| Square API で 401 | `SQUARE_ACCESS_TOKEN` が正しいか確認。Sandbox トークン (`EAAAl...`) を使う |
| Payment ID が分からない | Step 5 の API コマンドで最新の payment を取得 |
| レスポンスが 4096 を超える | `--max-recv-data 8192` に増やす (ECDSA なので 8192 でも数秒で完了) |
| MPC-TLS がハングする | Square は ECDSA なので通常ハングしない。verifier を restart: `docker compose restart tlsn-verifier` |

### Square vs Stripe: TLS 証明書の比較

| | Square | Stripe |
|---|---|---|
| ドメイン | connect.squareup.com | api.stripe.com |
| 証明書の鍵 | **ECDSA (P-256)** | RSA |
| MPC-TLS 時間 | **~2秒** | ハング (>3分) |
| 推奨方式 | CLI (`tlsn-prove`) | 非推奨 (RSA ボトルネック) |
