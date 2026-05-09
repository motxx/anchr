# Development Publishing Strategy

Created: 2026-05-09

## Decision

Anchr development writing should use a personal blog as the canonical home.
RSS, Nostr long-form posts, Hacker News submissions, and other channels are
distribution layers. They should point back to the canonical article instead of
becoming separate sources of truth.

The publishing goal is to reach people working on verifiable data, agentic
workflows, self-sovereign infrastructure, Nostr, Cashu, Blossom, TLSNotary, and
related protocol design. Do not optimize the workflow around trend capture,
keyword volume, or high-frequency SEO content.

## Audience

The writing should assume a technically capable reader who may not already know
Anchr. The useful reader is usually one of these:

- A protocol implementer evaluating the architecture or wire formats.
- An application developer deciding whether the SDK model fits a product.
- A security reviewer checking the escrow, proof, and oracle assumptions.
- An operator deciding how to run relays, mints, Blossom servers, or oracles.
- A future contributor trying to understand why a design choice exists.

Articles should prefer durable context, tradeoffs, failure modes, and
reproducible evidence over announcements that only make sense at publication
time.

## Article Types

### Development Logs

Development logs record what changed, why it changed, and what remains open.
They are for readers following the project over time and for future maintainers
who need decision context.

Use them for:

- Refactor milestones.
- Closed issue batches.
- Removed prototypes or abandoned approaches.
- Test harness and tooling changes.

Avoid turning development logs into commit summaries. A good log explains the
shape of the change and the decision pressure behind it.

### Design Notes

Design notes are the main long-form format. They should explain a problem,
available options, the chosen direction, rejected alternatives, and the
consequences.

Use them for:

- Actor boundaries and SDK shape.
- Settlement, proof, and oracle invariants.
- Nostr, Cashu, Blossom, TLSNotary, or adapter tradeoffs.
- Migration decisions that affect public APIs or wire formats.

Design notes may link to repository specs and issue files, but they should be
readable without requiring the reader to inspect the whole repository.

### Release Notes

Release notes summarize externally useful changes. They are not a substitute
for changelogs, specs, or migration guides.

Use them when a reader can install, run, integrate, or test something new:

- Package releases.
- Example applications becoming runnable.
- Protocol or SDK surfaces stabilizing.
- Operator-facing deployment changes.

Release notes should include exact versions, affected packages, migration
notes, and links to deeper design material when the change is not obvious.

### Verification Reports

Verification reports document evidence. They should be more concrete than
design notes and should preserve commands, environment assumptions, observed
results, and residual risks.

Use them for:

- End-to-end protocol runs.
- TLSNotary, FROST, Cashu, Blossom, and Nostr interoperability checks.
- Security invariant tests.
- Performance or reliability measurements.

Reports should distinguish between what was proven, what was only exercised in
a reference implementation, and what remains a human risk acceptance.

## Canonical Publishing Flow

The canonical article source should live in a controlled authoring location,
such as the repository or a static-site source tree. The rendered personal blog
page is the canonical public URL.

The minimum flow is:

1. Write the article as source-controlled Markdown.
2. Render and publish it on the personal blog.
3. Publish or update the RSS entry from the canonical article metadata.
4. Publish a Nostr long-form event as a distribution copy or summary.
5. Share to Hacker News only when the article has a specific technical claim,
   demo, release, or postmortem that stands on its own.

Distribution channels should carry enough context for readers inside that
channel, but they should not diverge from the canonical page. Corrections should
be made on the canonical article first, then redistributed where the channel
supports edits or follow-up comments.

## Channel Roles

### Personal Blog

The personal blog is the source of truth for article identity, corrections,
canonical links, and long-term reading. It should remain readable over ordinary
HTTPS even if Nostr relays, Blossom mirrors, or social channels are unavailable.

### RSS

RSS is the stable subscription surface. It should carry title, canonical URL,
publication time, summary, and enough content for feed readers to decide whether
to open the full article.

### Nostr Long-Form

Nostr long-form posts are for identity-linked distribution and discussion. They
should use the same author identity chosen for the publishing workflow and
should include the canonical URL. Issue #0010 owns the exact Blossom and NIP-23
event shape.

### Hacker News

Hacker News is optional. Submit only articles that make a concrete technical
argument, release a usable artifact, or share an implementation lesson with an
audience beyond current Anchr followers.

Do not submit routine progress logs, thin release announcements, or articles
whose only purpose is search visibility.

## Editorial Standards

Every article should have a concrete reader problem and one primary takeaway.
The default structure is:

1. Context: the problem and who it matters to.
2. Decision or finding: what changed or what was learned.
3. Evidence: code, specs, tests, traces, screenshots, or operational results.
4. Tradeoffs: what the decision costs and what remains uncertain.
5. Links: relevant specs, issues, source files, releases, or external sources.

Avoid:

- SEO keyword stuffing.
- High-volume posts that repeat repository activity without interpretation.
- Trend framing that would make the article obsolete without changing the
  underlying technical facts.
- Claims about decentralization, trustlessness, or security without specifying
  the assumptions and failure modes.
- Forked copies of the same article that can drift across channels.

## Correction Policy

Corrections should preserve trust in the canonical article:

- Fix small factual errors in place.
- Add dated correction notes for material changes.
- Publish follow-up posts when a design conclusion changes.
- Keep old links stable whenever possible.
- If a Nostr or HN distribution copy cannot be edited, add a follow-up comment
  or post that points to the corrected canonical article.

## Relationship To Storage

This document defines editorial and distribution policy. The storage substrate
decision is tracked separately in
[`docs/publishing-storage-comparison.md`](publishing-storage-comparison.md).

Issue #0010 should use this policy as its input when designing the
Blossom-first NIP-23 publishing workflow.
