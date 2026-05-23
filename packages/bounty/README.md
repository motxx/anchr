# Transitional infrastructure

This directory is no longer a published Anchr package. Reusable request
lifecycle code has moved to SDK-owned request modules. The remaining files are
transitional infrastructure awaiting adapter/helper migration.

| Area             | Owns                                                                               |
| ---------------- | ---------------------------------------------------------------------------------- |
| `attachments.ts` | Attachment normalization, access handles, previews, and attachment URI validation. |
| `escrow.ts`      | Cashu and FROST escrow providers plus preimage-store helpers.                      |
| `nostr.ts`       | Nostr event, DM, transport, requester-service, and worker-service adapters.        |
| `oracle-client`  | Oracle registry and HTTP Oracle client adapter.                                    |
| `oracle-service` | Oracle HTTP/Nostr service adapters.                                                |
| `verification`   | Flow-level verification dispatch over proof engines.                               |
| `claim-gate`     | Claim-gating flow pending deletion or a narrow paid-request SDK owner.             |

Do not add new public exports here. New app code should use SDK and protocol
surfaces while the remaining transitional files are moved or deleted.
