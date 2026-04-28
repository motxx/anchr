# Architecture

Anchr is seven independently typecheckable packages on top of a Hono /
Deno reference server. No package depends on host-side code; each is
isolated under `deno task test:packages`.

```
packages/
├── core-runtime/              Bun ↔ Deno runtime helpers (spawn, fs, which, logger, env)
├── core-cashu/                Cashu HTLC escrow + preimage store
├── tlsn-toolkit/              TLSNotary application layer (validation, replay defence, ReDoS guard)
├── photo-bounty/              C2PA + EXIF + ProofMode + AI content check + GPS Haversine
├── cashu-frost-oracle/        FROST t-of-n cluster wrapper for Cashu P2PK threshold signing
├── cashu-conditional-swap/    N:M binary-outcome conditional swap primitive (HTLC / FROST dual-key)
└── sdk/                       anchr-sdk: HTTP / MCP client for AI agents

src/                           Reference host server (Hono on Deno) — composes the packages above
example/                       Runnable examples; each has its own `deno.json`
crates/                        Rust: frost-signer, tlsn-prover, tlsn-server, tlsn-verifier
specs/                         Wire-format specs (CC0)
docs/                          Implementation guides + threat model
```

## What each surface looks like today

| Surface | State |
|---|---|
| Cashu HTLC payment + escrow | Implemented, fuzzed (`e2e/regtest-htlc-attacks.test.ts`) |
| TLSNotary proof verification | Implemented (replay-protected, ReDoS-safe conditions) |
| FROST t-of-n threshold oracles | Implemented (`crates/frost-signer`, BIP-340 Schnorr) |
| C2PA / ProofMode / GPS / EXIF | Implemented |
| Nostr DVM (NIP-90) discovery | Implemented |
| Blossom (NIP-44 + AES-256-GCM) | Implemented |

Active development; baseline tests are green and threat-model invariants
are tracked. API stability is not yet guaranteed.

## Specs and threat model

- Wire-format specs (Nostr DVM messaging, conditional-swap primitive,
  oracle registry) live under [`specs/`](../specs/), CC0. Anyone may
  implement them.
- Per-package implementation guides are each package's `SPEC.md`
  (e.g. [`packages/core-cashu/SPEC.md`](../packages/core-cashu/SPEC.md),
  [`packages/tlsn-toolkit/SPEC.md`](../packages/tlsn-toolkit/SPEC.md)).
- Threat-model invariants and the attack tests pinning them are in
  [`docs/threat-model.md`](threat-model.md).
