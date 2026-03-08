import { mkdirSync, rmSync } from "node:fs";
import { expect, test } from "bun:test";
import { UPLOADS_DIR } from "./attachments";
import { createQuery, getQuery, queryTemplates } from "./query-service";
import { buildWorkerApiApp } from "./worker-api";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQImWP8//8/AxJgYGBgAAQYAAHcAQObmQ4AAAAASUVORK5CYII=",
  "base64",
);

test("worker api supports photo proof upload, submission, and attachment metadata", async () => {
  mkdirSync(UPLOADS_DIR, { recursive: true });

  const previousStorage = process.env.ATTACHMENT_STORAGE;
  const previousHttpApiKey = process.env.HTTP_API_KEY;
  const previousHttpApiKeys = process.env.HTTP_API_KEYS;
  process.env.ATTACHMENT_STORAGE = "local";
  delete process.env.HTTP_API_KEY;
  delete process.env.HTTP_API_KEYS;

  const app = buildWorkerApiApp();
  const query = createQuery(queryTemplates.photoProof("Worker API integration test"), { ttlSeconds: 300 });

  let uploadedLocalPath: string | undefined;

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
        local_file_path?: string;
      };
    };
    uploadedLocalPath = uploadJson.attachment.local_file_path;
    expect(uploadJson.attachment.storage_kind).toBe("local");
    expect(uploadJson.attachment.uri).toContain("/uploads/");

    const submitResponse = await app.request(`http://localhost/queries/${query.id}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "photo_proof",
        text_answer: `Observed storefront ${query.challenge_nonce}`,
        attachments: [uploadJson.attachment],
        notes: "worker api integration",
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
      result?: { type: string; attachments: Array<{ uri: string }> };
    };
    expect(detailJson.status).toBe("approved");
    expect(detailJson.result?.type).toBe("photo_proof");
    expect(detailJson.result?.attachments).toHaveLength(1);
    expect(detailJson.result?.attachments[0]?.uri).toContain("/uploads/");

    const metaResponse = await app.request(`http://localhost/queries/${query.id}/attachments/0/meta`);
    expect(metaResponse.status).toBe(200);
    const metaJson = await metaResponse.json() as {
      query_id: string;
      attachment: { storage_kind: string };
      access: { original_url: string; preview_url: string; view_url: string; meta_url: string };
      mime_type: string;
    };
    expect(metaJson.query_id).toBe(query.id);
    expect(metaJson.attachment.storage_kind).toBe("local");
    expect(metaJson.access.original_url).toContain("/uploads/");
    expect(metaJson.access.preview_url).toContain(`/queries/${query.id}/attachments/0/preview`);
    expect(metaJson.access.view_url).toContain(`/queries/${query.id}/attachments/0`);
    expect(metaJson.access.meta_url).toContain(`/queries/${query.id}/attachments/0/meta`);
    expect(metaJson.mime_type).toBe("image/png");

    const viewResponse = await app.request(`http://localhost/queries/${query.id}/attachments/0`);
    expect(viewResponse.status).toBe(200);
    expect(viewResponse.headers.get("content-type")).toBe("image/png");

    const storedQuery = getQuery(query.id);
    expect(storedQuery?.status).toBe("approved");
  } finally {
    process.env.ATTACHMENT_STORAGE = previousStorage;
    process.env.HTTP_API_KEY = previousHttpApiKey;
    process.env.HTTP_API_KEYS = previousHttpApiKeys;
    if (uploadedLocalPath) {
      rmSync(uploadedLocalPath, { force: true });
    }
  }
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
        type: "store_status",
        store_name: "Unauthorized Test Store",
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
        type: "store_status",
        store_name: "Authorized Test Store",
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
      type: string;
      status: string;
      requester_meta: {
        requester_type: string;
        requester_id?: string;
        client_name?: string;
      } | null;
      query_api_url: string;
    };

    expect(createJson.query_id).toStartWith("query_");
    expect(createJson.type).toBe("store_status");
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
