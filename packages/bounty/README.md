# @anchr/bounty

`@anchr/bounty` is transitional flow scaffolding for the older bounty/query
lifecycle. Its root export is intentionally limited to domain and application
flow code. Concrete integrations live behind explicit subpath exports so apps
can depend on the smallest surface they use.

| Import | Owns |
| --- | --- |
| `@anchr/bounty` or `@anchr/bounty/flow` | Query domain, aggregate, repository, service, and flow ports. |
| `@anchr/bounty/attachments` | Attachment normalization, access handles, previews, and attachment URI validation. |
| `@anchr/bounty/escrow` | Cashu and FROST escrow providers plus preimage-store helpers. |
| `@anchr/bounty/nostr` | Nostr event, DM, transport, requester-service, and worker-service adapters. |
| `@anchr/bounty/oracle-client` | Oracle registry and HTTP Oracle client adapter. |
| `@anchr/bounty/oracle-service` | Oracle HTTP/Nostr service adapters. |
| `@anchr/bounty/verification` | Flow-level verification dispatch over proof engines. |
| `@anchr/bounty/claim-gate` | Reusable claim-gating flow while its final package ownership is unsettled. |

Do not add new concrete integrations to the root export. New app code should use
the subpath that matches the boundary it needs, or the actor SDK/adapters when
it does not need the transitional bounty lifecycle.
