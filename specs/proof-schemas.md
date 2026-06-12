# Proof Schema URLs

## Abstract

Anchr identifies proof formats with HTTPS schema URLs. A schema URL is the
only verification dispatch key and names the proof bytes, requirement payload
shape, evidence payload shape, response data shape, verifier-detail payload
shape, and verification rules that a Provider, Oracle, or Customer verifier
must use.

Schema URLs are permissionless extension points. Implementations do not need a
central numeric registry to add a new proof format; they publish or document a
stable HTTPS URL and advertise support for it.

There is no protocol-wide verification-factor registry. A schema may use local
terms such as nonce, timestamp, or location inside its own requirement,
evidence, checks, and verdict details, but compatible Anchr actors dispatch only
on the schema URL.

## URL Shape

A proof schema URL MUST use this shape:

```text
https://<authority>/spec/proof/<schema-name>/v<major>
```

Rules:

- The scheme MUST be `https`.
- `<schema-name>` MUST use lowercase ASCII letters, digits, and hyphens.
- `v<major>` MUST be a positive decimal major version marker.
- Query strings, fragments, usernames, and passwords are not part of the schema
  identity and MUST NOT be used.
- Matching is exact string equality after normal URL serialization. Prefix
  matching is not allowed.

## Initial Schemas

| URL                                               | Meaning                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| `https://anchr-spec.org/spec/proof/tlsn/v1`       | TLSNotary proof for an HTTPS response and schema-specific predicate. |
| `https://anchr-spec.org/spec/proof/c2pa-image/v1` | C2PA image manifest proof with signed GPS binding.                   |

The public `anchr-spec.org` documents are generated from `spec-site/` and
published by `.github/workflows/deploy-proof-schema-site.yml`. Run
`deno task lint:proof-schema-pages` before advertising a new built-in schema
URL.

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

`canHandle()` MUST be called with the full schema URL from the request or proof
payload. Built-in adapters SHOULD return true only for their exact canonical
schema URL. A family of schemas can share implementation code internally, but it
MUST still make an explicit decision for each concrete URL.

## Schema Payloads

Each proof schema defines these schema-owned payloads:

| Payload | Wire location | Owner |
| ------- | ------------- | ----- |
| Requirement payload | Encrypted Provider Selection `execution.predicate` | The proof schema identified by `execution.schema` |
| Evidence payload | Encrypted Job Result `data` and `proof`, including the Oracle-readable result payload | The proof schema identified by the result `schema` |
| Verdict-detail payload | Schema-scoped verification details emitted by verifier APIs or public attestations when the profile defines them | The proof schema that ran verification |

The shared Anchr fields around these payloads stay schema-neutral: actor
pubkeys, query ids, event references, payment-lock fields, attachment
references, and the `schema` URL. Implementations MUST validate schema-owned
payloads at the selected schema boundary.

This payload model is wire-compatible with the existing encrypted v0 event
slots. Requirement data continues to serialize into
`execution.predicate`; submitted evidence continues to serialize into result
`data` and `proof`; the public `s` tag remains a discovery hint; and the
encrypted `schema` field remains authoritative for execution and verification.
No additional Nostr kind, tag, or shared factor field is required.

## Nostr Tags

Anchr query events carry the requested proof schema URL in an indexable `s` tag:

```json
["s", "https://anchr-spec.org/spec/proof/tlsn/v1"]
```

The encrypted request content carries the same URL in its `schema` field. If the
tag and content disagree, implementations MUST use the encrypted content for
execution and treat the public tag as an untrusted discovery hint.
