import {
  AnchrError,
  RequestTimeoutError,
  VerificationFailedError,
} from "./errors.ts";
import {
  type AnchrConfig,
  type HttpRequestOptions,
  type HttpRequestResult,
  type PhotoRequestOptions,
  type PhotoResult,
  type RequestStatusResponse,
  type RequestSummary,
  sleep,
  type SubmitResponse,
} from "./client-types.ts";
import { isRecord, isString } from "./internal/runtime/types.ts";

/**
 * Anchr — buy cryptographically verified data with sats.
 *
 * @example
 * ```typescript
 * import { Anchr } from "@anchr/sdk";
 *
 * const anchr = new Anchr({ serverUrl: "https://anchr.example.com" });
 *
 * const result = await anchr.request({
 *   description: "BTC price from CoinGecko",
 *   targetUrl: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
 *   conditions: [{ type: "jsonpath", expression: "bitcoin.usd" }],
 *   maxSats: 21,
 * });
 * ```
 */
export class Anchr {
  private config: Required<AnchrConfig>;

  constructor(config: AnchrConfig) {
    this.config = {
      serverUrl: config.serverUrl.replace(/\/$/, ""),
      apiKey: config.apiKey ?? "",
      defaultTimeoutSeconds: config.defaultTimeoutSeconds ?? 300,
      pollIntervalMs: config.pollIntervalMs ?? 3000,
    };
  }

  /**
   * Request verified web data via TLSNotary. Creates a paid request, waits for
   * a Worker to fulfill it with a cryptographic proof, verifies the proof,
   * and returns the verified data.
   */
  async request(options: HttpRequestOptions): Promise<HttpRequestResult> {
    const requestId = await this.createRequest(options);

    const pollTimeout = options.pollTimeoutSeconds ?? options.timeoutSeconds ??
      this.config.defaultTimeoutSeconds;
    const deadline = Date.now() + pollTimeout * 1000;

    while (Date.now() < deadline) {
      const status = await this.getRequestStatus(requestId);

      if (status.status === "approved") {
        return this.buildRequestResult(status, options);
      }

      if (status.status === "rejected") {
        throw new VerificationFailedError(
          requestId,
          status.verification?.failures ?? ["Unknown verification failure"],
        );
      }

      if (status.status === "expired") {
        throw new AnchrError(`Request ${requestId} expired`, "EXPIRED");
      }

      await sleep(this.config.pollIntervalMs);
    }

    throw new RequestTimeoutError(requestId, pollTimeout);
  }

  /**
   * Request a verified photo via C2PA. Creates a photo request, waits for a
   * Worker to photograph the location, verifies the C2PA signature and
   * GPS proximity, and returns the result.
   */
  async photo(options: PhotoRequestOptions): Promise<PhotoResult> {
    const requestId = await this.createPhotoRequest(options);
    const photoTimeout = options.timeoutSeconds ??
      this.config.defaultTimeoutSeconds;
    const deadline = Date.now() + photoTimeout * 1000;

    while (Date.now() < deadline) {
      const status = await this.getRequestStatus(requestId);

      if (status.status === "approved") {
        return {
          verified: true,
          checks: status.verification?.checks ?? [],
          attachments: (status.result?.attachments ?? []).map((
            a: { uri: string; mime_type?: string; mimeType?: string },
          ) => ({
            uri: a.uri,
            mimeType: a.mimeType ?? a.mime_type ?? "application/octet-stream",
          })),
          notes: status.result?.notes,
          gps: status.result?.gps,
          requestId,
          satsPaid: options.maxSats ?? 0,
        };
      }

      if (status.status === "rejected") {
        throw new VerificationFailedError(
          requestId,
          status.verification?.failures ?? [],
        );
      }

      if (status.status === "expired") {
        throw new AnchrError(`Request ${requestId} expired`, "EXPIRED");
      }

      await sleep(this.config.pollIntervalMs);
    }

    throw new RequestTimeoutError(requestId, photoTimeout);
  }

  async createTlsnRequest(options: HttpRequestOptions): Promise<string> {
    return this.createRequest(options);
  }

  async getRequestStatus(requestId: string): Promise<RequestStatusResponse> {
    const res = await this.fetch(`/queries/${requestId}`);
    if (!res.ok) {
      throw new AnchrError(`Failed to get request ${requestId}`, "API_ERROR", {
        status: res.status,
      });
    }
    return res.json();
  }

  async listOpenRequests(
    options?: { lat?: number; lon?: number; maxDistanceKm?: number },
  ): Promise<RequestSummary[]> {
    const params = new URLSearchParams();
    if (options?.lat != null) params.set("lat", String(options.lat));
    if (options?.lon != null) params.set("lon", String(options.lon));
    if (options?.maxDistanceKm != null) {
      params.set("max_distance_km", String(options.maxDistanceKm));
    }
    const qs = params.toString();
    const res = await this.fetch(`/queries${qs ? `?${qs}` : ""}`);
    if (!res.ok) throw new AnchrError("Failed to list requests", "API_ERROR");
    return res.json();
  }

  async submitPresentation(
    requestId: string,
    presentationBase64: string,
    workerPubkey = "sdk-worker",
  ): Promise<SubmitResponse> {
    const res = await this.fetch(`/queries/${requestId}/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worker_pubkey: workerPubkey,
        tlsn_presentation: presentationBase64,
      }),
    });
    if (!res.ok && res.status >= 500) {
      throw new AnchrError("Submit failed", "API_ERROR");
    }
    return res.json();
  }

  private async createRequest(options: HttpRequestOptions): Promise<string> {
    // domainHint: full targetUrl (with credentials/session IDs) is delivered
    // to the selected Worker via NIP-44 encrypted_context, never the public
    // request envelope.
    const publicTargetUrl = options.domainHint
      ? `https://${options.domainHint}/`
      : options.targetUrl;

    const body: Record<string, unknown> = {
      description: options.description,
      verification_requirements: ["tlsn"],
      tlsn_requirements: {
        target_url: publicTargetUrl,
        ...(options.domainHint && { domain_hint: options.domainHint }),
        ...(options.conditions?.length && {
          conditions: options.conditions.map((c) => ({
            type: c.type,
            expression: c.expression,
            ...(c.expected !== undefined && { expected: c.expected }),
            ...(c.description && { description: c.description }),
          })),
        }),
        ...(options.maxAttestationAgeSeconds && {
          max_attestation_age_seconds: options.maxAttestationAgeSeconds,
        }),
      },
      ttl_seconds: options.timeoutSeconds ?? this.config.defaultTimeoutSeconds,
    };

    if (options.maxSats) {
      body.bounty = { amount_sats: options.maxSats };
    }

    const res = await this.fetch("/queries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err: unknown = await res.json().catch(() => ({}));
      const message = isRecord(err) && isString(err.error)
        ? err.error
        : `Failed to create request (${res.status})`;
      throw new AnchrError(
        message,
        "API_ERROR",
        err,
      );
    }

    return await this.readCreatedRequestId(res, "request");
  }

  private async createPhotoRequest(
    options: PhotoRequestOptions,
  ): Promise<string> {
    const body: Record<string, unknown> = {
      description: options.description,
      location_hint: options.locationHint,
      expected_gps: options.expectedGps,
      max_gps_distance_km: options.maxGpsDistanceKm,
      ttl_seconds: options.timeoutSeconds ?? this.config.defaultTimeoutSeconds,
    };

    if (options.maxSats) {
      body.bounty = { amount_sats: options.maxSats };
    }

    const res = await this.fetch("/queries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new AnchrError("Failed to create photo request", "API_ERROR");
    }
    return await this.readCreatedRequestId(res, "photo request");
  }

  private buildRequestResult(
    status: RequestStatusResponse,
    options: HttpRequestOptions,
  ): HttpRequestResult {
    const verified = status.verification?.tlsn_verified;
    const rawBody = verified?.revealed_body ?? "";

    let data: unknown = rawBody;
    try {
      data = JSON.parse(rawBody);
    } catch {
      // not JSON, keep as string
    }

    return {
      verified: status.verification?.passed ?? false,
      serverName: verified?.server_name ?? "",
      data,
      rawBody,
      proof: status.result?.tlsn_attestation?.presentation ?? "",
      timestamp: verified?.session_timestamp ?? 0,
      checks: status.verification?.checks ?? [],
      satsPaid: options.maxSats ?? 0,
      requestId: status.id,
    };
  }

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    if (this.config.apiKey) {
      headers.set("Authorization", `Bearer ${this.config.apiKey}`);
    }
    return globalThis.fetch(`${this.config.serverUrl}${path}`, {
      ...init,
      headers,
    });
  }

  private async readCreatedRequestId(
    res: Response,
    label: string,
  ): Promise<string> {
    const payload: unknown = await res.json();
    if (isRecord(payload) && isString(payload.query_id)) {
      return payload.query_id;
    }
    throw new AnchrError(`Malformed create ${label} response`, "API_ERROR", {
      payload,
    });
  }
}
