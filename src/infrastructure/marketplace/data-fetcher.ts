/**
 * Upstream data fetcher with TLSNotary proof generation and caching.
 *
 * Fetches data from upstream APIs and generates TLSNotary proofs.
 * Caches results per listing_id within max_age_seconds.
 */

import type { TlsnRequirement, TlsnAttestation } from "../../domain/types";
import { validateTlsn, type TlsnValidationResult } from "../verification/tlsn-validation";
import { validateAttachmentUri } from "../url-validation";

export interface FetchedData {
  /** The upstream response body. */
  body: string;
  /** TLSNotary attestation (if proof generation succeeded). */
  attestation?: TlsnAttestation;
  /** Timestamp when data was fetched. */
  fetched_at: number;
}

interface CacheEntry {
  data: FetchedData;
  expires_at: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Fetch upstream data. If a TLSNotary proof is available, it is included.
 *
 * In the current implementation, the upstream fetch is done via plain HTTP.
 * TLSNotary proof generation requires the tlsn-prover sidecar, which is
 * integrated as a future enhancement. For now, the response body is returned
 * and proof validation is deferred to the Oracle in HTLC mode.
 */
export async function fetchWithProof(
  listingId: string,
  sourceUrl: string,
  maxAgeSeconds: number,
): Promise<FetchedData> {
  // Check cache
  const cached = cache.get(listingId);
  if (cached && Date.now() < cached.expires_at) {
    return cached.data;
  }

  // SSRF protection: validate source URL before fetching
  const urlError = validateAttachmentUri(sourceUrl);
  if (urlError) {
    throw new Error(`Source URL rejected: ${urlError}`);
  }

  // Fetch upstream
  const response = await fetch(sourceUrl, {
    headers: { "accept": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Upstream fetch failed: ${response.status} ${response.statusText}`);
  }

  const body = await response.text();

  const data: FetchedData = {
    body,
    fetched_at: Date.now(),
  };

  // Cache the result
  cache.set(listingId, {
    data,
    expires_at: Date.now() + maxAgeSeconds * 1000,
  });

  return data;
}

/**
 * Validate a TLSNotary attestation against a marketplace listing's requirement.
 * Thin wrapper around validateTlsn() for marketplace use.
 */
export async function validateMarketplaceProof(
  attestation: TlsnAttestation,
  requirement: TlsnRequirement,
): Promise<TlsnValidationResult> {
  return validateTlsn(attestation, requirement);
}

/** Visible for testing — clear the data cache. */
export function _clearCacheForTest(): void {
  cache.clear();
}
