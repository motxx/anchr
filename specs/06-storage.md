# Spec 06: Storage

## Abstract

Anchr uses Blossom for content-addressed blob storage with end-to-end encryption. Blossom servers never see plaintext. This spec defines the encryption scheme, upload/download lifecycle, and key distribution.

## Blossom (BUD-01~06)

Blossom is a content-addressed blob storage protocol. Blobs are identified by their SHA-256 hash. Anchr uses Blossom servers as dumb storage — all encryption happens client-side.

## Encryption Scheme

AES-256-GCM with random key and IV per blob.

### Upload

1. Worker produces proof data (TLSNotary presentation, photo, etc.).
2. EXIF metadata is stripped from photos (privacy).
3. A random AES-256-GCM key and IV are generated.
4. Blob is encrypted: `ciphertext = AES-256-GCM(key, iv, plaintext)`.
5. `hash = SHA-256(ciphertext)` is computed.
6. Ciphertext is uploaded to one or more Blossom servers.
7. Blossom returns the blob URL(s) based on the hash.

### Key Distribution

The encryption key and IV are distributed via NIP-44 encrypted Nostr events:

| Recipient | Purpose |
|-----------|---------|
| Oracle | Decrypt and verify the proof |
| Requester | Download and access the verified data |

Keys are ephemeral and per-blob. They are included in the `blossom_keys` field of the QueryResponsePayload (Spec 05).

### Download

1. Recipient retrieves the ciphertext from Blossom using the blob hash.
2. Recipient decrypts using the key/IV received via NIP-44.
3. Plaintext is verified against the expected content type.

## BlossomKeyMaterial

| Field | Description |
|-------|-------------|
| `encrypt_key` | Hex-encoded AES-256-GCM key |
| `encrypt_iv` | Hex-encoded AES-256-GCM IV |

## AttachmentRef

Each blob is referenced by:

| Field | Description |
|-------|-------------|
| `id` | Unique attachment identifier |
| `uri` | Blossom URL |
| `mime_type` | Content type |
| `storage_kind` | `blossom` or `external` |
| `blossom_hash` | SHA-256 of the encrypted blob |
| `blossom_servers` | Server URLs where the blob is stored |

## Multi-Server Redundancy

Blobs may be uploaded to multiple Blossom servers for redundancy. The `blossom_servers` field lists all servers where the blob is available. Download attempts servers in order with exponential backoff on failure.

## Security Properties

| Property | Guarantee |
|----------|-----------|
| Server blindness | Blossom servers see only encrypted bytes |
| Forward secrecy | Per-blob random keys; compromising one key does not affect others |
| Content addressing | SHA-256 hash ensures integrity |
| Access control | Only parties with NIP-44 decryption keys can access plaintext |
