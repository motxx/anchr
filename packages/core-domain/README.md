# core-domain

Shared domain type definitions used across Anchr packages and the host server.

## Scope

- `Query`, `QueryResult`, `QueryStatus`, `QueryInput`, `PaymentStatus`, …
- `AttachmentRef`, `BlossomKeyMap`, `BlossomKeyMaterial`
- `TlsnRequirement`, `TlsnAttestation`, `TlsnCondition`, `TlsnVerifiedData`
- `VerificationFactor`, `VerificationDetail`
- `BountyInfo`, `QuoteInfo`, `RequesterMeta`, `SubmissionMeta`
- `HtlcInfo`, `EscrowInfo`, `EscrowType`
- `QuorumConfig`, `GpsCoord`
- `Oracle`, `OracleAttestation`, `ThresholdOracleConfig` (in `oracle-types`)

This package is intentionally type-only — no runtime code, just shared shapes.

## Public API

```typescript
import type {
  Query, QueryResult, QueryStatus, AttachmentRef,
  BlossomKeyMap, BlossomKeyMaterial,
  TlsnRequirement, TlsnAttestation, TlsnVerifiedData,
  VerificationFactor, VerificationDetail,
  BountyInfo, QuoteInfo, GpsCoord, EscrowInfo,
} from "core-domain/types";
import type {
  Oracle, OracleAttestation, ThresholdOracleConfig,
} from "core-domain/oracle-types";
```

## License

MIT
