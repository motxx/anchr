# `@anchr/blossom` — Implementation Spec

## Cryptographic primitives

| Step | Algorithm | Notes |
|------|-----------|-------|
| Symmetric encryption | AES-256-GCM | 32-byte key + 12-byte IV, both freshly random per blob via `crypto.getRandomValues` |
| Content addressing | SHA-256 of ciphertext | `bytesToHex(sha256(encrypted))` — server only ever sees ciphertext, so the address is over ciphertext, not plaintext |
| Upload authorization | BUD-02 (kind 24242 Nostr event) | `t=upload`, `x=<hash>`, 5-minute `expiration` |

## Wire interaction

### Upload (PUT `/upload`)

```
Authorization: Nostr <base64(JSON(signed-kind-24242))>
Content-Type:  application/octet-stream
Body:          ciphertext
```

Servers respond 2xx on success. Multiple `serverUrls` are uploaded to
in parallel via `Promise.allSettled`; the function returns the URLs of
servers that accepted the blob.

### Download (GET `/<hash>`)

Plain HTTP GET. Body is the ciphertext. Decrypt with the key + IV that
travelled out-of-band (Anchr delivers them via NIP-44).

Retry policy: by default 3 attempts across the configured server set,
5-second backoff between attempts.

## Threat model

- **Server compromise**: server only ever sees ciphertext + a Nostr-signed
  upload token. It cannot read the blob, cannot impersonate the uploader,
  cannot mint new blobs that hash to a victim's address.
- **Network observer**: ciphertext + hash. No plaintext.
- **Replay**: the BUD-02 `expiration` tag bounds the upload-auth window
  to 5 minutes.
- **Content swap**: out of scope — content addressing makes this
  detectable at the recipient (the hash they were told to fetch must
  match what they receive). The recipient is responsible for verifying.

## Non-goals

- Key delivery (NIP-44, out-of-band, in-band — caller's choice)
- Plaintext addressing (would leak content equality across users)
- Metadata stripping (caller-side; this package does not parse content
  formats)
