# Align the repository with the six product premises (restructuring plan)

Created: 2026-06-12
Model: Claude Fable 5

## Priority

design

## Dependencies

Depends on:
- 0116
- 0117
- 0124
- 0128
- 0144
- 0145
- 0146
- 0147
- 0148
- 0149
- 0150
- 0151
- 0152
- 0153

Blocks:
- None

## Summary

Tracking issue for the 2026-06 full-repository debt audit and the resulting
restructuring plan. The audit measured the codebase against six product
premises and found that the largest debts are not local bugs but
premise violations baked into shared core types and default behavior:

1. **Anonymity/privacy first** — the default verification path sends proof
   evidence to a third-party AI API; mint/Blossom/FROST HTTP calls expose IPs
   with no transport hook.
2. **P2P exchange** — two parallel Oracle surfaces (relay DM vs HTTP server +
   HTTP client discovery) split ownership and pull toward centralized
   deployment.
3. **Nostr/Cashu native** — broadly satisfied; `@anchr/protocol` is clean.
4. **Portable (browser and server)** — sidecar subprocess spawning,
   file-system persistence, and direct `Deno.env` reads block browser use.
5. **Anyone can define a proof schema** — schema URLs are open strings, but
   the verification contract, the `Query` aggregate, and the closed
   `VerificationFactor` union hardcode TLSN/C2PA/GPS knowledge; a third-party
   schema cannot ship without forking the SDK.
6. **Simple** — two competing verification taxonomies (schema-URL dispatch vs
   factor checks), duplicated lifecycle/helpers, and platform-specific media
   tooling inside the SDK.

## Rationale

Phased plan; each phase is owned by the listed issues:

- **Phase A — decide and delete** (shrinks every later phase):
  0145 (remove AI content check), 0151 (strip platform media tooling),
  0152 (canonical Oracle surface), 0117 (FROST complete-or-remove, existing).
- **Phase B — schema-extensibility core** (the centerpiece):
  0144 (decision: schema-owned verification) → 0146 (schema-scoped payloads)
  → 0147 (GPS out of shared core) → 0148 (runtime schema registration and
  reference adapters).
- **Phase C — portability**:
  0149 (runtime ports for config/persistence/sidecars) → 0150 (browser CI
  gate).
- **Phase D — privacy/P2P hardening** (mostly already tracked):
  0116, 0124, 0128 (existing), 0153 (FROST peer transport hook).

Correctness issues 0134-0141 remain independent and should generally land
before or alongside Phase B since they touch the same verification code.

## Acceptance

- All issues listed under `Depends on` are closed, or the maintainer has
  explicitly accepted the residual risk of the remaining ones.
- The six premises above are either satisfied or have a documented,
  deliberate exception recorded in `docs/architecture.md` or
  `docs/threat-model.md`.

## Verification

- `ls docs/issues/pending/` shows none of the dependency issues remaining.
- `deno task test:all` passes after the final child closes.

## Plan

- Resolve Phase A decisions first; they delete code every other phase would
  otherwise have to migrate.
- Re-read this plan after each phase; re-split or retire children whose
  scope was changed by earlier deletions.
