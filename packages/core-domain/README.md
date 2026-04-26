# @anchr/core-domain

Shared TypeScript domain type definitions for the Anchr toolkit.

This package is **type-only** — no runtime code, just shapes. Zero runtime dependencies.

## Install

```jsonc
{
  "imports": {
    "@anchr/core-domain": "jsr:@anchr/core-domain@^0.1"
  }
}
```

## Public API

```typescript
import type {
  // Query lifecycle
  Query, QueryResult, QueryStatus, QueryInput, PaymentStatus,
  // Attachments + Blossom keys
  AttachmentRef, BlossomKeyMap, BlossomKeyMaterial,
  // TLSNotary types
  TlsnRequirement, TlsnAttestation, TlsnCondition, TlsnVerifiedData,
  // Verification
  VerificationFactor, VerificationDetail,
  // Bounty / quotes
  BountyInfo, QuoteInfo, RequesterMeta, SubmissionMeta,
  // HTLC / escrow
  HtlcInfo, EscrowInfo, EscrowType,
  // Quorum / GPS
  QuorumConfig, GpsCoord,
} from "@anchr/core-domain/types";

import type {
  Oracle, OracleAttestation, ThresholdOracleConfig,
} from "@anchr/core-domain/oracle-types";
```

## License

MIT
