import { join } from "node:path";
import { Hono } from "hono";
import { cancelJob, fetchAvailableJobs, fetchJob, submitJobResult } from "./jobs";
import type { Job, JobResult } from "./types";
// @ts-ignore — Bun HTML import
import uiHtml from "./ui/index.html";

const UPLOADS_DIR = join(import.meta.dir, "..", "uploads");
const PORT = Number(process.env.WORKER_PORT ?? 3000);

async function buildCss() {
  const cssIn = join(import.meta.dir, "ui/globals.css");
  const cssOut = join(import.meta.dir, "ui/generated.css");
  // stdout/stderr must be "pipe" — never "inherit", which would corrupt MCP stdio
  // Use process.execPath (absolute path to bun binary) instead of "bunx"
  // so this works even when the nix store is not in Claude Desktop's PATH
  const proc = Bun.spawn([process.execPath, "x", "tailwindcss", "-i", cssIn, "-o", cssOut], {
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
  if (proc.exitCode !== 0) {
    console.error("[css-build] Failed:", await new Response(proc.stderr).text());
  }
}

function jobSummary(job: Job) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    params: job.params,
    challenge_nonce: job.challenge_nonce,
    challenge_rule: job.challenge_rule,
    expires_at: job.expires_at,
    expires_in_seconds: Math.max(0, Math.floor((job.expires_at - Date.now()) / 1000)),
  };
}

function jobDetail(job: Job) {
  return {
    ...jobSummary(job),
    created_at: job.created_at,
    submitted_at: job.submitted_at,
    result: job.result,
    verification: job.verification,
    payment_status: job.payment_status,
  };
}

function buildApp() {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/jobs", (c) => c.json(fetchAvailableJobs().map(jobSummary)));

  app.get("/jobs/:id", (c) => {
    const job = fetchJob(c.req.param("id"));
    return job ? c.json(jobDetail(job)) : c.json({ error: "Not found" }, 404);
  });

  app.post("/jobs/:id/upload", async (c) => {
    const job = fetchJob(c.req.param("id"));
    if (!job) return c.json({ error: "Not found" }, 404);
    if (job.status !== "pending") return c.json({ error: "Job not pending" }, 409);

    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json({ error: "Expected multipart/form-data" }, 400);
    }

    const file = formData.get("photo");
    if (!file || typeof file === "string") {
      return c.json({ error: "Missing photo field" }, 400);
    }

    const ext = (file as File).name.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? ".jpg";
    const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif"];
    if (!allowed.includes(ext)) {
      return c.json({ error: `Unsupported file type: ${ext}` }, 400);
    }

    const filename = `${c.req.param("id")}_${Date.now()}${ext}`;
    await Bun.write(join(UPLOADS_DIR, filename), file as File);

    return c.json({ ok: true, url: `/uploads/${filename}` });
  });

  app.get("/uploads/:filename", async (c) => {
    const filename = c.req.param("filename");
    if (filename.includes("..") || filename.includes("/")) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const file = Bun.file(join(UPLOADS_DIR, filename));
    if (!(await file.exists())) return c.json({ error: "Not found" }, 404);
    return new Response(file);
  });

  app.post("/jobs/:id/submit", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    const outcome = submitJobResult(c.req.param("id"), body as JobResult);
    const status = !outcome.job
      ? 404
      : !outcome.ok &&
        outcome.job.status !== "pending" &&
        outcome.job.status !== "rejected"
      ? 409
      : outcome.ok
      ? 200
      : 422;
    return c.json(
      {
        ok: outcome.ok,
        message: outcome.message,
        verification: outcome.job?.verification,
        payment_status: outcome.job?.payment_status,
      },
      status
    );
  });

  app.post("/jobs/:id/cancel", (c) => {
    const outcome = cancelJob(c.req.param("id"));
    return c.json(outcome, outcome.ok ? 200 : 400);
  });

  return app;
}

export async function startWorkerApi() {
  await buildCss();
  const { mkdirSync } = await import("node:fs");
  mkdirSync(UPLOADS_DIR, { recursive: true });

  const app = buildApp();

  Bun.serve({
    port: PORT,
    routes: {
      "/": uiHtml,
    },
    fetch: app.fetch,
  });

  console.error(`[worker-api] Dashboard → http://localhost:${PORT}`);
}
