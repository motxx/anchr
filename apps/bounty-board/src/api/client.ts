import type {
  AttachmentRef,
  BlossomKeyMap,
  CreateQueryRequest,
  OfferInfo,
  QueryDetail,
  QuerySummary,
  SubmitResponse,
  UploadResponse,
} from "./types.ts";
// Side-effect import: augments FormData.append with the RN { uri, name, type } overload.
import "../types/rn-formdata.d.ts";
import { useSettingsStore } from "../store/settings.ts";
import { useAuthStore } from "../store/auth.ts";

function getBaseUrl(): string {
  return useSettingsStore.getState().serverUrl;
}

function getHeaders(): Record<string, string> {
  const { publicKey } = useAuthStore.getState();
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (publicKey) {
    headers["X-Nostr-Pubkey"] = publicKey;
  }
  return headers;
}

export async function fetchQueries(): Promise<QuerySummary[]> {
  const res = await fetch(`${getBaseUrl()}/queries`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  return res.json();
}

export async function fetchQueryDetail(id: string): Promise<QueryDetail> {
  const res = await fetch(`${getBaseUrl()}/queries/${id}`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Query fetch failed: ${res.status}`);
  return res.json();
}

export async function createQuery(
  body: CreateQueryRequest,
): Promise<{ id: string }> {
  const res = await fetch(`${getBaseUrl()}/queries`, {
    method: "POST",
    headers: { ...getHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create query failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function uploadPhoto(
  queryId: string,
  fileUri: string,
  filename: string,
  mimeType: string,
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("photo", {
    uri: fileUri,
    name: filename,
    type: mimeType,
  });

  const res = await fetch(`${getBaseUrl()}/queries/${queryId}/upload`, {
    method: "POST",
    headers: { ...getHeaders(), Accept: "application/json" },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function submitOffer(
  queryId: string,
  amountSats?: number,
): Promise<{ ok: boolean }> {
  const res = await fetch(`${getBaseUrl()}/queries/${queryId}/offers`, {
    method: "POST",
    headers: { ...getHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ amount_sats: amountSats }),
  });
  if (!res.ok) throw new Error(`Offer failed: ${res.status}`);
  return res.json();
}

export async function selectWorker(
  queryId: string,
  workerPubkey: string,
  escrowToken?: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(`${getBaseUrl()}/queries/${queryId}/select`, {
    method: "POST",
    headers: { ...getHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      worker_pubkey: workerPubkey,
      htlc_token: escrowToken,
    }),
  });
  if (!res.ok) throw new Error(`Select failed: ${res.status}`);
  return res.json();
}

export async function submitResult(
  queryId: string,
  attachments: AttachmentRef[],
  notes: string,
  encryptionKeys?: BlossomKeyMap,
): Promise<SubmitResponse> {
  const { publicKey } = useAuthStore.getState();
  if (!publicKey) {
    throw new Error(
      "Worker pubkey is required to submit a result. Sign in first.",
    );
  }

  const body: Record<string, unknown> = {
    worker_pubkey: publicKey,
    attachments,
    notes,
  };
  if (encryptionKeys && Object.keys(encryptionKeys).length > 0) {
    body.encryption_keys = encryptionKeys;
  }

  const res = await fetch(`${getBaseUrl()}/queries/${queryId}/result`, {
    method: "POST",
    headers: { ...getHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok && res.status >= 500) {
    throw new Error(`Server error: ${res.status}`);
  }
  return res.json();
}

export async function fetchOracleHash(): Promise<
  { hash: string; preimage?: string }
> {
  const res = await fetch(`${getBaseUrl()}/hash`, {
    method: "POST",
    headers: { ...getHeaders(), "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Hash request failed: ${res.status}`);
  return res.json();
}

export async function fetchWalletBalance(
  pubkey: string,
  role: "requester" | "worker",
): Promise<{ balance_sats: number }> {
  const res = await fetch(
    `${getBaseUrl()}/wallet/balance?pubkey=${pubkey}&role=${role}`,
    {
      headers: getHeaders(),
    },
  );
  if (!res.ok) throw new Error(`Balance fetch failed: ${res.status}`);
  return res.json();
}

export async function healthCheck(serverUrl?: string): Promise<boolean> {
  const url = serverUrl ?? getBaseUrl();
  try {
    const res = await fetch(`${url}/health`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}
