# Context

## Glossary

### Paid Request

A Customer-initiated lifecycle where one selected Provider returns Work with
Proof, and Oracle verification controls release of the Customer's Payment Lock.
_Avoid_: Query, job, task, bounty, marketplace listing, Provider listing

### Customer

The protocol role that creates a Paid Request, publishes a Payment Budget, and
selects one Provider.
_Avoid_: Requester, buyer, client

### Provider

The protocol role that offers to complete a Paid Request for a Requested Payment
Amount, returns Work with Proof, and redeems payment after valid release.
_Avoid_: Worker, seller, executor

### Oracle

The protocol role that verifies proof and produces Release Material for valid
work.
_Avoid_: Arbiter, judge

### Work

The result a Customer wants from a Paid Request.
_Avoid_: Proof, submission, artifact

### Proof

Evidence that lets an Oracle or Proof Verifier check whether Work satisfies a
Paid Request.
_Avoid_: Work, result, Oracle Attestation

### Proof Schema

A named specification that defines the requirement, proof format, and
verification rules for a Paid Request.
_Avoid_: Verification factor, proof type, adapter

### Proof Verifier

A component that checks whether submitted Proof satisfies a Proof Schema. A
Proof Verifier does not itself define the Oracle role or control payment
release.
_Avoid_: Oracle, Proof Producer, arbiter, judge

### Oracle Attestation

A public-capable Oracle record of a proof verification outcome for a Paid
Request. An Oracle Attestation is audit material; it is not Release Material.
_Avoid_: Proof, Release Material

### Payment Budget

The maximum amount a Customer is willing to pay for a Paid Request. Payment
Budget is published in the Request Notice for Provider discovery and offer
evaluation.
_Avoid_: Payment amount, minimum price

### Requested Payment Amount

The amount a Provider asks to receive in a Provider Offer. Requested Payment
Amount is published in the Provider Offer, and the Payment Lock for the selected
Provider should match the selected Requested Payment Amount.
_Avoid_: Payment Budget, quote

### Payment Lock

A conditional payment for the selected Requested Payment Amount. A Payment Lock
can be redeemed by the selected Provider after valid release, or refunded by the
Customer through the timeout path.
_Avoid_: Escrow

### Provider Redemption Token

Provider-only payment data that the selected Provider holds so it can redeem a
Payment Lock after valid release. A Provider Redemption Token is sensitive and
must be delivered only to the selected Provider.

### Release Material

Oracle-produced material that makes a valid Provider Redemption Token redeemable
after proof verification succeeds. Release Material is payment-unlocking
material, not an Oracle Attestation.
_Avoid_: Oracle Attestation, proof

### Redeem

The Provider's act of collecting payment from a Payment Lock after valid
release.

### Refund

The Customer's act of recovering payment from a Payment Lock through the timeout
path.

### Request Notice

Customer-published, relay-visible request information that lets Providers
discover a Paid Request. A Request Notice does not include execution
predicates, Provider-only payment data, or other sensitive context.
_Avoid_: Request, listing, advertisement

### Provider Offer

A Provider's proposal to complete a Paid Request for a requested payment amount.
_Avoid_: Quote, bid, application

### Provider Selection

The Customer's lifecycle decision to choose exactly one Provider and its
Requested Payment Amount for a Paid Request. Provider Selection is public enough
for actor coordination, but it does not make Provider-only payment or execution
data public.

### Execution Payload

Provider-only structured content delivered after Provider Selection. An
Execution Payload includes the proof predicate and payment-lock terms the
selected Provider needs before doing the Work.
_Avoid_: Request Notice, instructions
