# Blossom NIP-23 Blog Publishing

Created: 2026-05-10

## Decision

Use this publishing flow for Anchr development articles:

- Source: source-controlled Markdown.
- Canonical page: rendered personal blog article.
- Subscription: RSS entry pointing to the canonical page.
- Nostr distribution: NIP-23 long-form event pointing to the canonical page.
- Media storage: self-hosted Blossom for images, diagrams, downloads, and other
  article assets when needed.

The first workflow does not define an Anchr-specific wire payload.

## Article Flow

1. Write the article as Markdown.
2. Render and publish the canonical blog page.
3. Upload article media to Blossom when external assets are needed.
4. Rewrite article media references to their final HTTPS URLs.
5. Publish or update the RSS entry.
6. Publish or update the NIP-23 event.
7. Write a local publish receipt.

If an article has no external media or downloads, Blossom is not required for
that article.

## Blossom Assets

When Blossom is used:

- Publish a BUD-03 `kind:10063` server list for the author.
- Put Blossom server URLs in `server` tags.
- Leave `.content` empty because BUD-03 does not use it.
- Upload assets with BUD-02.
- Store the returned Blob Descriptor fields without renaming them:
  `url`, `sha256`, `size`, `type`, `uploaded`.
- Reference the returned HTTPS asset URLs from the blog HTML and NIP-23
  Markdown.

BUD-03 server list shape:

```json
{
  "kind": 10063,
  "content": "",
  "created_at": 1778352000,
  "tags": [
    ["server", "https://blossom.example.com"]
  ],
  "pubkey": "<author hex pubkey>",
  "id": "<event id>",
  "sig": "<signature>"
}
```

## NIP-23 Event

Publish a `kind:30023` event with Markdown content.

Required tags for this workflow:

- `["d", "<slug>"]`
- `["title", "<article title>"]`
- `["summary", "<short summary>"]`
- `["published_at", "<first published unix timestamp>"]`
- `["r", "<canonical blog URL>"]`
- one `["t", "<topic>"]` tag per topic

Optional tags:

- `["image", "<cover image HTTPS URL>"]`

For short and medium articles, the event content may contain the full Markdown
body. For long articles, publish a summary and canonical link. Do not embed HTML
in the NIP-23 content.

Updates publish a new event with the same `d` tag and original `published_at`.
`created_at` is the update time.

## RSS

RSS entries should include:

- canonical URL
- title
- summary
- publication time
- update time when available

RSS should point readers to the canonical blog page.

## Failure Handling

- If blog deployment fails, do not publish RSS or NIP-23.
- If Blossom asset upload fails, stop before publishing the article with those
  asset references.
- If RSS succeeds but NIP-23 publish fails, keep the canonical article live and
  retry NIP-23 with the same slug and metadata.
- If an asset changes, upload the new asset and update the canonical article
  reference.

The local publish receipt should record:

- canonical URL
- asset hashes and Blob Descriptors when Blossom is used
- RSS item id
- NIP-23 address or event id
- relay publish result
- timestamp

## Compatibility

Checked on 2026-05-10:

- NIP-23
- Blossom BUD-01
- Blossom BUD-02
- Blossom BUD-03

Treat those upstream documents as living specifications. If they change, update
this document intentionally instead of silently changing the publishing payloads.

## Sources

Referenced: 2026-05-10

- [Publishing Storage Comparison](publishing-storage-comparison.md)
- [Development Publishing Strategy](development-publishing-strategy.md)
- [Blossom specification repository](https://github.com/hzrd149/blossom/tree/ef3c79e40d38cee6cdc974056ae86a582e708197)
- [Blossom BUD-01: Server requirements and blob retrieval](https://github.com/hzrd149/blossom/blob/ef3c79e40d38cee6cdc974056ae86a582e708197/buds/01.md)
- [Blossom BUD-02: Blob upload](https://github.com/hzrd149/blossom/blob/ef3c79e40d38cee6cdc974056ae86a582e708197/buds/02.md)
- [Blossom BUD-03: User Server List](https://github.com/hzrd149/blossom/blob/ef3c79e40d38cee6cdc974056ae86a582e708197/buds/03.md)
- [NIP-23: Long-form Content](https://github.com/nostr-protocol/nips/blob/05d3f198c61c2732ccf15ba8005299365dabb8e0/23.md)
