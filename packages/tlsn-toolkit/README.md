# tlsn-toolkit

Application-layer toolkit for TLSNotary presentation verification on top of the upstream `tlsn-verifier` Rust binary.

## Status

🚧 **WIP — being extracted from anchr monorepo (started 2026-04-26)**

See [`docs/refactor-plan.md`](../../docs/refactor-plan.md) for extraction progress.

## Scope

What this package provides on top of upstream TLSNotary:

- **Replay protection** — SHA-256 based deduplication of accepted presentations
- **ReDoS-safe condition language** — `contains` / `regex` / `jsonpath` evaluators with catastrophic-backtracking guard (`isSuspiciousRegex`)
- **Server identity matching** — verified server name vs target URL hostname
- **Attestation freshness** — configurable max-age policy on the verified timestamp
- **Subprocess wrapper** — invokes the `tlsn-verifier` binary, marshals stdin/stdout, enforces timeout
- **Selective disclosure safety net** — `validateNoCredentials` post-verification check for credential leakage

What this package does NOT do:

- Bind verified data to payment (that's `cashu-proof-bind` once extracted)
- Marketplace / Nostr discovery (that's `core-nostr-dvm` once extracted)
- The actual MPC-TLS cryptography (that's the upstream `tlsn-verifier` Rust binary)

## Public API (planned)

```typescript
import { validateTlsn, evaluateCondition, isTlsnVerifierAvailable } from "tlsn-toolkit/tlsn-validation";
import { validateNoCredentials, SENSITIVE_HEADER_NAMES } from "tlsn-toolkit/proof-redaction";
```

## License

MIT
