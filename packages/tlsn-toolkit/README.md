# tlsn-toolkit

Application-layer toolkit for TLSNotary presentation verification on top of the upstream `tlsn-verifier` Rust binary.

## Scope

What this package provides on top of upstream TLSNotary:

- **Replay protection** — SHA-256 based deduplication of accepted presentations
- **ReDoS-safe condition language** — `contains` / `regex` / `jsonpath` evaluators with catastrophic-backtracking guard (`isSuspiciousRegex`)
- **Server identity matching** — verified server name vs target URL hostname
- **Attestation freshness** — configurable max-age policy on the verified timestamp
- **Subprocess wrapper** — invokes the `tlsn-verifier` binary, marshals stdin/stdout, enforces timeout
- **Selective disclosure safety net** — `validateNoCredentials` post-verification check for credential leakage

Out of scope:
- Bind verified data to payment (use `core-cashu` for HTLC binding)
- Marketplace / Nostr discovery (host server in `src/infrastructure/nostr`)
- The actual MPC-TLS cryptography (handled by the upstream `tlsn-verifier` Rust binary in `crates/tlsn-verifier/`)

## Public API

```typescript
import {
  validateTlsn,
  evaluateCondition,
  isTlsnVerifierAvailable,
  isSuspiciousRegex,
  type TlsnValidationResult,
} from "tlsn-toolkit/tlsn-validation";
import { validateNoCredentials, SENSITIVE_HEADER_NAMES } from "tlsn-toolkit/proof-redaction";
```

## Tests

```bash
deno test packages/tlsn-toolkit/ --allow-all
```

Validation tests use a mock verifier binary so they run without the real Rust crate built. Integration tests that exercise the host's `verify()` orchestrator live in `src/infrastructure/verification/verifier-tlsn.test.ts`.

## License

MIT
