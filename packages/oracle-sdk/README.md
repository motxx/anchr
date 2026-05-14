# @anchr/oracle-sdk

Oracle-facing SDK types and clients. The current surface includes the
`OracleClient` port and a small HTTP hash-client adapter for deployments that
expose `POST /hash`.

`OracleClient.requestHash(queryId)` returns only the hash. The selected oracle
pubkey lives in the customer's `oracles: [{ pubkey, client }]` trust policy, so
the HTTP adapter stays endpoint-only and does not become a second source of
oracle identity.
