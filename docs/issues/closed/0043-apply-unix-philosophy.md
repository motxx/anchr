# Apply Unix philosophy

Created: 2026-05-20
Model: GPT-5
Completed: 2026-05-24

## Priority

maintenance

## Dependencies

Depends on:
- 0046
- 0047
- 0048
- 0049

Blocks:
- None

## Summary

Reshape Anchr around a Unix-philosophy reading of the project: do one thing
well, expose clear composable interfaces, and remove repository surfaces that
make the project look like many unrelated products. The one thing is
**verifiable paid requests**. The final public surface should be `@anchr/sdk`
for application developers and `@anchr/protocol` for interoperable wire
contracts.

## Rationale

Doug McIlroy's Unix philosophy is commonly summarized as: write programs that
do one thing well, make them work together, and use a universal interface. Eric
Raymond's later rules emphasize modularity, composition, clarity, and parsimony:
simple parts, clean interfaces, clear behavior, and no large system unless the
need is demonstrated.

References:

- <https://en.wikipedia.org/wiki/Unix_philosophy>
- <https://en.wikiquote.org/wiki/Doug_McIlroy>
- <https://www.catb.org/esr/writings/taoup/html/graphics/taoup.pdf>

Anchr's one thing is:

```text
Anchr is an SDK for verifiable paid requests.

Customer posts a paid request.
Provider returns work with proof.
Oracle verifies and releases payment.
```

Everything else is either implementation detail, optional teaching material, or
outside this repository. `bounty`, marketplaces, bot shields, binary bets,
mobile shells, MCP app surfaces, conditional-swap side quests, and broad
example domains all make the project look like it is trying to do several
things. They should not be public package names, architectural layers, required
runtime components, or first-visit concepts.

Relevant files:

- `README.md`
- `docs/architecture.md`
- `docs/example-delivery-lifecycle.md`
- `deno.json`
- `packages/`
- `apps/`
- `examples/`
- `e2e/`
- `scripts/arch-lint.ts`
- `scripts/arch-lint-candidates.ts`

## Acceptance

- Pending child issues #0046, #0047, #0048, and #0049 are closed or explicitly
  replaced by narrower follow-up issues.
- `README.md` and `docs/architecture.md` describe Anchr's one thing as
  verifiable paid requests.
- The repository map does not present extra public package families, apps,
  tools, bounty surfaces, or non-core examples as part of Anchr's required
  surface.

## Verification

- No matches are expected outside historical closed issue text:
  `rg -n "apps/|tools/|@anchr/bounty|@anchr/sdk/bounty|core-cashu|frost-oracle|tlsn-toolkit|photo-verification|cashu-conditional-swap|@anchr/adapters" README.md docs/architecture.md deno.json packages examples`
- `deno task lint:strict`

## Plan

- Resolve #0046 to define Anchr's one thing and the minimal public contract.
- Resolve #0047 to collapse package surfaces into `@anchr/sdk` and
  `@anchr/protocol`.
- Resolve #0049 to remove non-core repository surfaces, including `apps/` and
  any proposed `tools/` category.
- Resolve #0048 to enforce the final minimal surface through docs, workspace
  config, lint rules, examples, and publish metadata.
- Close this parent only when a new reader can understand from the repository
  map that Anchr does one thing: verifiable paid requests.

## Resolution

Implemented by updating:

- `docs/issues/closed/0043-apply-unix-philosophy.md`
- `docs/issues/closed/0046-define-one-thing.md`
- `docs/issues/closed/0047-collapse-to-sdk-protocol.md`
- `docs/issues/closed/0048-enforce-minimal-surface.md`
- `docs/issues/closed/0049-prune-noncore-surfaces.md`

Verified with:

- `test ! -d apps`
- `test ! -d tools`
- `find packages -maxdepth 2 -name deno.json -print | sort`
- `rg -n "@anchr/(customer-sdk|provider-sdk|oracle-sdk|core-runtime|core-cashu|frost-oracle|tlsn-toolkit|photo-verification|cashu-conditional-swap|blossom|adapters|bounty)|@anchr/sdk/bounty|@anchr/bounty" README.md docs/architecture.md deno.json packages examples`
- `rg -n '(^|[^[:alnum:]_-])(apps|tools)/' README.md docs/architecture.md deno.json packages examples`
- `deno task lint:strict`

Harness update:

- None — this parent closes the Unix-philosophy surface work already enforced
  by #0048's architecture lint and repository-surface checks.

Review residuals:

- None

Follow-up:

- #0064 remains as the separate post-#0048 Blossom attachment boundary audit.
