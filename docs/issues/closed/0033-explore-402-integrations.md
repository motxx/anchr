# Explore 402 integrations

Created: 2026-05-15
Model: Codex (GPT-5)
Completed: 2026-05-15

## Priority

investigation

## Dependencies

Depends on:
- None

Blocks:
- None

## Summary

Explore whether Anchr should support HTTP 402-style payment integrations such
as x402 or L402, without preselecting the integration layer. The outcome should
identify one or more viable paths and recommend whether the first implementation
belongs in an example, an adapter, an MCP/HTTP ingress, an SDK helper, or a
protocol-facing profile.

## Rationale

Anchr's core protocol currently centers on Customer / Provider / Oracle
coordination, proof verification, and conditional settlement rather than simple
pay-per-request HTTP access. That suggests 402 integrations may fit best as
runtime adapters or app-owned entry points, but the repository should examine
the options before committing to a shape.

Relevant local boundaries:

- `docs/architecture.md` keeps MCP, CLI, HTTP gateway, mobile, web, and hosted
  endpoints as adapters rather than protocol actors.
- `specs/protocol-contract.md` defines the universal lifecycle and settlement
  requirements that a 402 integration must not weaken.
- `docs/universality-boundaries.md` explains when an integration should stay in
  `example/`, package docs, or adapter code instead of being promoted to a
  universal protocol contract.

External protocols to consider:

- x402: HTTP 402 payment requirements, signed payment payloads, facilitators,
  and settlement responses.
- L402: Lightning invoice preimage plus macaroon-style authorization for paid
  HTTP or gRPC resources.

## Plan

- Compare x402 and L402 against Anchr's request, offer, selection, proof,
  Oracle release, and redeem lifecycle.
- Identify concrete integration candidates, including example-only demos,
  app-owned HTTP routes, MCP tools, Oracle verification endpoint charging,
  Provider API monetization, SDK convenience helpers, or a transport profile.
- Document which candidates preserve the current settlement and verification
  invariants, and which would require new threat-model entries or tests.
- Recommend the smallest first implementation target and the files or packages
  it should touch.
- If implementation is recommended, create follow-up issues with narrowly
  closeable scope.

## Resolution

Implemented by updating:

- `docs/http-402-integrations.md`

Verified with:

- `deno task lint:strict`

Harness update:

- `docs/http-402-integrations.md` records the boundary decision and routes
  future implementation through existing example smoke, universality-boundary,
  threat-model, and silent-bypass harnesses.

Review residuals:

- None

Follow-up:

- None
