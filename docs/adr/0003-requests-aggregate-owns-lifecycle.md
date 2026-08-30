# The requests/ aggregate owns the paid-request lifecycle

`packages/sdk/src/requests/` is the single owner of the paid-request
lifecycle state machine (create → offer → select → submit → verify →
release → expire → purge). The `Query` aggregate and its transition tables
are the only lifecycle status model; role facades (`customer.ts`,
`provider.ts`) reach the lifecycle through `requests/application` services
and hold no independent status model.

The threat-model and attack e2e suites drive this lifecycle through
`@anchr/sdk/testing`. Keeping the facades on the same aggregate means those
suites verify the state machine production runs; a per-role status model
beside the aggregate is a defect, not a design option.
