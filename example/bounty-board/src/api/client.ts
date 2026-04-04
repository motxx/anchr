import type {
  QuerySummary,
  QueryDetail,
  UploadResponse,
  SubmitResponse,
  AttachmentRef,
  BlossomKeyMap,
  CreateQueryRequest,
  QuoteInfo,
} from "./types";
import { useSettingsStore } from "../store/settings";
import { useAuthStore } from "../store/auth";

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
  const res = await fetch(`${getBaseUrl()}/queries/${id}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Query fetch failed: ${res.status}`);
  return res.json();
}

export async function createQuery(body: CreateQueryRequest): Promise<{ id: string }> {
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
  } as unknown as Blob);

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

export async function submitQuote(queryId: string, amountSats?: number): Promise<{ ok: boolean }> {
  const res = await fetch(`${getBaseUrl()}/queries/${queryId}/quotes`, {
    method: "POST",
    headers: { ...getHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ amount_sats: amountSats }),
  });
  if (!res.ok) throw new Error(`Quote failed: ${res.status}`);
  return res.json();
}

export async function selectWorker(queryId: string, workerPubkey: string, htlcToken?: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${getBaseUrl()}/queries/${queryId}/select`, {
    method: "POST",
    headers: { ...getHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ worker_pubkey: workerPubkey, htlc_token: htlcToken }),
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
  const body: Record<string, unknown> = { attachments, notes };
  if (encryptionKeys && Object.keys(encryptionKeys).length > 0) {
    body.encryption_keys = encryptionKeys;
  }

  const res = await fetch(`${getBaseUrl()}/queries/${queryId}/submit`, {
    method: "POST",
    headers: { ...getHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok && res.status >= 500) {
    throw new Error(`Server error: ${res.status}`);
  }
  return res.json();
}

export async function fetchOracleHash(): Promise<{ hash: string; preimage?: string }> {
  const res = await fetch(`${getBaseUrl()}/hash`, {
    method: "POST",
    headers: { ...getHeaders(), "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Hash request failed: ${res.status}`);
  return res.json();
}

export async function fetchWalletBalance(pubkey: string, role: "requester" | "worker"): Promise<{ balance_sats: number }> {
  const res = await fetch(`${getBaseUrl()}/wallet/balance?pubkey=${pubkey}&role=${role}`, {
    headers: getHeaders(),
  });
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
