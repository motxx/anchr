# Publishing Storage Comparison

Created: 2026-05-09

## Decision

Use self-hosted Blossom as the first publishing storage target for Anchr
development articles, with NIP-23 as the social distribution layer. Do not make
IPFS the default publishing substrate for the first blog workflow.

IPFS remains acceptable as an optional mirror, export target, or future
redundancy backend. The decision is about the default authoring and publishing
path for a personal development blog, not a rejection of IPFS as a protocol.

## Evaluation

### IPFS

IPFS fits immutable, content-addressed publishing well. It has multiple active
implementations: Kubo, Helia, Boxo, Rainbow, Someguy, Lassie, Lotus, and others
are listed in the IPFS implementation catalogue. Kubo is described by the IPFS
docs as the first and most widely used all-in-one daemon, so implementation
gravity exists, but the ecosystem is not a single-implementation monoculture.

The stronger concern for a personal blog is operational availability. IPFS
content does not persist merely because a CID exists. The IPFS persistence docs
explain that nodes cache content opportunistically, storage is finite, cached
content can be garbage-collected, and content that should remain available must
be pinned to one or more nodes. The same docs explicitly warn that IPFS
discoverability does not guarantee persistent availability.

That pushes a small personal publisher toward one of three operational choices:

- Run and monitor a personal node plus pins.
- Pay and trust one or more pinning providers.
- Add Filecoin or an IPFS/Filecoin service for long-term storage.

For ordinary browser readers, IPFS usually also introduces a gateway choice.
The IPFS gateway docs distinguish local, public, recursive, non-recursive,
trusted, and trustless gateways. Public gateways are useful, but recursive
gateways are resource-intensive for operators and public utilities are not a
good critical path for a personal publishing system. The IPFS public utilities
docs list Foundation-operated gateways and describe hosted utilities as
best-effort services.

For Anchr's blog use case, IPFS is strongest when the goal is broad content
addressability and independent mirroring. It is weaker as the first workflow
because the author still has to solve pinning, gateway UX, and availability
policy before the publishing system is reliable.

### Blossom

Blossom is smaller and less general than IPFS, but it matches Anchr's current
publishing direction more directly. The Blossom specification defines HTTP
endpoints for storing blobs on publicly reachable media servers, identifies
blobs by SHA-256, and uses Nostr keys for authorization.

The core retrieval rule is simple: `GET /<sha256>` returns the blob, `HEAD
/<sha256>` checks metadata, and all endpoints live at the server root so clients
can talk to servers interchangeably. Uploads use `PUT /upload`; servers compute
the SHA-256 over the exact uploaded bytes and return a blob descriptor including
the public URL, hash, size, MIME type, and upload time.

Availability is explicit instead of ambient. BUD-03 lets an author publish a
Nostr `kind:10063` server list ordered by reliability or trust. Clients must
upload to at least the first server and may upload to all listed servers or use
BUD-04 mirroring. BUD-04 defines a server-side `/mirror` endpoint, so a publisher
can copy the same hash to additional servers without changing the blob identity.
BUD-10 also defines a `blossom:` URI that can carry the hash, extension, author,
server hints, and expected size.

This makes the operational contract suitable for a personal blog:

- The canonical author identity is the same Nostr key used for NIP-23 posts.
- The author can start with one self-hosted server and add mirrors later.
- Blob references remain hash-addressed across compatible servers.
- Retrieval fallback can use the author's Nostr-published server list.
- HTTP delivery stays browser-native without requiring IPFS gateway selection.

Blossom's weakness is maturity. The BUDs are draft documents, the server network
is smaller than IPFS, and retention is only as strong as the servers the author
operates or chooses. That is acceptable for the first Anchr blog workflow
because the system is explicitly self-hosted and Nostr-aligned.

### NIP-23

NIP-23 defines Nostr long-form content as `kind:30023` addressable events, with
Markdown content, `title`, `image`, `summary`, and `published_at` tags, and a
`d` tag for editable article identity.

For Anchr publishing, NIP-23 should distribute article metadata and social
reach. The canonical article source can remain in the repository or generated
static site. Blossom should store generated HTML, Markdown snapshots, images,
and attachments. NIP-23 should carry the article body or summary plus canonical
links and Blossom references, depending on the final workflow in issue #0010.

## Comparison

| Axis | IPFS default | Blossom default |
| --- | --- | --- |
| Self-sovereignty | Strong if the author runs nodes and pins content; weaker when relying on third-party pinning and gateways. | Strong for the intended path because the author can self-host a server and publish the server list with a Nostr key. |
| Migration | CIDs are portable, but publishing UX depends on pinning and gateway choices. | SHA-256 blob references are portable across Blossom servers; BUD-03 and BUD-04 make server migration and mirroring part of the protocol. |
| Reader reach | Broad via HTTP gateways, but gateway choice affects trust, origin isolation, and availability. | Direct HTTPS URLs work in browsers; Nostr clients can use server lists and Blossom URI hints as support matures. |
| Operational load | Requires pinning policy, node or provider management, and gateway decisions. | Requires operating one HTTP media server first; mirrors can be added incrementally. |
| Censorship resistance | Stronger when content is pinned and mirrored by independent parties. | Moderate at first; improves with multiple author-chosen Blossom servers and third-party mirrors. |
| Fit with Anchr | Useful as a future mirror because Anchr already keeps `storage_kind` extensible. | Best first fit because Anchr already uses Nostr and Blossom for large encrypted attachments. |

## Consequences

Issue #0009 can define the editorial policy around a personal blog as the
canonical publishing home, with Nostr/RSS/HN as distribution channels, without
waiting for an IPFS-first storage decision.

Issue #0010 should design a Blossom-first publishing flow:

- Article source lives in the repository or a static-site source tree.
- Generated article artifacts and media are uploaded to self-hosted Blossom.
- The author publishes a BUD-03 server list with the canonical self-hosted
  server first and optional mirrors after it.
- NIP-23 events carry the article identity, title, summary, published timestamp,
  tags, canonical URL, and Blossom references.
- IPFS export can be added later as a mirror target if a concrete reader or
  archival requirement appears.

## Sources

- [IPFS docs: Persistence, permanence, and pinning](https://docs.ipfs.tech/concepts/persistence/)
- [IPFS docs: IPFS implementations](https://docs.ipfs.tech/concepts/ipfs-implementations/)
- [IPFS docs: Install IPFS Kubo](https://docs.ipfs.tech/install/command-line/)
- [IPFS docs: IPFS Gateway](https://docs.ipfs.tech/concepts/ipfs-gateway/)
- [IPFS docs: Public IPFS Utilities](https://docs.ipfs.tech/concepts/public-utilities/)
- [IPFS docs: Measuring the IPFS network](https://docs.ipfs.tech/concepts/measuring/)
- [Blossom specification repository](https://github.com/hzrd149/blossom)
- [Blossom BUD-01: Server requirements and blob retrieval](https://github.com/hzrd149/blossom/blob/master/buds/01.md)
- [Blossom BUD-02: Blob upload](https://github.com/hzrd149/blossom/blob/master/buds/02.md)
- [Blossom BUD-03: User Server List](https://github.com/hzrd149/blossom/blob/master/buds/03.md)
- [Blossom BUD-04: Mirroring blobs](https://github.com/hzrd149/blossom/blob/master/buds/04.md)
- [Blossom BUD-10: Blossom URI Schema](https://github.com/hzrd149/blossom/blob/master/buds/10.md)
- [NIP-23: Long-form Content](https://nips.nostr.com/23)
