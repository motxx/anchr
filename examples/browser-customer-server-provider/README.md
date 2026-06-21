# Browser Customer / Server Provider

Status: Implemented

Run a browser `createCustomer()` against a server-side `createProvider()`.
The browser creates the Customer request and the Cashu HTLC Payment Lock. The
server runs the Provider and an SDK Nostr Oracle. Docker provides the Nostr
relay, regtest Lightning/Cashu mint, and TLSN verifier server.

## User Flow

The browser Customer asks for a TLSNotary proof of the public bitFlyer BTC/JPY
ticker. The server Provider offers 16 sats, receives the selected real Cashu
Payment Lock, generates a TLSNotary presentation, and publishes the result. The
SDK Oracle verifies the presentation with the local TLSN verifier binary and
releases the preimage only after verification passes. The page renders `pass`
only after the Provider redeems the HTLC at the regtest Cashu mint.

## Dependencies

Real dependencies:

- Deno
- Docker Compose services from the repository root:
  - `relay`
  - `tlsn-verifier`
  - `bitcoind`
  - `lnd-mint`
  - `lnd-user`
  - `cashu-mint`
- Rust TLSN binaries:
  - `crates/tlsn-prover/target/debug/tlsn-prove`
  - `crates/tlsn-verifier/target/release/tlsn-verifier`
- Network access from the TLSN prover to
  `https://api.bitflyer.com/v1/ticker?product_code=BTC_JPY`

## Run

From the repository root:

```sh
deno task -c examples/browser-customer-server-provider/deno.json stack:up
deno task -c examples/browser-customer-server-provider/deno.json stack:init
cargo build --manifest-path crates/tlsn-prover/Cargo.toml
cargo build --release --manifest-path crates/tlsn-verifier/Cargo.toml
deno task -c examples/browser-customer-server-provider/deno.json smoke
```

For manual inspection:

```sh
deno task -c examples/browser-customer-server-provider/deno.json serve
```

Then open the printed local URL.

## Runtime Boundaries

- Browser: `createCustomer()` and a browser Cashu client create the Payment
  Lock. The Customer secret key does not leave the browser.
- Server: `createProvider()` runs in Deno and redeems the selected HTLC.
- Relay: browser and server traffic goes through the Docker Nostr relay. The
  HTTP/SSE endpoint is only a browser transport bridge to that relay.
- Mint: both actors use the same regtest Cashu mint. The browser reaches it
  through the server's `/mint` same-origin proxy.
- Oracle: `createOracleNostrService()` verifies the Provider result and
  releases the HTLC preimage over Nostr DM.
- Proof: the Provider runs the TLSN prover against the Docker verifier server;
  the Oracle verifies the presentation with the local TLSN verifier binary.

## Non-Production Boundary

This is a local regtest example. It demonstrates the browser/server Anchr
integration and real settlement path, but it is not mainnet custody guidance,
a production Oracle deployment, or a production relay/mint runbook.
