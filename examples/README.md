# Examples

This directory contains optional learning material. Each `examples/<name>/`
entry teaches one `@anchr/sdk` or `@anchr/protocol` lesson for verifiable paid
requests.

## Maintained Examples

| Example                                               | Status     | Lesson                                                                                                             | Check                                        |
| ----------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| [`quick-start`](quick-start/)                         | Testnet    | Publish a Public Request Advertisement to a real relay with SDK-built events and read it back.                     | `deno task smoke` in `examples/quick-start/` |
| [`paid-request-simulation`](paid-request-simulation/) | Simulation | Compose Customer, Provider, Oracle, payment, proof, attachment, and adapter boundaries through public SDK imports. | `deno task test:examples`                    |
