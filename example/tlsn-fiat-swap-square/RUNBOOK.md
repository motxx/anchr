# 渡(Watari) — Testnet Runbook

Square Sandbox 決済を TLSNotary で証明し、testnet/regtest Cashu ecash
と交換する手順です。

このexampleはCustomer/Provider package primitivesで動きます。必要な通信相手は
Nostr relay、Cashu mint、Oracleだけです。reference host / middleman の
`/queries`、`/quotes`、`/select`、`/begin` APIは使いません。

## 0. Square Sandbox

1. https://developer.squareup.com/apps でアプリを作成します。
2. Sandbox Access Tokenを取得します。
3. Sandbox DashboardでPayment Linkを作ります。

APIでPayment Linkを作る場合:

```bash
curl -X POST https://connect.squareupsandbox.com/v2/online-checkout/payment-links \
  -H "Authorization: Bearer $SQUARE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "quick_pay": {
      "name": "Watari Test Payment",
      "price_money": { "amount": 100, "currency": "JPY" },
      "location_id": "'$SQUARE_LOCATION_ID'"
    }
  }' | jq -r '.payment_link.url'
```

## 1. Local Infra

```bash
docker compose up -d
docker compose restart cashu-mint
docker compose ps
```

Default endpoints:

- Nostr relay: `ws://localhost:7777`
- Cashu mint: `http://localhost:3338`

Oracle must also be running. The Customer side needs an Oracle hash endpoint
such as `http://localhost:3001/hash`; after verifying the Provider's kind 6300
TLSN result, the Oracle must send the preimage to the Provider over Nostr DM.

## 2. Seller / Customer

Seller locks testnet/regtest Cashu proofs and requests proof that the Square
payment completed.

Required env:

```bash
export NOSTR_RELAYS=ws://localhost:7777
export CASHU_MINT_URL=http://localhost:3338
export WATARI_ORACLE_ENDPOINT=http://localhost:3001
export WATARI_ORACLE_PUBKEY=<oracle-pubkey-hex>

export SQUARE_PAYMENT_LINK=https://square.link/u/...
export WATARI_AMOUNT_SATS=1000
export WATARI_FIAT_AMOUNT_MINOR=100
export WATARI_FIAT_CURRENCY=JPY
export WATARI_SQUARE_LOCATION_ID=<seller-square-location-id> # optional

export WATARI_SOURCE_PROOFS_JSON='[{"id":"...","amount":1000,"secret":"...","C":"..."}]'
```

Optional:

```bash
export WATARI_PROVIDER_PUBKEY=<buyer-provider-pubkey-hex>
export WATARI_QUOTE_WINDOW_MS=30000
export WATARI_RESULT_TIMEOUT_MS=300000
export WATARI_LOCKTIME_SECONDS=3600
```

Run:

```bash
deno task watari:seller
```

Keep this terminal open. It publishes a kind 5300 request, waits for Provider
quotes, binds the selected Provider at the Cashu mint, and waits for the kind
6300 result.

## 3. Buyer Pays Square

Use the Square Payment Link, or create a Sandbox payment by API:

```bash
LOCATION_ID=$(curl -s https://connect.squareupsandbox.com/v2/locations \
  -H "Authorization: Bearer $SQUARE_ACCESS_TOKEN" | jq -r '.locations[0].id')

curl -s -X POST https://connect.squareupsandbox.com/v2/payments \
  -H "Authorization: Bearer $SQUARE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "source_id": "cnon:card-nonce-ok",
    "idempotency_key": "'$(uuidgen)'",
    "amount_money": { "amount": 100, "currency": "JPY" },
    "location_id": "'$LOCATION_ID'"
  }' | jq '{id: .payment.id, status: .payment.status, amount: .payment.amount_money}'
```

Get the payment id:

```bash
curl -s https://connect.squareupsandbox.com/v2/payments \
  -H "Authorization: Bearer $SQUARE_ACCESS_TOKEN" \
  | jq '.payments[0] | {id, status, amount_money}'
```

## 4. Buyer / Provider

Buyer runs the Provider primitive. It quotes only matching Watari predicates and
redeems only after the Oracle releases the preimage.

```bash
export NOSTR_RELAYS=ws://localhost:7777
export CASHU_MINT_URL=http://localhost:3338
export WATARI_ORACLE_PUBKEY=<oracle-pubkey-hex>
export WATARI_PROVIDER_PRIVKEY=<nsec-or-hex-secret-key>

export WATARI_AMOUNT_SATS=1000
export WATARI_FIAT_AMOUNT_MINOR=100
export WATARI_FIAT_CURRENCY=JPY
export WATARI_SQUARE_LOCATION_ID=<seller-square-location-id> # if Seller pinned it
export WATARI_PAYMENT_ID=<square-payment-id>
```

## 5. TLSNotary Proof

Square uses ECDSA certificates, so the CLI path is fast enough for Testnet.

```bash
./crates/tlsn-prover/target/release/tlsn-prove \
  --verifier localhost:7046 \
  --max-recv-data 4096 \
  --max-sent-data 4096 \
  -H "Authorization: Bearer $SQUARE_ACCESS_TOKEN" \
  "https://connect.squareupsandbox.com/v2/payments/$WATARI_PAYMENT_ID" \
  -o proof.presentation.tlsn
```

Then run the Provider:

```bash
export WATARI_PROOF_FILE=proof.presentation.tlsn
deno task watari:buyer
```

The Provider publishes the encrypted kind 6300 result after selection. Once the
Oracle verifies the result and DMs the preimage, the Provider redeems the Cashu
HTLC at the mint.

## 6. Verification

Run local checks:

```bash
deno task watari:check
deno task watari:test
```

Docker/regtest integration is optional for this example path. Use it when you
need to validate the live mint/relay/oracle wiring, not for the pure predicate
and config checks above.

## Troubleshooting

| Problem                 | Action                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Buyer never quotes      | Check `WATARI_AMOUNT_SATS`, fiat amount/currency, optional location id, and Oracle pubkey match the Seller request.    |
| Seller gets no quotes   | Check both sides use the same `NOSTR_RELAYS` and the Buyer process is running before `WATARI_QUOTE_WINDOW_MS` expires. |
| Provider cannot produce | Set `WATARI_PAYMENT_ID` and either `WATARI_PROOF_FILE` or `WATARI_PROOF_BASE64`.                                       |
| Redeem never happens    | The Oracle must verify the kind 6300 result and send the preimage DM to the selected Provider.                         |
| Square API 401          | Use the Sandbox Access Token against `connect.squareupsandbox.com`.                                                    |
