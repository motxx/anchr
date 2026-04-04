import { Buffer } from "node:buffer";
import { describe, test } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { isBlossomEnabled, getBlossomConfig } from "./blossom/client";
import { createQuery, getQuery } from "../application/query-service";
import { storeIntegrity } from "./verification/integrity-store";
import { buildWorkerApiApp } from "./worker-api";

function withEnv(overrides: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  return async () => {
    const saved: Record<string, string | undefined> = {};
    for (const key of Object.keys(overrides)) {
      saved[key] = process.env[key];
      if (overrides[key] === undefined) delete process.env[key];
      else process.env[key] = overrides[key];
    }
    try { await fn(); } finally {
      for (const key of Object.keys(saved)) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  };
}

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQImWP8//8/AxJgYGBgAAQYAAHcAQObmQ4AAAAASUVORK5CYII=",
  "base64",
);

function requireBlossom() {
  if (!isBlossomEnabled()) {
    throw new Error("BLOSSOM_SERVERS must be set. Run: docker compose up -d && export BLOSSOM_SERVERS=http://localhost:3333");
  }
}

async function isBlossomReachable(): Promise<boolean> {
  if (!isBlossomEnabled()) return false;
  try {
    const res = await fetch(getBlossomConfig()!.serverUrls[0]!, { signal: AbortSignal.timeout(1000) });
    return res.ok || res.status < 500;
  } catch { return false; }
}

describe("worker api photo proof (Blossom)", () => {
  test("supports photo upload, submission, and attachment metadata", async () => {
    if (!(await isBlossomReachable())) {
      console.log("[blossom-test] SKIPPED — Blossom server not reachable");
      return;
    }

    const previousHttpApiKey = process.env.HTTP_API_KEY;
    const previousHttpApiKeys = process.env.HTTP_API_KEYS;
    delete process.env.HTTP_API_KEY;
    delete process.env.HTTP_API_KEYS;

    const app = buildWorkerApiApp();
    const query = createQuery({ description: "Worker API integration test" }, { ttlSeconds: 300 });

    try {
      const form = new FormData();
      form.append("photo", new Blob([PNG_BYTES], { type: "image/png" }), "proof.png");

      const uploadResponse = await app.request(`http://localhost/queries/${query.id}/upload`, {
        method: "POST",
        body: form,
      });
      expect(uploadResponse.status).toBe(200);

      const uploadJson = await uploadResponse.json() as {
        attachment: {
          id: string;
          uri: string;
          mime_type: string;
          storage_kind: string;
        };
        encryption: { encrypt_key: string; encrypt_iv: string };
      };
      expect(uploadJson.attachment.storage_kind).toBe("blossom");
      expect(uploadJson.encryption).toBeDefined();
      expect(typeof uploadJson.encryption.encrypt_key).toBe("string");
      expect(typeof uploadJson.encryption.encrypt_iv).toBe("string");

      // Override integrity record with valid C2PA for test
      storeIntegrity({
        attachmentId: uploadJson.attachment.id,
        queryId: query.id,
        capturedAt: Date.now(),
        exif: { hasExif: false, hasCameraModel: false, hasGps: false, hasTimestamp: false, timestampRecent: false, gpsNearHint: null, metadata: {}, checks: [], failures: [] },
        c2pa: { available: true, hasManifest: true, signatureValid: true, manifest: { title: "proof.png" }, checks: ["C2PA manifest found", "C2PA signature valid"], failures: [] },
      });

      const encryptionKeys = { [uploadJson.attachment.id]: uploadJson.encryption };

      const submitResponse = await app.request(`http://localhost/queries/${query.id}/result`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          worker_pubkey: "integration-test-worker",
          attachments: [uploadJson.attachment],
          notes: "worker api integration",
          encryption_keys: encryptionKeys,
        }),
      });
      expect(submitResponse.status).toBe(200);

      const submitJson = await submitResponse.json() as {
        ok: boolean;
        payment_status: string;
        verification?: { passed: boolean };
      };
      expect(submitJson.ok).toBe(true);
      expect(submitJson.payment_status).toBe("released");
      expect(submitJson.verification?.passed).toBe(true);

      const detailResponse = await app.request(`http://localhost/queries/${query.id}`);
      expect(detailResponse.status).toBe(200);
      const detailJson = await detailResponse.json() as {
        status: string;
        result?: { attachments: Array<{ uri: string }> };
      };
      expect(detailJson.status).toBe("approved");
      expect(detailJson.result?.attachments).toHaveLength(1);

      const metaResponse = await app.request(`http://localhost/queries/${query.id}/attachments/0/meta`);
      expect(metaResponse.status).toBe(200);
      const metaJson = await metaResponse.json() as {
        query_id: string;
        attachment: { storage_kind: string };
        access: { original_url: string; preview_url: string; view_url: string; meta_url: string };
        mime_type: string;
      };
      expect(metaJson.query_id).toBe(query.id);
      expect(metaJson.attachment.storage_kind).toBe("blossom");
      expect(metaJson.access.preview_url).toContain(`/queries/${query.id}/attachments/0/preview`);
      expect(metaJson.access.view_url).toContain(`/queries/${query.id}/attachments/0`);
      expect(metaJson.access.meta_url).toContain(`/queries/${query.id}/attachments/0/meta`);
      expect(metaJson.mime_type).toBe("image/png");

      // Blossom attachments redirect to encrypted blob URL
      const viewResponse = await app.request(`http://localhost/queries/${query.id}/attachments/0`);
      expect(viewResponse.status).toBe(302);
      expect(viewResponse.headers.get("location")).toBeTruthy();

      const storedQuery = getQuery(query.id);
      expect(storedQuery?.status).toBe("approved");
    } finally {
      process.env.HTTP_API_KEY = previousHttpApiKey;
      process.env.HTTP_API_KEYS = previousHttpApiKeys;
    }
  });
});

test("worker api creates queries over HTTP and enforces write API keys", async () => {
  const previousHttpApiKey = process.env.HTTP_API_KEY;
  const previousHttpApiKeys = process.env.HTTP_API_KEYS;
  process.env.HTTP_API_KEY = "secret-write-key";
  delete process.env.HTTP_API_KEYS;

  const app = buildWorkerApiApp();

  try {
    const unauthorizedResponse = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "Unauthorized Test Store",
      }),
    });
    expect(unauthorizedResponse.status).toBe(401);

    const createResponse = await app.request("http://localhost/queries", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "secret-write-key",
      },
      body: JSON.stringify({
        description: "Check if Authorized Test Store is open",
        location_hint: "Near Tokyo Station",
        ttl_seconds: 180,
        requester: {
          requester_type: "app",
          requester_id: "integration-test-client",
          client_name: "worker-api.integration.test",
        },
      }),
    });
    expect(createResponse.status).toBe(201);

    const createJson = await createResponse.json() as {
      query_id: string;
      description: string;
      status: string;
      requester_meta: {
        requester_type: string;
        requester_id?: string;
        client_name?: string;
      } | null;
      query_api_url: string;
    };

    expect(createJson.query_id).toMatch(/^query_/);
    expect(createJson.description).toBe("Check if Authorized Test Store is open");
    expect(createJson.status).toBe("pending");
    expect(createJson.requester_meta?.requester_type).toBe("app");
    expect(createJson.requester_meta?.requester_id).toBe("integration-test-client");
    expect(createJson.query_api_url).toContain(`/queries/${createJson.query_id}`);

    const storedQuery = getQuery(createJson.query_id);
    expect(storedQuery?.requester_meta?.requester_type).toBe("app");
    expect(storedQuery?.requester_meta?.client_name).toBe("worker-api.integration.test");
  } finally {
    process.env.HTTP_API_KEY = previousHttpApiKey;
    process.env.HTTP_API_KEYS = previousHttpApiKeys;
  }
});

// --- writeAuth middleware covers all write endpoints ---

describe("writeAuth middleware", () => {
  const authEnv = { HTTP_API_KEY: "test-key", HTTP_API_KEYS: undefined as string | undefined };

  test("rejects unauthenticated upload", withEnv(authEnv, async () => {
    const app = buildWorkerApiApp();
    const query = createQuery({ description: "auth test" }, { ttlSeconds: 300 });
    const form = new FormData();
    form.append("photo", new Blob([PNG_BYTES], { type: "image/png" }), "proof.png");
    const res = await app.request(`http://localhost/queries/${query.id}/upload`, { method: "POST", body: form });
    expect(res.status).toBe(401);
  }));

  test("rejects unauthenticated submit", withEnv(authEnv, async () => {
    const app = buildWorkerApiApp();
    const query = createQuery({ description: "auth test" }, { ttlSeconds: 300 });
    const res = await app.request(`http://localhost/queries/${query.id}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ attachments: [], notes: "" }),
    });
    expect(res.status).toBe(401);
  }));

  test("rejects unauthenticated cancel", withEnv(authEnv, async () => {
    const app = buildWorkerApiApp();
    const query = createQuery({ description: "auth test" }, { ttlSeconds: 300 });
    const res = await app.request(`http://localhost/queries/${query.id}/cancel`, { method: "POST" });
    expect(res.status).toBe(401);
  }));

  test("accepts Authorization: Bearer header", withEnv(authEnv, async () => {
    const app = buildWorkerApiApp();
    const res = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-key" },
      body: JSON.stringify({ description: "Bearer Test" }),
    });
    expect(res.status).toBe(201);
  }));

  test("accepts X-API-Key header on cancel", withEnv(authEnv, async () => {
    const app = buildWorkerApiApp();
    const query = createQuery({ description: "cancel test" }, { ttlSeconds: 300 });
    const res = await app.request(`http://localhost/queries/${query.id}/cancel`, {
      method: "POST",
      headers: { "x-api-key": "test-key" },
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);
  }));

  test("supports multiple API keys via HTTP_API_KEYS", withEnv(
    { HTTP_API_KEY: undefined as string | undefined, HTTP_API_KEYS: "alpha,bravo,charlie" },
    async () => {
      const app = buildWorkerApiApp();
      const reject = await app.request("http://localhost/queries", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": "wrong" },
        body: JSON.stringify({ description: "Multi Key" }),
      });
      expect(reject.status).toBe(401);

      const accept = await app.request("http://localhost/queries", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer bravo" },
        body: JSON.stringify({ description: "Multi Key" }),
      });
      expect(accept.status).toBe(201);
    },
  ));
});

// --- zValidator: Zod schema validation on POST /queries ---

describe("POST /queries validation", () => {
  const openEnv = { HTTP_API_KEY: undefined as string | undefined, HTTP_API_KEYS: undefined as string | undefined };

  test("rejects missing description field", withEnv(openEnv, async () => {
    const app = buildWorkerApiApp();
    const res = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location_hint: "Tokyo" }),
    });
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string; issues?: unknown[] };
    expect(json.error).toBe("Invalid query payload");
    expect(Array.isArray(json.issues)).toBe(true);
  }));

  test("rejects ttl_seconds out of range", withEnv(openEnv, async () => {
    const app = buildWorkerApiApp();
    const tooLow = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "Test", ttl_seconds: 10 }),
    });
    expect(tooLow.status).toBe(400);

    const tooHigh = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "Test", ttl_seconds: 100_000 }),
    });
    expect(tooHigh.status).toBe(400);
  }));

  test("creates query successfully", withEnv(openEnv, async () => {
    const app = buildWorkerApiApp();
    const res = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: "Check if Shibuya ramen shop is open",
        location_hint: "Shibuya",
      }),
    });
    expect(res.status).toBe(201);
    const json = await res.json() as { description: string; query_id: string };
    expect(json.description).toBe("Check if Shibuya ramen shop is open");
    expect(json.query_id).toMatch(/^query_/);
  }));

  test("rejects non-JSON body", withEnv(openEnv, async () => {
    const app = buildWorkerApiApp();
    const res = await app.request("http://localhost/queries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  }));
});
