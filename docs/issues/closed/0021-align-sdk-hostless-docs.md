# Align SDK hostless docs

Created: 2026-05-15
Model: Codex (GPT-5)
Completed: 2026-05-15

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Align SDK-facing documentation with the hostless architecture. The current docs simultaneously say the reference host and mandatory REST compatibility surface are gone, while `docs/architecture.md` still describes `packages/sdk/` as an aggregate package with a "host REST client facade".

## Rationale

`docs/architecture.md` documents the reference-host removal and says the network has no default Anchr server, hosted reference URL, or mandatory REST compatibility surface. In the same package layout section, it still describes `sdk/` as "Aggregate convenience package plus host REST client facade", which reads like the removed host REST model remains part of the target package architecture.

`packages/sdk/README.md` presents Customer and Provider SDK usage as the primary public path, while `packages/sdk/src/client.ts` still exposes an `Anchr` HTTP client shape for app-owned HTTP surfaces. The docs should distinguish the current recommended actor SDK flow from any compatibility or app-adapter HTTP client surface without implying a reference host is part of the protocol.

## Plan

- Update `docs/architecture.md` package layout text for `packages/sdk/` so it describes the current aggregate SDK role without saying "host REST client facade".
- Audit nearby architecture prose for any implication that a shared Reference Host or mandatory Anchr REST API remains.
- Update `packages/sdk/README.md` if needed to make the Customer/Provider actor SDK path primary and label any HTTP client usage as app-owned adapter integration, not protocol infrastructure.
- Add a short cross-reference to the "Reference host removal" section where it helps prevent the same confusion from returning.

## Resolution

Implemented by updating:

- `docs/architecture.md`
- `packages/sdk/README.md`

Verified with:

- `deno task lint:fmt`
- `deno task lint:strict`

Harness update:

- None — the hostless SDK placement is a one-time architecture documentation decision now locked in `docs/architecture.md` and `packages/sdk/README.md`.

Review residuals:

- None

Follow-up:

- None
