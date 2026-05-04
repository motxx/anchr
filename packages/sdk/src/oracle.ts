/**
 * Oracle client — abstracts how the SDK talks to an oracle.
 *
 * The oracle plays two roles in the protocol:
 *   1. Pre-flight: returns a hash `H` whose preimage `S` it holds and
 *      will release if (and only if) it verifies a valid proof later.
 *      The customer locks Cashu HTLC against `H`.
 *   2. Settlement: after receiving the provider's proof and verifying
 *      it, sends the preimage `S` to the provider via NIP-44 DM.
 *
 * Different deployments expose the pre-flight role differently — some
 * over HTTP, some via Nostr DM, some via FROST signing protocols. The
 * SDK does not pick one; it accepts an OracleClient and lets the caller
 * provide the right adapter for their deployment.
 *
 * `DefaultHttpOracleClient` is a thin HTTP client for the simplest
 * deployment shape: an oracle that exposes `POST /hash` returning
 * `{ hash: string }`. Host operators that run their own oracle on a
 * different protocol can pass a custom OracleClient implementation.
 */

/** Public-facing oracle client interface. */
export interface OracleClient {
  /**
   * Request a fresh hash for a query. The oracle commits to releasing
   * the preimage that hashes to the returned value once it has verified
   * a valid proof for the same query id.
   *
   * @param queryId — caller-chosen unique id for this query
   * @returns the hash (hex) and the oracle's pubkey (hex)
   */
  requestHash(queryId: string): Promise<{ hash: string; oraclePubkey: string }>;
}

/** Construction options for {@link DefaultHttpOracleClient}. */
export interface HttpOracleOptions {
  /** Endpoint URL serving `POST /hash`. */
  endpoint: string;
  /** Hex pubkey of the oracle, used to verify it matches the customer's whitelist. */
  oraclePubkey: string;
  /** Optional API key sent as `Authorization: Bearer <apiKey>`. */
  apiKey?: string;
  /** Optional custom fetch implementation; defaults to `globalThis.fetch`. */
  fetchImpl?: typeof globalThis.fetch;
}

/** Thrown when the oracle returns an unsuccessful HTTP response. */
export class OracleHttpError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`Oracle /hash failed: ${status}`);
    this.name = "OracleHttpError";
  }
}

/** Thrown when the oracle response payload doesn't contain `hash`. */
export class OracleResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OracleResponseError";
  }
}

/**
 * Default OracleClient that talks to an HTTP oracle exposing
 * `POST /hash` and returning `{ hash: "<hex>" }`.
 */
export function createHttpOracleClient(options: HttpOracleOptions): OracleClient {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const endpoint = options.endpoint.replace(/\/$/, "");
  const oraclePubkey = options.oraclePubkey;

  return {
    async requestHash(queryId: string): Promise<{ hash: string; oraclePubkey: string }> {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (options.apiKey) headers["authorization"] = `Bearer ${options.apiKey}`;

      const res = await fetchImpl(`${endpoint}/hash`, {
        method: "POST",
        headers,
        body: JSON.stringify({ query_id: queryId }),
      });

      if (!res.ok) {
        let body = "";
        try {
          body = await res.text();
        } catch {
          // ignore
        }
        throw new OracleHttpError(res.status, body);
      }

      const payload: unknown = await res.json();
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("hash" in payload) ||
        typeof (payload as { hash: unknown }).hash !== "string"
      ) {
        throw new OracleResponseError(
          `Oracle response missing 'hash' field: ${JSON.stringify(payload)}`,
        );
      }
      return {
        hash: (payload as { hash: string }).hash,
        oraclePubkey,
      };
    },
  };
}
