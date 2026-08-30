# Proof Schema URLs

## Abstract

Anchr identifies proof formats with HTTPS Proof Schema URLs. A Proof Schema URL
is the only verification dispatch key and names the proof bytes, requirement
payload shape, evidence payload shape, response data shape, verifier-detail
payload shape, and verification rules that a Provider, Oracle, or Customer
verifier must use.

Proof Schema URLs are permissionless extension points. Implementations do not
need a central numeric registry to add a new proof format; they publish or
document a stable HTTPS URL and advertise support for it.

There is no protocol-wide verification-factor registry. A Proof Schema may use
local terms such as nonce, timestamp, or location inside its own requirement,
evidence, checks, and verdict details, but compatible Anchr actors dispatch only
on the Proof Schema URL.

## URL Shape

A Proof Schema URL MUST use this shape:

```text
https://<authority>/spec/proof/<schema-name>/v<major>
```

Rules:

- The scheme MUST be `https`.
- `<schema-name>` MUST use lowercase ASCII letters, digits, and hyphens.
- `v<major>` MUST be a positive decimal major version marker.
- Query strings, fragments, usernames, and passwords are not part of the Proof
  Schema identity and MUST NOT be used.
- Matching is exact string equality after normal URL serialization. Prefix
  matching is not allowed.

## Initial Proof Schemas

| URL                                               | Meaning                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| `https://anchr-spec.org/spec/proof/tlsn/v1`       | TLSNotary proof for an HTTPS response and predicate defined by the Proof Schema. |
| `https://anchr-spec.org/spec/proof/c2pa-image/v1` | C2PA image manifest proof with signed GPS binding.                   |

The public `anchr-spec.org` documents are generated from `spec-site/` and
published by `.github/workflows/deploy-proof-schema-site.yml`. Run
`deno task lint:proof-schema-pages` before advertising a new built-in Proof
Schema URL.

## Dispatch

Providers dispatch proof generation through adapters with this shape:

```ts
interface ProofGenerator {
  canHandle(schema: string): boolean;
  produce(predicate: unknown, context: unknown): Promise<unknown>;
}
```

Oracles and Customers dispatch verification through adapters with this shape:

```ts
interface VerifierAdapter {
  canHandle(schema: string): boolean;
  verify(
    proof: unknown,
    predicate: unknown,
    data: unknown,
  ): boolean | Promise<boolean>;
}
```

`canHandle()` MUST be called with the full Proof Schema URL from the request or
proof payload. Built-in adapters SHOULD return true only for their exact
canonical Proof Schema URL. A family of Proof Schemas can share implementation
code internally, but it MUST still make an explicit decision for each concrete
URL.

## Schema Payloads

Each Proof Schema defines these payloads:

| Payload                | Message field                                                                                      | Owner                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Requirement payload    | Encrypted Provider Selection `execution.predicate`                                                 | The Proof Schema identified by `execution.schema`  |
| Evidence payload       | Encrypted Job Result `data` and `proof`, including the Oracle-readable result payload              | The Proof Schema identified by the result `schema` |
| Verdict-detail payload | Verification details emitted by verifier APIs or public attestations when the profile defines them | The Proof Schema that ran verification             |

The shared Anchr fields around these payloads do not depend on a particular
Proof Schema: actor pubkeys, query ids, event references, payment-lock fields,
attachment references, and the `schema` field containing the Proof Schema URL.
Implementations MUST validate the requirement, evidence, and verdict-detail
payloads according to the selected Proof Schema.

This payload model is compatible with the existing encrypted v0 event format
slots. Requirement data continues to serialize into `execution.predicate`;
submitted evidence continues to serialize into result `data` and `proof`; the
public `s` tag remains a discovery hint; and the encrypted `schema` field
remains authoritative for execution and verification. No additional Nostr kind,
tag, or shared factor field is required.

## Nostr Tags

Anchr query events carry the requested Proof Schema URL in an indexable `s` tag:

```json
["s", "https://anchr-spec.org/spec/proof/tlsn/v1"]
```

The encrypted request content carries the same URL in its `schema` field. If the
tag and content disagree, implementations MUST use the encrypted content for
execution and treat the public tag as an untrusted discovery hint.
