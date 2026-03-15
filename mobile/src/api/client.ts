import type {
  QuerySummary,
  QueryDetail,
  UploadResponse,
  SubmitResponse,
  AttachmentRef,
  BlossomKeyMap,
} from "./types";
import { useSettingsStore } from "../store/settings";

function getBaseUrl(): string {
  return useSettingsStore.getState().serverUrl;
}

function getHeaders(): Record<string, string> {
  const apiKey = useSettingsStore.getState().apiKey;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  return headers;
}

export async function fetchQueries(): Promise<QuerySummary[]> {
  const url = `${getBaseUrl()}/queries`;
  console.log(`[anchr-api] fetchQueries → ${url}`);
  try {
    const res = await fetch(url, {
      headers: getHeaders(),
    });
    console.log(`[anchr-api] fetchQueries ← ${res.status}`);
    if (!res.ok) return [];
    const data = await res.json();
    console.log(`[anchr-api] fetchQueries got ${data.length} queries`);
    return data;
  } catch (e) {
    console.error(`[anchr-api] fetchQueries error:`, e);
    return [];
  }
}

export async function fetchQueryDetail(id: string): Promise<QueryDetail | null> {
  try {
    const res = await fetch(`${getBaseUrl()}/queries/${id}`, {
      headers: getHeaders(),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
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
    headers: {
      ...getHeaders(),
      // Let fetch set Content-Type with boundary for multipart
      Accept: "application/json",
    },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed: ${res.status} ${text}`);
  }
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
    headers: {
      ...getHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok && res.status >= 500) {
    throw new Error(`Server error: ${res.status}`);
  }
  return res.json();
}

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${getBaseUrl()}/health`, {
      headers: { Accept: "application/json" },
    });
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}
