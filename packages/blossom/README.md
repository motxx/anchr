# `@anchr/blossom`

Encrypted, content-addressed blob storage on top of
[Blossom](https://github.com/hzrd149/blossom) (BUD-01–06).

## Install

```jsonc
{
  "imports": {
    "@anchr/blossom": "jsr:@anchr/blossom@^0.1"
  }
}
```

## What this gives you

- `encryptBlob(data)` — AES-256-GCM, fresh random key + IV per blob.
- `uploadToBlossom(data, identity, serverUrls?)` — encrypt → upload to all
  servers in parallel, return the SHA-256 hash + key material.
- `downloadFromBlossom(hash, key, iv, serverUrls?)` — fetch from any configured
  server, decrypt, return plaintext.
- `getBlossomConfig()` / `isBlossomEnabled()` — read `BLOSSOM_SERVERS` env
  (comma-separated URLs).

## What you bring

- A `BlossomUploadIdentity` (`{ secretKey: Uint8Array }`) — used to sign BUD-02
  upload-auth events. Any Nostr identity is structurally compatible.
- `BLOSSOM_SERVERS` env var, or pass `serverUrls` explicitly.

## What this does not do

- EXIF stripping (caller's responsibility — this package doesn't know what kind
  of data it's storing).
- Key delivery (key material is returned to the caller; how it reaches the
  recipient is the caller's protocol decision — Anchr uses NIP-44).
- Any opinion about `AttachmentRef` shape or storage_kind discrimination — those
  are host-side concerns.

## Why a separate package

Blossom is a generic content-addressed primitive. Any Anchr composition that
needs to move opaque blobs end-to-end-encrypted between parties can use it; it
has no dependency on the query / oracle / settlement layers.
