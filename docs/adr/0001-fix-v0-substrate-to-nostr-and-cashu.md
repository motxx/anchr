# Fix Anchr v0 substrate to Nostr and Cashu

Anchr v0 is Nostr-native and Cashu-settled: Nostr/NIP-90 is the actor
coordination and wire-event substrate, and Cashu HTLC/P2PK is the supported
Payment Lock substrate. Earlier docs treated Nostr and Cashu as replaceable
profiles, but the implementation and public contract are fixed to those
substrates in v0; SDK relay and payment ports remain as I/O and test
boundaries, not as a public promise that another transport or settlement
backend can be substituted without a new versioned protocol decision.
