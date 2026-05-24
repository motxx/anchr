# @anchr/protocol

Pure protocol helpers for Anchr verifiable paid requests: Nostr event
builders/parsers, schema URL identifiers, shared role-neutral types, and
NIP-44/signing helpers.

## Install

```jsonc
{
  "imports": {
    "@anchr/protocol": "jsr:@anchr/protocol@^0.1"
  }
}
```

This package does not create relay clients, wallets, storage, verifier
implementations, or adapter manifests. The SDK owns those runtime ports.
