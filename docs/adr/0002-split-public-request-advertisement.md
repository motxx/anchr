# Split public request advertisement from Provider-only execution

Kind `5300` request content is a public request advertisement, not the full
execution payload. It carries only the fields needed for Provider discovery:
query id, proof schema, Customer pubkey, Oracle pubkey, payment budget, and
offer expiry.

Execution predicates, schema-agnostic context, Cashu mint URL, Cashu locktime,
and the Provider Redemption Token travel after Provider Selection in encrypted
Provider-only content. This preserves public relay discovery without exposing
sensitive execution context or payment-bearing material to passive relay
observers.
