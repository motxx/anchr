# TLSN Fiat Swap (Square) — Testnet Runbook

Square Sandbox 決済を TLSNotary で証明し、testnet/regtest Cashu ecash
と交換する手順です。

このexampleはCustomer/Provider package primitivesで動きます。必要な通信相手は
Nostr relay、Cashu mint、Oracleだけです。reference host / middleman の
`/queries`、`/offers`、`/select`、`/begin` APIは使いません。

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
      "name": "TLSN Fiat Swap Test Payment",
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

## 2. Configure

```bash
cd example/tlsn-fiat-swap-square
cp .env.example .env
```

Replace these placeholders in `.env`:

- `FIAT_SWAP_ORACLE_PUBKEY`: Oracle authority pubkey accepted by both sides.
- `FIAT_SWAP_ORACLE_ENDPOINT`: local Oracle HTTP endpoint for the Seller.
- `FIAT_SWAP_PROVIDER_PRIVKEY`: Buyer/Provider Nostr signing key.
- `FIAT_SWAP_SOURCE_PROOFS_JSON`: non-production Cashu proofs from the local
  mint.
- `SQUARE_ACCESS_TOKEN`, `SQUARE_PAYMENT_LINK`, and `FIAT_SWAP_PAYMENT_ID`:
  Square Sandbox values only.
- `FIAT_SWAP_PROOF_FILE` or `FIAT_SWAP_PROOF_BASE64`: TLSNotary presentation
  produced for the Square payment lookup.

Do not commit `.env`, source ecash proofs, Nostr private keys, Square access
tokens, or TLSNotary presentations that reveal private account data.

## 3. Seller / Customer

Seller locks testnet/regtest Cashu proofs and requests proof that the Square
payment completed.

Required env:

```bash
export NOSTR_RELAYS=ws://localhost:7777
export CASHU_MINT_URL=http://localhost:3338
export FIAT_SWAP_ORACLE_ENDPOINT=http://localhost:3001
export FIAT_SWAP_ORACLE_PUBKEY=<oracle-pubkey-hex>

export SQUARE_PAYMENT_LINK=https://square.link/u/...
export FIAT_SWAP_AMOUNT_SATS=1000
export FIAT_SWAP_FIAT_AMOUNT_MINOR=100
export FIAT_SWAP_FIAT_CURRENCY=JPY
export FIAT_SWAP_SQUARE_LOCATION_ID=<seller-square-location-id> # optional

export FIAT_SWAP_SOURCE_PROOFS_JSON='[{"id":"...","amount":1000,"secret":"...","C":"..."}]'
```

Optional:

```bash
export FIAT_SWAP_PROVIDER_PUBKEY=<buyer-provider-pubkey-hex>
export FIAT_SWAP_OFFER_WINDOW_MS=30000
export FIAT_SWAP_RESULT_TIMEOUT_MS=300000
export FIAT_SWAP_LOCKTIME_SECONDS=3600
```

Run:

```bash
deno task seller
```

Keep this terminal open. It publishes a kind 5300 request, waits for Provider
offers, binds the selected Provider at the Cashu mint, and waits for the kind
6300 result.

## 4. Buyer Pays Square

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

## 5. Buyer / Provider

Buyer runs the Provider primitive. It offers only matching fiat swap predicates
and redeems only after the Oracle releases the preimage.

```bash
export NOSTR_RELAYS=ws://localhost:7777
export CASHU_MINT_URL=http://localhost:3338
export FIAT_SWAP_ORACLE_PUBKEY=<oracle-pubkey-hex>
export FIAT_SWAP_PROVIDER_PRIVKEY=<nsec-or-hex-secret-key>

export FIAT_SWAP_AMOUNT_SATS=1000
export FIAT_SWAP_FIAT_AMOUNT_MINOR=100
export FIAT_SWAP_FIAT_CURRENCY=JPY
export FIAT_SWAP_SQUARE_LOCATION_ID=<seller-square-location-id> # if Seller pinned it
export FIAT_SWAP_PAYMENT_ID=<square-payment-id>
```

## 6. TLSNotary Proof

Square uses ECDSA certificates, so the CLI path is fast enough for Testnet.

```bash
./crates/tlsn-prover/target/release/tlsn-prove \
  --verifier localhost:7046 \
  --max-recv-data 4096 \
  --max-sent-data 4096 \
  -H "Authorization: Bearer $SQUARE_ACCESS_TOKEN" \
  "https://connect.squareupsandbox.com/v2/payments/$FIAT_SWAP_PAYMENT_ID" \
  -o proof.presentation.tlsn
```

Then run the Provider:

```bash
export FIAT_SWAP_PROOF_FILE=proof.presentation.tlsn
deno task buyer
```

The Provider publishes the encrypted kind 6300 result after selection. Once the
Oracle verifies the result and DMs the preimage, the Provider redeems the Cashu
HTLC at the mint.

## 7. Verification

Run the local smoke check:

```bash
deno task smoke
```

This calls the example's type/API check, local predicate/config tests, and
`.env.example` coverage. It does not contact Square Sandbox, generate a
TLSNotary presentation, or start relay/mint/Oracle infrastructure.

From the repository root, the equivalent commands are:

```bash
deno task fiat-swap:check
deno task fiat-swap:test
```

Docker/regtest integration is optional for this example path. Use it when you
need to validate the live mint/relay/oracle wiring.

The fiat swap regtest integration uses the real Docker-backed Cashu mint and
Nostr relay, with Square/TLSNotary represented by a fixture proof:

```bash
docker compose up -d
./scripts/init-regtest.sh
docker compose restart cashu-mint
ANCHR_E2E_REQUIRE_INFRA=1 deno test --node-modules-dir=false --no-lock \
  e2e/regtest/fiat-swap-square.test.ts \
  --allow-env --allow-read --allow-write --allow-net --allow-run --allow-sys --allow-ffi
```

## Troubleshooting

| Problem                 | Action                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Buyer never offers      | Check `FIAT_SWAP_AMOUNT_SATS`, fiat amount/currency, optional location id, and Oracle pubkey match the Seller request.    |
| Seller gets no offers   | Check both sides use the same `NOSTR_RELAYS` and the Buyer process is running before `FIAT_SWAP_OFFER_WINDOW_MS` expires. |
| Provider cannot produce | Set `FIAT_SWAP_PAYMENT_ID` and either `FIAT_SWAP_PROOF_FILE` or `FIAT_SWAP_PROOF_BASE64`.                                 |
| Redeem never happens    | The Oracle must verify the kind 6300 result and send the preimage DM to the selected Provider.                            |
| Square API 401          | Use the Sandbox Access Token against `connect.squareupsandbox.com`.                                                       |
