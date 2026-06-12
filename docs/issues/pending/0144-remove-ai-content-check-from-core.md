# Remove the AI content check from the SDK core

Created: 2026-06-12
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- None

Blocks:
- 0142
- 0146

## Summary

The `ai_check` verification factor sends submitted proof evidence (photos,
video frames) to the Anthropic API for a vision-LLM relevance judgment. It
violates three premises at once and is advisory-only (its findings are
warnings that do not gate payment, per
`packages/sdk/src/proofs/verification/contract.ts:53`). Remove it from the
SDK core: delete the factor, the checker, the `@anthropic-ai/sdk`
dependency, and the ffmpeg frame-extraction path it drags in.

## Rationale

- **Privacy**: forwarding proof material to a centralized third-party API
  contradicts anonymity-first; the API key also links all checks run by one
  Oracle. Call sites: `packages/sdk/src/proofs/ai-content-check.ts` (338
  LOC), `packages/sdk/src/proofs/verification/checks/ai-content.ts:19-20`
  (reads `AI_CONTENT_CHECK` / `ANTHROPIC_API_KEY` from `Deno.env`).
- **Portability**: requires `Deno.env`, the Anthropic SDK, and spawning
  `ffmpeg` for video frames (`ai-content-check.ts`), none of which work in a
  browser.
- **Verifiability**: an LLM opinion is not a cryptographic proof; keeping it
  in the default path (`DEFAULT_VERIFICATION_FACTORS = ["gps", "ai_check"]`,
  `packages/sdk/src/values.ts:33-36`) teaches integrators the wrong trust
  model.
- A deployment that wants an LLM screen can implement it as an
  out-of-tree check once 0147 lands a registration API; it does not need to
  live in `packages/`.

## Acceptance

- No `ai_check` factor, no `@anthropic-ai/sdk` import, and no
  ffmpeg invocation remain under `packages/`.
- `DEFAULT_VERIFICATION_FACTORS` no longer includes `ai_check` (interim
  state until 0143/0146 settle the factor model).
- Behavior is locked by updated unit tests for the verifier registry and
  defaults.

## Verification

- No matches are expected: `rg -i "ai_check|anthropic|ffmpeg" packages/`
- `deno task test:all` passes.

## Plan

- Delete `packages/sdk/src/proofs/ai-content-check.ts`,
  `packages/sdk/src/proofs/verification/checks/ai-content.ts`, and their
  tests; remove the registry entry and the union member.
- Remove `@anthropic-ai/sdk` from `deno.json` imports and the
  `ANTHROPIC_API_KEY` / `AI_CONTENT_CHECK` keys from
  `packages/sdk/src/internal/runtime/config.ts`.
- Update `docs/` and `specs/` references to the `ai_check` factor.
