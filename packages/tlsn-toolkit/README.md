# @anchr/tlsn-toolkit

Application-layer TLSNotary toolkit: wraps the upstream `tlsn-verifier` Rust binary with replay protection, ReDoS-safe condition evaluation, server-identity matching, attestation freshness checks, and credential-leakage safeguards.

## Install

```jsonc
{
  "imports": {
    "@anchr/tlsn-toolkit": "jsr:@anchr/tlsn-toolkit@^0.1",
    "@anchr/core-runtime": "jsr:@anchr/core-runtime@^0.1"
  }
}
```

## Prerequisites

- The `tlsn-verifier` binary must be on `PATH` or built from upstream `tlsnotary/tlsn`. The toolkit auto-detects the binary; if absent, `validateTlsn()` returns `available: false`.

## Public API

```typescript
import {
  validateTlsn,
  evaluateCondition,
  isTlsnVerifierAvailable,
  isSuspiciousRegex,
  type TlsnValidationResult,
} from "@anchr/tlsn-toolkit/tlsn-validation";

import {
  validateNoCredentials,
  SENSITIVE_HEADER_NAMES,
} from "@anchr/tlsn-toolkit/proof-redaction";
```

## What this package adds on top of upstream TLSNotary

- **Replay protection** — SHA-256 dedup of accepted presentations
- **ReDoS-safe condition language** — `contains` / `regex` / `jsonpath` evaluators with catastrophic-backtracking guard
- **Server identity matching** — verified server name vs target URL hostname
- **Attestation freshness** — configurable max-age policy on the verified timestamp
- **Subprocess wrapper** — invokes `tlsn-verifier` with timeout + stdin/stdout marshalling
- **Credential leakage guard** — `validateNoCredentials` blocks Bearer/Basic/api_key patterns from being published

## Tests

```bash
deno task test
```

Validation tests use a mock verifier binary so they run without the real Rust crate built.

## Dependencies

- `@anchr/core-runtime` — for `spawn`, module-dir lookup, shared logger
- `TlsnAttestation` / `TlsnRequirement` / `TlsnVerifiedData` are exposed
  from this package itself at `@anchr/tlsn-toolkit/tlsn-types`.

## License

MIT
