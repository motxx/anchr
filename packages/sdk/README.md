# anchr-sdk

AI Agent SDK for Anchr — buy cryptographically verified data with sats.

## Install

```bash
bun add anchr-sdk
```

## Usage

```typescript
import { Anchr } from "anchr-sdk";

const anchr = new Anchr({ serverUrl: "https://anchr-app.fly.dev" });

// Get cryptographically verified BTC price
const result = await anchr.query({
  description: "BTC price from CoinGecko",
  targetUrl: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
  conditions: [{ type: "jsonpath", expression: "bitcoin.usd" }],
  maxSats: 21,
});

console.log(result.verified);    // true
console.log(result.data);        // { bitcoin: { usd: 71000 } }
console.log(result.serverName);  // "api.coingecko.com"
console.log(result.proof);       // base64 TLSNotary presentation
```

## How it works

1. `anchr.query()` creates a query on the Anchr server
2. A Worker picks up the query and fetches the target URL via MPC-TLS (TLSNotary)
3. The server cryptographically verifies the proof and checks conditions
4. Verified data is returned with the cryptographic presentation

No trust required — the proof is independently verifiable.

## API

### `new Anchr(config)`

```typescript
const anchr = new Anchr({
  serverUrl: "https://anchr-app.fly.dev",  // or http://localhost:3000 for local dev
  apiKey: "optional-api-key",          // for authenticated endpoints
  defaultTimeoutSeconds: 300,          // default query TTL
  pollIntervalMs: 3000,               // polling interval
});
```

### `anchr.query(options): Promise<QueryResult>`

Buy verified web data via TLSNotary.

```typescript
const result = await anchr.query({
  description: "What to verify",
  targetUrl: "https://api.example.com/data",
  conditions: [
    { type: "jsonpath", expression: "price", description: "Price exists" },
    { type: "contains", expression: "bitcoin" },
    { type: "regex", expression: "\"usd\":\\s*\\d+" },
  ],
  maxSats: 21,                  // bounty for the worker
  timeoutSeconds: 300,          // server-side TTL
  pollTimeoutSeconds: 60,       // client-side wait time
  maxAttestationAgeSeconds: 300, // max proof age
});
```

Returns:
```typescript
{
  verified: true,
  serverName: "api.example.com",
  data: { price: 42000 },      // parsed JSON (or raw string)
  rawBody: '{"price":42000}',
  proof: "base64...",           // TLSNotary presentation
  timestamp: 1774360000,
  checks: ["TLSNotary: presentation signature valid", ...],
  satsPaid: 21,
  queryId: "query_...",
}
```

### `anchr.photo(options): Promise<PhotoResult>`

Buy a verified photo via C2PA.

```typescript
const result = await anchr.photo({
  description: "渋谷スクランブル交差点の現在の様子",
  locationHint: "東京都渋谷区",
  expectedGps: { lat: 35.6595, lon: 139.7004 },
  maxGpsDistanceKm: 0.5,
  maxSats: 100,
});
```

### Worker API

```typescript
// List available queries
const queries = await anchr.listOpenQueries({ lat: 35.66, lon: 139.70 });

// Submit a TLSNotary proof
const result = await anchr.submitPresentation(queryId, presentationBase64);
```

## License

MIT
