# Privacy hardening follow-ups

Created: 2026-06-11
Model: Claude Fable 5
Completed: 2026-06-13

## Priority

maintenance

## Dependencies

Depends on:
- None

Blocks:
- 0143

## Summary

Tracking issue for the medium/low privacy findings: the `expires_at`
millisecond-precision leak, the INV-08 test that proves "no HTTP injected"
rather than "no HTTP endpoint", and the underdocumented anonymity cost of the
`region` tag.

## Rationale

From the 2026-06-11 production-readiness audit §2.4:

- **ANON-03** — `packages/sdk/src/customer.ts:315` publishes `expires_at` as a
  millisecond value while `created_at` is floored to seconds
  (`packages/protocol/src/events.ts:90-92`), letting an observer recover the
  millisecond publish time and fingerprint across requests.
- **ANON-04** — `e2e/protocol/anonymous-relay-flow.test.ts:62-153` never asserts
  `globalThis.fetch` was uncalled, so INV-08's "no HTTP endpoint" claim is
  enforced by absence-of-wiring, not an assertion.
- **ANON-05** — a supplied `regionCode` publishes a cleartext indexable
  `#region` tag that reduces the anonymity set
  (`packages/protocol/src/events.ts:83-85`, `specs/messaging.md:72-77`);
  the cost is underdocumented.

## Acceptance

- `expires_at` is published at second granularity (and `specs/messaging.md`
  updated), locked by a test asserting `expires_at % 1000 === 0`.
- The INV-08 test installs a `globalThis.fetch` spy (restored in `finally`) and
  asserts zero calls during the exchange.
- `specs/messaging.md` and the SDK `regionCode` docs note the cleartext
  indexable region reduces the anonymity set.

## Verification

- `deno task test:unit` (the `expires_at % 1000` assertion).
- `deno task test:e2e:protocol` (the fetch-count assertion).
- `deno task lint:invariants`, `deno task lint:strict`.

## Plan

- Floor `expires_at` and update the spec field description.
- Add the fetch spy to the INV-08 e2e test.
- Add the `region` anonymity-set sentence to the spec and SDK option docs.

## Resolution

Implemented by updating:

- **ANON-03** — `packages/sdk/src/customer.ts` publishes `expires_at`
  floored to second granularity; `specs/messaging.md` field description
  updated; locked by a unit test asserting `expires_at % 1000 === 0`
- **ANON-04** — `e2e/protocol/anonymous-relay-flow.test.ts` installs a
  `globalThis.fetch` spy (restored in `finally`) and asserts zero HTTP calls
  during the exchange
- **ANON-05** — `specs/messaging.md` and the `RequestOptions.regionCode` doc
  state that the cleartext indexable `#region` tag shrinks the requester's
  anonymity set and should be omitted unless required

Verified with:

- `deno task test:unit`
- `deno task test:e2e:protocol`
- `deno task lint:invariants`

Harness update:

- The flooring unit test and the INV-08 fetch-spy assertion lock both
  behaviors.

Review residuals:

- None

Follow-up:

- None
