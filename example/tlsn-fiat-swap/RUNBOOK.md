# TLSNotary Fiat Swap — Runbook

Stripe テスト決済を TLSNotary で証明し、Anchr 経由で BTC と trustless に交換する E2E 手順。

**検証対象**: Stripe Payment Intents API (`api.stripe.com`) の JSON レスポンス
**証明方式**: TLSNotary Extension の DevConsole でプラグインコードを実行

---

## 0. 準備

### 0-1. TLSNotary Extension をダウンロード

```bash
curl -L -o /tmp/tlsn-extension.zip \
  https://github.com/tlsnotary/tlsn-extension/releases/download/0.1.0.1403/extension-0.1.0.1403.zip
mkdir -p /tmp/tlsn-extension
unzip -o /tmp/tlsn-extension.zip -d /tmp/tlsn-extension
```

### 0-2. Playwright の Chrome for Testing をインストール

```bash
npx playwright install chromium
```

### 0-3. Extension 付きで Chrome for Testing を起動

```bash
bun run scripts/launch-chrome-tlsn.ts
```

> `scripts/launch-chrome-tlsn.ts` の中身:
> ```typescript
> import { chromium } from "playwright";
>
> const context = await chromium.launchPersistentContext("/tmp/chrome-tlsn-profile", {
>   headless: false,
>   args: [
>     "--disable-extensions-except=/private/tmp/tlsn-extension",
>     "--load-extension=/private/tmp/tlsn-extension",
>     "--no-first-run",
>     "--no-default-browser-check",
>   ],
> });
>
> const sw = context.serviceWorkers().find(s => s.url().includes("background.bundle.js"));
> const extId = sw ? new URL(sw.url()).hostname : "unknown";
> console.log("Extension ID:", extId);
> console.log("DevConsole:", `chrome-extension://${extId}/devConsole.html`);
>
> await new Promise(() => {});
> ```

`chrome://extensions` で **TLSNotary** が有効になっていることを確認。

### 0-4. Stripe テストモードの準備

1. https://dashboard.stripe.com/register でアカウント作成 (初回のみ、メールだけで OK)
2. 左上のトグルが **「テストモード」** になっていることを確認
3. **API Keys** を取得: https://dashboard.stripe.com/test/apikeys
   - **Secret key** (`sk_test_...`) をコピー
4. **Payment Link** を作成:
   - Dashboard → Payment Links → + Create payment link
   - 「顧客が支払い金額を選択する」(Pay What You Want) を選択
   - Create → URL をコピー

---

## 1. インフラ起動

```bash
docker compose up -d

# Cashu Mint が起動に失敗していたら:
docker compose restart cashu-mint

# 確認 — blossom, relay, tlsn-verifier 等が Up
docker compose ps
```

## 2. Anchr サーバー起動

```bash
BLOSSOM_SERVERS=http://localhost:3333 \
NOSTR_RELAYS=ws://localhost:7777 \
CASHU_MINT_URL=http://localhost:3338 \
bun run dev
```

```bash
curl http://localhost:3000/health
# → {"ok":true}
```

---

## 3. Seller: オーダー作成

```bash
STRIPE_SECRET_KEY=sk_test_... \
STRIPE_PAYMENT_LINK=https://buy.stripe.com/test_... \
bun example/tlsn-fiat-swap/seller.ts
```

期待される出力:
```
=== TLSNotary Fiat Swap — Seller ===
Server: http://localhost:3000
Stripe Payment Link: https://buy.stripe.com/test_...

--- Order Created ---
Query ID: query_xxxxx
Escrowed: 100,000 sats in Cashu HTLC
Timeout:  1 hour

Monitoring order status...
  Status: pending (5s elapsed)
```

**このターミナルは開いたまま**にする。

---

## 4. Buyer: Stripe で支払い

Step 0 でセットアップした **Chrome for Testing** で:

1. Payment Link を開く
2. 金額を入力 (例: `100` = ¥100)
3. テストカード情報を入力:
   - カード番号: `4242 4242 4242 4242`
   - 有効期限: `12/30`
   - CVC: `123`
4. **「支払う」** をクリック
5. **「お支払いありがとうございます」** が表示されたら成功

## 5. Payment Intent ID を取得

支払い後、Stripe Dashboard から Payment Intent ID を取得する:

1. https://dashboard.stripe.com/test/payments を開く
2. 最新の支払いをクリック
3. URL から Payment Intent ID (`pi_...`) を確認

> **API で確認する方法:**
> ```bash
> curl -s https://api.stripe.com/v1/checkout/sessions \
>   -u "$STRIPE_SECRET_KEY:" \
>   -d limit=1 | jq '.data[0].payment_intent'
> ```
> Payment Intent ID (`pi_...`) が返る。

---

## 6. Buyer: TLSNotary proof 生成

Chrome for Testing の **TLSNotary DevConsole** (`chrome-extension://<id>/devConsole.html`) で以下のプラグインコードを貼り付けて **Run Code** をクリック。

**`PAYMENT_INTENT_ID` と `STRIPE_KEY` を実際の値に置き換える:**

```javascript
// Anchr: prove Stripe Payment Intent status via API
const PAYMENT_INTENT_ID = 'pi_xxxxx';  // ← Step 5 で取得した Payment Intent ID
const STRIPE_KEY = 'sk_test_xxxxx';    // ← Seller から受け取った Stripe Secret Key
const VERIFIER_URL = 'ws://localhost:7047';  // WS mode (Extension)
const PROXY_URL = 'ws://localhost:7047/proxy?token=api.stripe.com';

export default {
  config: {
    name: 'Anchr: Stripe API',
    description: 'Prove Stripe Payment Intent status',
    requests: [{
      method: 'GET',
      host: 'api.stripe.com',
      pathname: '/**',
      verifierUrl: VERIFIER_URL,
    }],
  },
  main: async () => {
    const proof = await prove(
      {
        url: `https://api.stripe.com/v1/payment_intents/${PAYMENT_INTENT_ID}`,
        method: 'GET',
        headers: {
          'Host': 'api.stripe.com',
          'Authorization': `Bearer ${STRIPE_KEY}`,
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
          // Authorization ヘッダーは REVEAL しない → proof に API Key が含まれない
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

**確認ポップアップ** が表示されたら **Allow** をクリック。

MPC-TLS セッションが開始され、完了すると Console に `[Anchr] Proof copied to clipboard` と表示される。

---

## 7. Buyer: proof を Anchr に提出

### 方法 A: Worker UI

1. http://localhost:3000 を開く
2. Web Proof クエリカードを展開
3. **TLSNotary proof JSON** をペースト (DevConsole でクリップボードにコピー済み)
4. **Submit** をクリック

### 方法 B: CLI

```bash
QUERY_ID="query_xxxxx"  # seller.ts の出力から

# DevConsole でコピーした proof JSON を base64 エンコードして submit
# (proof が .presentation.tlsn ファイルの場合)
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
    ✓ cryptographically verified from api.stripe.com
    ✓ server name matches target_url
    ✓ "status":"succeeded" condition satisfied
```

**Requester UI** (http://localhost:3000/requester):
- ステータス: **承認** (緑)
- 検証OK: TLSNotary 署名検証、ドメイン一致 (`api.stripe.com`)、条件一致 (`"status":"succeeded"`)

---

## 9. クリーンアップ

```bash
# Anchr サーバー停止: Ctrl+C
# Chrome for Testing を閉じる: Ctrl+C (launch-chrome-tlsn.ts)

docker compose down

rm -rf /tmp/chrome-tlsn-profile /tmp/tlsn-extension /tmp/tlsn-extension.zip
```

---

## トラブルシューティング

| 問題 | 対処 |
|------|------|
| Stripe「金額を入力してください」 | Pay What You Want の場合、金額欄に 0 以外を入力 |
| Extension が Verifier に接続しない | Verifier ログ確認: `docker compose logs tlsn-verifier` → `HTTP/WS on 0.0.0.0:7047` が出ているか |
| DevConsole で "User rejected plugin execution" | 確認ポップアップで **Allow** をクリックする。60秒以内に操作が必要 |
| DevConsole のコードが既定のままで上書きできない | Ctrl+A で全選択 → Ctrl+V でペースト |
| `Blossom upload failed` | `docker compose ps` で blossom が Up か確認 |
| `cashu-mint` が起動しない | `docker compose restart cashu-mint` |
| `port 3000 in use` | `lsof -ti:3000 \| xargs kill -9` |
| Buyer が "No open on-ramp orders" | Seller を先に実行 |
| Stripe API で 401 Unauthorized | `STRIPE_SECRET_KEY` が正しいか確認。テストモードの `sk_test_...` を使う |
| Payment Intent ID が分からない | `curl -s https://api.stripe.com/v1/checkout/sessions -u "$STRIPE_SECRET_KEY:" -d limit=1 \| jq '.data[0].payment_intent'` |
| MPC-TLS がハングする (Sending HTTP request... で止まる) | MPC 回路サイズが大きすぎる可能性。`--max-recv-data` を小さくする (下記参照) |

### MPC 回路サイズの調整

MPC-TLS の計算時間は回路サイズに比例する。デフォルト `--max-recv-data 4096` は多くのケースで十分。

**推奨値:**

| ユースケース | レスポンスサイズ | `--max-recv-data` | 目安 |
|---|---|---|---|
| CoinGecko (小さなJSON, ECDSA証明書) | ~1KB | `4096` | ~2秒 (release) |
| Stripe Payment Intent (RSA証明書) | ~2.9KB (headers+body) | `4096` | **RSA証明書のため MPC-TLS が非常に遅い** |
| Stripe Checkout Session | ~4KB (headers+body) | 4096では不足、8192では遅すぎる | **非推奨 → Payment Intent を使う** |
| 大きなレスポンス | >4KB | `8192`+ | release ビルド必須 |

> **なぜ Payment Intent か:** Checkout Session は headers+body で ~4KB あり `max_recv_data=4096` ギリギリでデッドロックする。Payment Intent は ~2.9KB で余裕がある。証明に必要な `status`, `amount`, `currency` は全て含まれる。

> **RSA 証明書の問題:** Stripe (`api.stripe.com`) は RSA 証明書を使用しており、MPC-TLS での RSA 署名検証は ECDSA と比べて桁違いに遅い。CoinGecko (ECDSA) は ~2秒で完了するが、Stripe (RSA) は同じ回路サイズでも数分以上かか��場合がある。証明方式は **TLSNotary Extension の DevConsole** (Step 6) を推奨。

**DevConsole (Extension) での指定:** Step 6 のプラグインコード内で `maxRecvData` の値を変更する。
