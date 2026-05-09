# Proof Schema URLs

## Abstract

Anchr identifies proof formats with HTTPS schema URLs. A schema URL names the
proof bytes, predicate shape, response data shape, and verification rules that a
Provider, Oracle, or Customer verifier must use.

Schema URLs are permissionless extension points. Implementations do not need a
central numeric registry to add a new proof format; they publish or document a
stable HTTPS URL and advertise support for it.

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

| URL | Meaning |
| --- | --- |
| `https://anchr-spec.org/spec/proof/tlsn/v1` | TLSNotary proof for an HTTPS response and schema-specific predicate. |
| `https://anchr-spec.org/spec/proof/c2pa-image/v1` | C2PA image or media proof with optional location and content predicates. |

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
  verify(proof: unknown, predicate: unknown, data: unknown): boolean | Promise<boolean>;
}
```

`canHandle()` MUST be called with the full schema URL from the request or proof
payload. Built-in adapters SHOULD return true only for their exact canonical
schema URL. A family of schemas can share implementation code internally, but it
MUST still make an explicit decision for each concrete URL.

## Nostr Tags

Anchr query events carry the requested proof schema URL in an indexable `s` tag:

```json
["s", "https://anchr-spec.org/spec/proof/tlsn/v1"]
```

The encrypted request content carries the same URL in its `schema` field. If
the tag and content disagree, implementations MUST use the encrypted content for
execution and treat the public tag as an untrusted discovery hint.
