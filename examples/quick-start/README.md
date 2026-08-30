# Quick Start

Status: Testnet

Publish a Request Notice to a Nostr relay with SDK-built events and read it
back. One actor, one relay round trip — the smallest observable proof that the
SDK follows the protocol specification against a real relay.

## User flow

You supply a relay URL. The example generates a fresh ephemeral keypair,
publishes a kind `5300` Request Notice under it, subscribes, and prints the
Request Notice the relay echoes back. Success is the echoed `query_id` matching
the published one.

## Run

```sh
NOSTR_RELAYS=wss://your-relay.example deno run --allow-net --allow-env examples/quick-start/main.ts
```

Any NIP-01 relay works; a comma-separated list publishes to several. See
`.env.example` for the configuration shape.

## Boundaries

- **Real dependency:** the relay you supply.
- **No payment is locked.** The Request Notice carries only public discovery
  fields — `query_id`, Proof Schema URL, ephemeral pubkeys, `max_amount_sats`, expiry.
  Payment locking and the full Customer/Provider/Oracle exchange are the
  [`paid-request-simulation`](../paid-request-simulation/) lesson.
- **Nothing private touches the relay.** The canonical parser rejects Request
  Notices carrying predicate, payment, or execution material
  (`specs/messaging.md`).

## Smoke test

```sh
deno task -c examples/quick-start/deno.json smoke
```

Runs the same code path against the deterministic in-memory relay from
`@anchr/sdk/testing` — no third-party relay is contacted in CI.
