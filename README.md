# Anchr Spec Site

Static source for `https://anchr-spec.org`.

The proof schema pages are intentionally static documents. They are stable
human-readable targets for schema URLs that SDKs compare by exact string.

## Local Check

```sh
deno task lint:proof-schema-pages
```

## Release Check

After the `Deploy Proof Schema Site` workflow completes on `main`, verify the
public routes:

```sh
curl -fsSLI https://anchr-spec.org/spec/proof/tlsn/v1
curl -fsSLI https://anchr-spec.org/spec/proof/c2pa-image/v1
```
