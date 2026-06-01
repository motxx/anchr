# Context

## Glossary

### Payment Lock

A conditional payment held for a request. A Payment Lock can be redeemed by the
selected Provider after valid release, or refunded by the Customer through the
timeout path.

### Provider Selection

The Customer's lifecycle decision to choose exactly one Provider for a request.
Provider Selection is public enough for actor coordination, but it does not make
Provider-only payment or execution data public.

### Provider Redemption Token

Provider-only payment data that the selected Provider holds so it can redeem a
Payment Lock after valid release. A Provider Redemption Token is sensitive and
must be delivered only to the selected Provider.

### Release Material

Oracle-produced material that makes a valid Provider Redemption Token redeemable
after the requested proof succeeds.

### Redeem

The Provider's act of collecting payment from a Payment Lock after valid
release.

### Refund

The Customer's act of recovering payment from a Payment Lock through the timeout
path.
