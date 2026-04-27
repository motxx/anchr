# Kannagi vs Polymarket — market-maker gap analysis

What the bot fleet under `scripts/bot-fleet/` exercised against the current
Kannagi (巫) prediction-market platform, and which Polymarket-style
liquidity behaviors are not yet expressible. Captured 2026-04-28 against
commit-tip `e457e3d`.

The fleet runs real Cashu wallets on a regtest Lightning + Cashu mint and
posts P2PK-locked exchange tokens through the actual `POST /markets/:id
/bet` and `POST /markets/:id/submit-token` paths — no mock state. Each
gap below is a concrete behavior the fleet *cannot* implement under the
current API.

## TL;DR — biggest gaps

| # | Gap | Polymarket behavior | Kannagi today |
|---|---|---|---|
| 1 | Limit prices | Orders carry a price; depth book at $0.01–$0.99 | Only amount; "price" emerges from pool ratio after a match |
| 2 | Push notifications | Order/match/fill events stream to subscribers | `POST /bet` returns matches only to the triggering bet; earlier bettors must poll `GET /markets/:id?pubkey=` |
| 3 | Order cancellation | `cancelOrder` REST + bulk-cancel | `OrderBook.cancelOrder` exists but no HTTP route |
| 4 | Continuous quoting | MMs post + replace many orders/sec at multiple price levels | Match is FIFO greedy 1:1 over equal amounts; nothing to "quote against" |
| 5 | Partial fills semantics | Implicit; remainder stays in book | Implicit; remainder stays as `remaining_sats` — works, but UI never shows it |

The first two are the heavy ones — without them the platform is a
*parimutuel pool*, not a CLOB. The bot fleet works around (2) by polling
and around (1) by pretending bias is price; that's enough to validate
match formation but doesn't model the PM-style "MM keeps the spread
narrow" loop.

## Architectural shape

### Polymarket
```
Bidder            CLOB              Asker
  │  buy YES @ 65¢     │     sell YES @ 65¢   │
  │ ─────────────────► │ ◄─────────────────── │
  │                    │                      │
  │                    │  match @ 65¢         │
  │ ◄────────────────  │  ────────────────►   │
  │                    │                      │
                  Prices ladder
                $0.01 .. $0.65 .. $0.99
        (depth at every cent — many MM orders)
```

Outcomes are tokenized at the CTF level; settlement is on-chain after the
oracle resolves to YES or NO. Each side trades against a continuous order
book.

### Kannagi (current)
```
YES bettor              Order book              NO bettor
  │  bet YES 100 sats        │      bet NO 100 sats   │
  │ ────────────────────────►│ ◄──────────────────── │
  │                          │                        │
  │ greedy FIFO match @ equal amount │
  │            paired                │
  │   pool: yes=100, no=100  │
  │   ratio: 50/50           │
  │
  │ if YES pool > NO pool, the *next* YES
  │ bettor extends the imbalance — no
  │ "price" the bettor can post against.
```

There is no price discovery before match — the implicit "price" of YES is
`yes_pool / (yes_pool + no_pool)` derived from the *result* of all bets so
far, not chosen by either side at order time.

## Concrete fleet observations

`scripts/bot-fleet/run.ts` drives a steady-state with 4 YES-leaning + 4
NO-leaning bots, ~131k sats each, betting at `BET_SIZE_FACTOR=0.05` of
each market's `typical_bet_sats`. Across `POLYMARKET_SEED_MARKETS`
(13 markets, mixed categories):

- Pool ratio per market converges toward each market's seeded `yes_bias`
  within ~3 rounds. Acceptable directional behavior.
- The matchmaker pairs roughly half of bets immediately; the rest sit as
  open orders until a subsequent round on the *opposite* side triggers
  matching. Bots learn about their match only via polling — measured
  end-to-end latency is `INTERVAL_MS` at worst, since the polling pass
  runs after each round.
- No bot ever cancels an order. Polymarket MMs cancel + replace constantly
  to track the mid; Kannagi bots can't.
- All "bets" are 1:1 amount swaps. There is no spread, no taker/maker
  distinction, no ladder. A Polymarket MM strategy that posts asks at
  $0.66, $0.67, $0.68 to capture spread has nothing to map to.

## Recommended platform improvements (ordered by impact)

### 1. Push channel for order events (Nostr / SSE)
Smallest unblocking change for the bot fleet. Expose:

- A WebSocket `/markets/:id/stream` or a Nostr-published kind for
  match-formed / order-filled / order-cancelled events.
- Bots subscribe instead of polling. Latency drops from `INTERVAL_MS` to
  one round-trip. Polymarket MMs assume sub-second feedback.

### 2. Order cancellation HTTP endpoint
The `OrderBook.cancelOrder` primitive already exists (`example
/prediction-market/src/order-book.ts:31`). Adding `DELETE /markets/:id
/orders/:orderId` (with `bettor_pubkey` auth) is mechanical. Without it
bots that change their mind have to wait for the order to fill or for
the market to expire.

### 3. Limit prices
The big one. Two routes:

- **Continuous price model (CLOB):** add a `price_cents: 1..99` field on
  `OpenOrder`. Matching pairs YES@p with NO@(100-p) at amount = min
  (yes.size, no.size). Pool aggregates become a histogram instead of a
  scalar. UI gains a real depth chart. Maximum fidelity to Polymarket but
  a substantial refactor of `order-book.ts` and the
  `MatchedBetPair` schema.
- **Bias-bucket model (lighter):** keep the parimutuel pool, but let
  bettors set a **maximum acceptable implied price** at order time. The
  matcher rejects bets whose implied price (after their own contribution)
  would exceed the cap. Cheaper to implement, gives users price control,
  doesn't require a CLOB.

### 4. Maker / taker fees
Polymarket charges a fee on takers and rebates makers, which is what
encourages MMs to provide liquidity. Kannagi takes a flat `fee_ppm` on
the pool at resolution. Splitting that into maker / taker tracks
reproduces the incentive surface.

### 5. Order book depth in market detail
`GET /markets/:id` exposes `open_orders: count` only. Returning the
`OpenOrder` array (sorted, optionally aggregated) lets the UI render
depth — even before limit prices land, surfacing per-side queue length
helps users size bets.

## What the fleet code can do today, unchanged

- Real participation with regtest funds (`MarketMakerBot` in
  `scripts/bot-fleet/bot.ts`).
- Multi-market, multi-bot, multi-round orchestration
  (`scripts/bot-fleet/fleet.ts`).
- Continuous activity (`scripts/bot-fleet/run.ts`) with rate limited by
  `FLEET_INTERVAL_MS` env.
- E2E-tested in `e2e/bot-fleet.test.ts` (single match) and
  `e2e/nip60-user-flow.test.ts` (NIP-60-backed user via the same path).

## What the fleet code cannot model yet

- Polymarket-style continuous quoting at multiple price levels
  (blocked by gap #1).
- Tight-spread MM strategies that respond to price moves (blocked by
  #1, #2).
- Order replacement / cancellation churn (blocked by #3).
