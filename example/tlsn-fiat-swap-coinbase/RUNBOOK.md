# TLSNotary Fiat Swap (Coinbase Commerce) — Runbook

Coinbase Commerce の決済を TLSNotary で証明し、Anchr 経由で BTC と trustless に交換する E2E 手順。

**検証対象**: Coinbase Commerce Charges API (`api.commerce.coinbase.com`) の JSON レスポンス
**証明方式**: CLI (`tlsn-prove`) — Coinbase は ECDSA 証明書のため MPC-TLS が ~2秒で完了

---

## 0. 準備

### 0-1. Coinbase Commerce アカウント

1. https://beta.commerce.coinbase.com にアクセス
2. Settings → Security → **API Key** を作成・コピー

### 0-2. Charge を作成

API で Charge を作成:

```bash
curl -X POST https://api.commerce.coinbase.com/charges \
  -H "X-CC-Api-Key: $COINBASE_COMMERCE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "BTC Swap Payment",
    "description": "Pay to receive BTC via Anchr",
    "pricing_type": "fixed_price",
    "local_price": { "amount": "10.00", "currency": "USD" }
  }' | jq '{id: .data.id, hosted_url: .data.hosted_url}'
```

`hosted_url` が支払いリンク、`id` が Charge ID。

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
COINBASE_COMMERCE_API_KEY=xxx \
bun example/tlsn-fiat-swap-coinbase/seller.ts
```

**このターミナルは開いたまま**にする。

---

## 4. Buyer: Coinbase Commerce で支払い

Charge の `hosted_url` を開いて支払いを完了する（暗号通貨 or カード）。

## 5. Charge ID を確認

```bash
# 最新の Charge を取得
curl -s https://api.commerce.coinbase.com/charges \
  -H "X-CC-Api-Key: $COINBASE_COMMERCE_API_KEY" | \
  jq '.data[0] | {id, timeline: [.timeline[] | {status, time}]}'
```

`timeline` に `COMPLETED` があれば支払い完了。

---

## 6. Buyer: TLSNotary proof 生成

Coinbase Commerce は ECDSA 証明書のため、CLI / Extension どちらでも ~2秒で完了する。

### 6a. CLI (`tlsn-prove`)

```bash
CHARGE_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # Step 5 で取得

./crates/tlsn-prover/target/release/tlsn-prove \
  --verifier localhost:7046 \
  --max-recv-data 4096 \
  --max-sent-data 4096 \
  -H "X-CC-Api-Key: $COINBASE_COMMERCE_API_KEY" \
  "https://api.commerce.coinbase.com/charges/$CHARGE_ID" \
  -o proof.presentation.tlsn
```

### 6b. TLSNotary Extension (DevConsole)

Chrome for Testing を起動:
```bash
bun run scripts/launch-chrome-tlsn.ts
```

DevConsole に以下を貼り付けて **Run Code**:

```javascript
// Anchr: prove Coinbase Commerce Charge status via API
const CHARGE_ID = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';  // ← Step 5 で取得
const CC_API_KEY = 'xxx';  // ← Seller から受け取った Commerce API Key
const VERIFIER_URL = 'ws://localhost:7047';
const PROXY_URL = 'ws://localhost:7047/proxy?token=api.commerce.coinbase.com';

export default {
  config: {
    name: 'Anchr: Coinbase Commerce API',
    description: 'Prove Coinbase Commerce Charge status',
    requests: [{
      method: 'GET',
      host: 'api.commerce.coinbase.com',
      pathname: '/**',
      verifierUrl: VERIFIER_URL,
    }],
  },
  main: async () => {
    const proof = await prove(
      {
        url: `https://api.commerce.coinbase.com/charges/${CHARGE_ID}`,
        method: 'GET',
        headers: {
          'Host': 'api.commerce.coinbase.com',
          'X-CC-Api-Key': CC_API_KEY,
          'Accept': 'application/json',
          'Accept-Encoding': 'identity',
          'Connection': 'close',
        },
      },
      {
        verifierUrl: VERIFIER_URL,
        proxyUrl: PROXY_URL,
        maxRecvData: 4096,
        maxSentData: 4096,
        handlers: [
          { type: 'SENT', part: 'START_LINE', action: 'REVEAL' },
          { type: 'RECV', part: 'STATUS_CODE', action: 'REVEAL' },
          { type: 'RECV', part: 'BODY', action: 'REVEAL' },
        ],
      }
    );

    try {
      await navigator.clipboard.writeText(JSON.stringify(proof));
      console.log('[Anchr] Proof copied to clipboard');
    } catch (e) {
      console.log('[Anchr] Proof:', JSON.stringify(proof).slice(0, 200));
    }

    done(proof);
  },
};
```

> **注意:** Coinbase Commerce のレスポンスは Charge の内容によって ~1-4KB。
> headers + body が 4096 を超える場合は `--max-recv-data 8192` に増やす
> （ECDSA なので 8192 でも数秒で完了する）。

レスポンスサイズの確認:
```bash
curl -s --http1.1 -o /dev/null -w 'headers: %{size_header}\nbody: %{size_download}\n' \
  -H "X-CC-Api-Key: $COINBASE_COMMERCE_API_KEY" \
  -H "Accept: application/json" \
  -H "Accept-Encoding: identity" \
  -H "Connection: close" \
  "https://api.commerce.coinbase.com/charges/$CHARGE_ID"
```

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
    ✓ cryptographically verified from api.commerce.coinbase.com
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
| Commerce API で 401 | `X-CC-Api-Key` ヘッダーが正しいか確認 |
| Charge ID が分からない | Step 5 の API コマンドで最新の charge を取得 |
| レスポンスが 4096 を超える | `--max-recv-data 8192` に増やす (ECDSA なので速い) |
