import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { cancelJob, createJob, fetchAvailableJobs, fetchJob, submitJobResult } from "./jobs";
import type { JobParams, JobResult } from "./types";

export async function startMcpServer() {
  const server = new McpServer({
    name: "human-calling-mcp",
    version: "0.1.0",
  });

  // Tool: request_photo_proof
  server.tool(
    "request_photo_proof",
    "Ask a human to photograph a specific target. The human must include a one-time nonce in the photo or text answer. Returns a job_id for polling.",
    {
      target: z.string().describe("What should be photographed, e.g. '○○店の営業時間表示'"),
      location_hint: z.string().optional().describe("Optional hint of the location"),
      ttl_seconds: z.number().int().min(60).max(600).optional().describe("Job time limit in seconds (default 600)"),
    },
    async ({ target, location_hint, ttl_seconds }) => {
      const params: JobParams = { type: "photo_proof", target, location_hint };
      const job = createJob(params, (ttl_seconds ?? 600) * 1000);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              job_id: job.id,
              status: job.status,
              challenge_nonce: job.challenge_nonce,
              challenge_rule: job.challenge_rule,
              expires_at: new Date(job.expires_at).toISOString(),
              worker_api_url: `http://localhost:${process.env.WORKER_PORT ?? 3000}/jobs/${job.id}`,
            }, null, 2),
          },
        ],
      };
    },
  );

  // Tool: request_store_status
  server.tool(
    "request_store_status",
    "Ask a human to check if a store is currently open or closed. Human must include a nonce in their notes.",
    {
      store_name: z.string().describe("Store name, e.g. 'セブンイレブン渋谷店'"),
      location_hint: z.string().optional().describe("Optional location hint"),
      ttl_seconds: z.number().int().min(60).max(600).optional().describe("Job time limit in seconds (default 600)"),
    },
    async ({ store_name, location_hint, ttl_seconds }) => {
      const params: JobParams = { type: "store_status", store_name, location_hint };
      const job = createJob(params, (ttl_seconds ?? 600) * 1000);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              job_id: job.id,
              status: job.status,
              challenge_nonce: job.challenge_nonce,
              challenge_rule: job.challenge_rule,
              expires_at: new Date(job.expires_at).toISOString(),
              worker_api_url: `http://localhost:${process.env.WORKER_PORT ?? 3000}/jobs/${job.id}`,
            }, null, 2),
          },
        ],
      };
    },
  );

  // Tool: request_webpage_field
  server.tool(
    "request_webpage_field",
    "Ask a human to extract a specific field from a webpage and provide nearby proof text.",
    {
      url: z.string().url().describe("URL of the webpage"),
      field: z.string().describe("What to extract, e.g. '税込価格'"),
      anchor_word: z.string().describe("A word near the target field to serve as proof of reading the page"),
      ttl_seconds: z.number().int().min(60).max(600).optional().describe("Job time limit in seconds (default 600)"),
    },
    async ({ url, field, anchor_word, ttl_seconds }) => {
      const params: JobParams = { type: "webpage_field", url, field, anchor_word };
      const job = createJob(params, (ttl_seconds ?? 600) * 1000);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              job_id: job.id,
              status: job.status,
              challenge_nonce: job.challenge_nonce,
              challenge_rule: job.challenge_rule,
              expires_at: new Date(job.expires_at).toISOString(),
              worker_api_url: `http://localhost:${process.env.WORKER_PORT ?? 3000}/jobs/${job.id}`,
            }, null, 2),
          },
        ],
      };
    },
  );

  // Tool: get_job_status
  server.tool(
    "get_job_status",
    "Poll the status of a human job. Returns status and result if available.",
    {
      job_id: z.string().describe("Job ID returned from a request_* tool"),
    },
    async ({ job_id }) => {
      const job = fetchJob(job_id);
      if (!job) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "Job not found" }) }] };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              job_id: job.id,
              type: job.type,
              status: job.status,
              payment_status: job.payment_status,
              expires_in_seconds: Math.max(0, Math.floor((job.expires_at - Date.now()) / 1000)),
              result: job.result ?? null,
              verification: job.verification ?? null,
            }, null, 2),
          },
        ],
      };
    },
  );

  // Tool: cancel_job
  server.tool(
    "cancel_job",
    "Cancel a pending human job. Payment will not be released.",
    {
      job_id: z.string().describe("Job ID to cancel"),
    },
    async ({ job_id }) => {
      const outcome = cancelJob(job_id);
      return { content: [{ type: "text", text: JSON.stringify(outcome) }] };
    },
  );

  // Tool: list_available_jobs (for debugging / worker discovery)
  server.tool(
    "list_available_jobs",
    "List currently available (pending, not expired) jobs. Useful for debugging or building a worker dashboard.",
    {},
    async (_args) => {
      const jobs = fetchAvailableJobs();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              jobs.map((j) => ({
                job_id: j.id,
                type: j.type,
                challenge_rule: j.challenge_rule,
                expires_in_seconds: Math.max(0, Math.floor((j.expires_at - Date.now()) / 1000)),
              })),
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // Tool: submit_job_result (for testing without HTTP worker API)
  server.tool(
    "submit_job_result",
    "Submit a result for a pending job. Normally workers use the HTTP API, but this tool allows direct submission for testing.",
    {
      job_id: z.string(),
      result: z.record(z.string(), z.unknown()).describe("Result object matching the job type"),
    },
    async ({ job_id, result }) => {
      const outcome = submitJobResult(job_id, result as unknown as JobResult);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: outcome.ok,
              message: outcome.message,
              verification: outcome.job?.verification,
              payment_status: outcome.job?.payment_status,
            }, null, 2),
          },
        ],
      };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp-server] Connected via stdio");
}
