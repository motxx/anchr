# Update boundary lints and docs

Created: 2026-05-20
Model: GPT-5

## Priority

maintenance

## Dependencies

Depends on:
- 0038
- 0039
- 0040
- 0041
- 0042
- 0045
- 0046
- 0047
- 0048

Blocks:
- None

## Summary

Update architecture lint rules, workspace configuration, package READMEs, and
developer documentation after the directory and boundary redesign lands.

## Rationale

Relevant references:

- `scripts/arch-lint.ts`
- `scripts/arch-lint-candidates.ts`
- `deno.json`
- `CLAUDE.md`
- `AGENTS.md`
- `docs/architecture.md`
- `packages/*/README.md`
- `packages/*/deno.json`

This issue was previously closed too early. The repository documents a target
taxonomy with `packages/settlement/*`, `packages/proofs/*`, `packages/runtime`,
and `packages/flows/*`, but the physical tree still has transitional top-level
packages such as `core-cashu`, `frost-oracle`, `photo-verification`,
`tlsn-toolkit`, `core-runtime`, and `bounty`. Issue #0045 settled that actor
SDK packages intentionally remain flat as `customer-sdk`, `provider-sdk`,
`oracle-sdk`, and `sdk` in the pre-1.0 tree.

The final pass must solve the maintainer-facing problem, not just make the tree
flat: a reader should be able to look at a package name and understand what
capability it offers, which pieces are independently reusable, and why any
`core-*` package still deserves that prefix.

The current deterministic lint allow-list therefore still encodes a mixture of
the old flat package graph and the target graph. Once the child issues move or
explicitly settle those physical boundaries, this issue should become the final
pass that aligns lint rules, workspace config, package READMEs, and agent docs
with the actual layout.

Reference OSS patterns to use when resolving #0046 through #0048:

- Matrix Rust SDK: the README distinguishes crates intended for direct
  dependency use from crates that are internal/organizational. Anchr should do
  the same for public integration packages versus transitional or internal-ish
  scaffolding. Reference: <https://github.com/matrix-org/matrix-rust-sdk>.
- OpenTelemetry JS: package names separate API, SDK, exporter, and
  instrumentation roles. Anchr package names and docs should similarly make
  protocol, SDK, adapter, proof, and settlement responsibilities visible from
  the name or the package map. Reference:
  <https://github.com/open-telemetry/opentelemetry-js>.
- libp2p JS: packages are capability-named, for example transports, peer
  discovery, and stream multiplexers. Anchr should prefer capability-revealing
  names over vague `core-*` names when a package is independently reusable.
  Reference: <https://github.com/libp2p/js-libp2p>.
- Bitcoin Dev Kit: high-level wallet APIs and lower-level chain/backend
  integration crates are separated by what an integrator can use directly.
  Anchr should make `@anchr/sdk` the obvious high-level start point and make
  lower-level packages explain their independent use case. Reference:
  <https://github.com/bitcoindevkit/bdk>.

The lesson is not to copy another repository's directory shape. The lesson is
to make the package map answer: who should depend on this package directly,
what capability does it provide alone, and which packages are implementation
details or transitional scaffolding.

## Plan

- Resolve #0045, #0046, #0047, and #0048 as independently verifiable package
  boundary and naming decisions.
- After those close, update package dependency allow-lists to match the actual
  accepted physical taxonomy.
- Add a package capability map that says what each public package lets an
  integrator do independently and which package to start with for common tasks.
- Remove or justify unclear `core-*` naming in the final package map. If a
  `core-*` name remains, document what makes it foundational and what depends
  on it.
- Add or adjust rules so actor SDKs depend on ports and protocol, while
  concrete technology bindings live in adapter/proof/settlement packages.
- Update workspace entries, import maps, publish manifests, and README install
  examples.
- Update `CLAUDE.md`, `AGENTS.md`, and `docs/architecture.md` with the final
  directory map.
- Run the relevant lint, unit, example, and E2E smoke commands documented by
  the migration issues.
