# Examples

This directory contains optional learning material. Each `examples/<name>/`
entry teaches one `@anchr/sdk` or `@anchr/protocol` lesson for verifiable paid
requests.

## Maintained Examples

| Example                                                                 | Status      | Lesson                                                                                                                                           | Check                                                             |
| ----------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| [`browser-customer-server-provider`](browser-customer-server-provider/) | Implemented | Run browser `createCustomer()` against server `createProvider()` with Docker Nostr relay, regtest Cashu mint, SDK Oracle, and TLSNotary proof verification. | `deno task smoke` in `examples/browser-customer-server-provider/` |
