# @anchr/protocol

Pure protocol helpers for Anchr wire formats: Nostr event builders/parsers,
schema URL identifiers, shared role-neutral types, and NIP-44/signing helpers.

## Install

```jsonc
{
  "imports": {
    "@anchr/protocol": "jsr:@anchr/protocol@^0.1"
  }
}
```

This package does not create relay clients, wallets, storage, or verifier
implementations. Actor SDKs inject those ports.

`src/capabilities.ts` defines technology-neutral adapter manifests and
capability checks. Concrete technologies such as Nostr relay transport, Cashu
HTLC payment, TLSNotary proof production, and Blossom attachment storage should
expose those manifests from their adapter packages instead of becoming required
dependencies of Customer, Provider, or Oracle core logic.
