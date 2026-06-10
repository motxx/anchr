# Example Delivery Lifecycle

This document defines the repeatable path for taking an `examples/<name>/`
surface from an idea to a README-listed repository entry. It is repository
policy, not a protocol contract.

Use it when creating or resolving issues that add, promote, demote, or retire an
example.

## Current Status Inventory

The top-level README is the advertised source for example status. Each listed
example must keep its own README consistent with the advertised status.

The advertised examples are `quick-start` (Testnet) and `paid-request-simulation` (Simulation), listed in the top-level README examples table.

If an example is not listed in the top-level README, it may still exist as a
sketch, fixture, or migration artifact, but it must not be described as a
maintained reference implementation until this lifecycle is satisfied.

## Issue Requirements Template

Every issue that creates or materially promotes an example should include a
requirements section before implementation starts:

```markdown
## Example requirements

Target status:
- Concept | Simulation | Testnet | Implemented

User flow proved:
- Who starts the flow, what they do, and what result proves success.

Actors:
- Customer:
- Provider:
- Oracle:
- Other app roles:

Allowed Anchr packages:
- SDKs, adapters, proof engines, or settlement primitives the example may use.

Real dependencies:
- Relays, mints, notaries, sandboxes, devices, or native tools that are required.

Simulated dependencies:
- Fixtures, in-process services, fake proofs, test media, or local-only stores.

Data handled:
- Proof material, private API responses, media, credentials, ecash proofs, or
  other sensitive data.

Non-production boundary:
- What this example explicitly does not claim, such as mainnet readiness,
  custody safety, production credentials, or oracle decentralization.

Out of scope:
- Related product work or operational hardening outside this repository.
```

If this section cannot be filled in without design work, keep the issue at
`design` priority and do not start implementation until the requirements are
accepted or split into sub-issues.

## Promotion Checklist

Before an example can be listed or promoted in the top-level README, verify the
checklist for its target status.

| Status | Required before promotion |
| --- | --- |
| `Concept` | README states the intentional non-runnable boundary, target architecture, and no deployable behavior claim. |
| `Simulation` | README names simulated pieces, provides the command or test that exercises the flow, and states what must change before testnet or production use. |
| `Testnet` | README lists required services and non-secret env vars; `.env.example` exists when configuration is needed; a runbook covers both sides of the flow; `deno task smoke` catches API drift without funded tokens, production credentials, or live accounts. |
| `Implemented` | Advertised behavior is covered by repository tests or an equivalent example-specific harness; README links the commands, tests, or runbook and states remaining non-production limitations. |

The minimum file set for a maintained `Testnet` or `Implemented` example is:

- `README.md` with status, user flow, dependencies, trust model, and runbook or
  command entry point.
- `.env.example` when runtime configuration is required.
- `deno.json` task entries when the example has local commands.
- A smoke, test, or repository test reference matching the advertised status.

## Verification Routing

Use the narrowest verification that proves the advertised status:

- `deno task lint:strict` for repository-wide documentation, path, format, and
  architecture sanity.
- `deno task test:examples` when example code or tasks changed.
- `deno task smoke` from the example directory for README-listed `Testnet`
  examples.
- The example runbook for live relay, mint, notary, sandbox, native tool, or
  device validation that cannot be deterministic in local CI.
- `deno task test:e2e:regtest`, `deno task test:e2e:tlsn`, or
  `deno task test:e2e:frost` when the example claims one of those
  infrastructure profiles as an end-to-end behavior.

If live validation is not run, the issue resolution must state which dependency
was left to the runbook and why that gap is acceptable for the target status.

## Splitting Rule

An example issue should be split before implementation when it tries to change
more than one of these at once:

- requirements or status vocabulary;
- package or adapter boundaries;
- user-facing example code;
- live-service runbook;
- smoke or e2e harness;
- top-level README promotion.

The parent issue should record the accepted requirements and create child
issues for implementation, docs/runbook, and harness work. Do not promote the
README status until the child issue that owns verification has closed.

## Closure Notes

When closing an example issue, include:

- the final status label and where it is advertised;
- the commands that prove the status;
- any live dependency left to a runbook;
- the harness update that prevents future status drift, or the pending issue
  that will add it;
- explicit review residuals when a maintainer still needs to accept an
  operational or production-readiness boundary.
