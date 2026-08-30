# Unify Release Material messages and identify the Payment Lock type

Created: 2026-07-26
Model: Claude Opus 5

## Priority

design

## Dependencies

Depends on:
- 0247

Blocks:
- 0252
- 0253
- 0254
- 0255

## Summary

The Release Material message format hardcodes one Payment Lock type.
`buildPreimageDeliveryEvent` / `parsePreimageDeliveryEvent`
(`packages/protocol/src/events.ts`) define the payload around the
Cashu HTLC preimage, and the Oracle DMs carry a separate FROST-signature
variant (`buildFrostSignatureDM`). Roles that consume these events learn
field names specific to one Payment Lock type, which couples Customer and Provider
orchestration to Cashu details. Replace the parallel messages with one Release
Material message represented as a concrete union distinguished by
`payment_lock_type`. `@anchr/protocol` defines every supported branch;
role orchestration passes a parsed branch to the corresponding Payment Lock
capability instead of interpreting its fields.

## Rationale

- Anchr assembles Unlock Conditions and transports Release Material. Role
  orchestration should not implement parsing or
  validation.
- `specs/messaging.md` owns the payload tables and must change with the
  events.
- `PaymentLockType` and `supported_payment_lock_types` already distinguish
  `htlc` from `p2pk_frost`; Provider Selection and Release Material should
  reuse the type and values defined by `@anchr/protocol`.
- Adding another Payment Lock type, including a future NUT-CTF type, is an
  explicit decision about the protocol and its JSON version rather than an open-ended
  registry extension.
- Sequencing: 0247 first moves the remaining Oracle DMs into
  `@anchr/protocol`, so this issue edits one owner.

## Acceptance

- One Release Material message exists in `@anchr/protocol` as a
  concrete union with outer message type `release_material`, distinguished by
  `payment_lock_type`; the separate preimage and FROST delivery
  variants are deleted (pre-1.0, no compat shims).
- The Provider Selection execution payload carries `payment_lock_type`, using
  the same `PaymentLockType` definition and values as Oracle registry
  `supported_payment_lock_types` and Release Material delivery.
- The initial union branches are `htlc` with a preimage and `p2pk_frost` with
  its ordered signatures and group public key. Each branch binds the Release
  Material to the query and request event.
- The specification defines each branch's JSON encoding and canonicalization,
  and parsers reject unknown Payment Lock types. Each version 0 branch permits
  only its defined fields; every other field is rejected. An implementation in
  another language can validate the complete payload, and 0252 can derive
  stable schemas and test vectors without importing an SDK implementation.
- Oracle orchestration builds the protocol payload and Provider orchestration
  dispatches the parsed union to its Payment Lock capability; neither
  duplicates validation for a Payment Lock type. Customer orchestration selects
  and transports the Payment Lock type but does not consume Release Material.
- Provider orchestration compares the selected Payment Lock type with the
  delivered type. A mismatch is not a clean release; economic redeem remains
  governed by the held token's actual spendability as specified in
  `specs/paid-request-exchange.md`.
- `specs/messaging.md` documents the generalized payload and those rules.

## Requirement traceability

| Requirement | Verification |
| --- | --- |
| `PaymentLockType` values are exactly `htlc` and `p2pk_frost` for Release Material version 0 | A protocol type test asserts the value set together with `RELEASE_MATERIAL_VERSION`; changing either makes the reviewed fixture change without changing another JSON format's version. |
| Oracle registry, Provider Selection, and Release Material reuse the type defined by `@anchr/protocol` | Type tests compile all three payloads from the same `PaymentLockType`; the architecture lint from 0247 rejects a copied value set. |
| Provider Selection requires `payment_lock_type` | Parser tests accept both known values and reject a missing, non-string, or unknown value. |
| One outer `release_material` message replaces the two old delivery messages | Builder/parser round-trip tests cover both union branches; the old-symbol grep below returns no matches. |
| `htlc` carries a preimage and no FROST fields | Tests accept a valid HTLC payload and reject missing preimage, FROST-only fields, malformed hash encoding, and extra conflicting fields. |
| `p2pk_frost` carries ordered signatures and the group public key and no preimage | Tests accept a valid FROST payload and reject missing/empty/malformed signatures, missing/malformed group key, preimage, and extra conflicting fields. |
| Version 0 Release Material contains only fields defined by its selected branch | Parser tests add an arbitrary field and a field from the other branch to each valid payload and reject all four cases; the JSON Schemas in 0252 set `additionalProperties` to `false`. |
| Every branch binds query and request event | Tests reject a missing, empty, or non-string `query_id` or `request_event_id`. |
| Unknown Payment Lock types fail closed | Parser tests and an invalid protocol vector reject an unknown value. |
| Provider dispatches without owning Cashu validation | Provider unit tests inject one capability per Payment Lock type, assert exactly the selected capability is called, and assert malformed material is rejected by that capability rather than reimplemented in orchestration. |
| A Selection/Release type mismatch is not a clean release | A Provider flow test records the mismatch as an anomaly and does not report clean settlement. |
| Correlation metadata alone does not suppress economic redeem of a spendable held token | A Provider flow test injects a capability that reports the held token spendable and asserts redeem is attempted while the mismatch remains in audit output. |
| An implementation in another language can validate the complete payload | 0252 publishes the same valid and invalid cases as JSON Schema vectors; until 0252 lands, equivalent protocol fixtures live with the parser tests. |
| Messaging documentation uses the same field names and branches | A focused docs assertion checks `release_material`, `payment_lock_type`, `htlc`, and `p2pk_frost` in the Release Material table. |

## Verification

- No matches expected:
  `rg "PreimageDelivery|PreimageDM|FrostSignatureDM" packages/protocol/src packages/sdk/src --glob '!*test*'`
  (Cashu Payment Lock implementations may keep internal preimage vocabulary).
- `deno task lint:strict`, `deno task test:unit`,
  `deno task test:e2e:protocol` pass; `deno task test:e2e:frost` passes where
  infra is available.

## Plan

- Add `payment_lock_type` to Provider Selection and define the
  Release Material union distinguished by `payment_lock_type` in protocol events and specification
  tables.
- Migrate the Oracle daemon and role facades; delete the old builders and
  parsers.
