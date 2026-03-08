import { buildChallengeRule, generateNonce } from "./challenge";
import {
  getJob,
  insertJob,
  listJobs,
  updateJobStatus,
  updateJobSubmitted,
} from "./db";
import type { Job, JobParams, JobResult, JobStatus } from "./types";
import { verify } from "./verification";

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

function generateId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createJob(params: JobParams, ttlMs = DEFAULT_TTL_MS): Job {
  const nonce = generateNonce();
  const now = Date.now();
  const job: Job = {
    id: generateId(),
    type: params.type,
    status: "pending",
    params,
    challenge_nonce: nonce,
    challenge_rule: buildChallengeRule(params.type, nonce, params as unknown as Record<string, unknown>),
    created_at: now,
    expires_at: now + ttlMs,
    payment_status: "locked",
  };
  insertJob(job);
  return job;
}

export function fetchJob(id: string): Job | null {
  return getJob(id);
}

export function fetchAvailableJobs(): Job[] {
  return listJobs("pending").filter((j) => j.expires_at > Date.now());
}

export function submitJobResult(id: string, result: JobResult): { ok: boolean; job: Job; message: string } {
  const job = getJob(id);
  if (!job) return { ok: false, job: null as unknown as Job, message: "Job not found" };
  if (job.status !== "pending") return { ok: false, job, message: `Job is ${job.status}, not pending` };
  if (job.expires_at < Date.now()) {
    updateJobStatus(id, "expired", "cancelled");
    return { ok: false, job, message: "Job has expired" };
  }

  const verification = verify(job, result);
  const newStatus: JobStatus = verification.passed ? "approved" : "rejected";
  const paymentStatus = verification.passed ? "released" : "cancelled";

  updateJobSubmitted(id, result, verification, newStatus, paymentStatus);

  const updated = getJob(id)!;
  return {
    ok: verification.passed,
    job: updated,
    message: verification.passed
      ? "Verification passed. Payment released."
      : `Verification failed: ${verification.failures.join(", ")}`,
  };
}

export function cancelJob(id: string): { ok: boolean; message: string } {
  const job = getJob(id);
  if (!job) return { ok: false, message: "Job not found" };
  if (job.status !== "pending") return { ok: false, message: `Job is already ${job.status}` };
  updateJobStatus(id, "rejected", "cancelled");
  return { ok: true, message: "Job cancelled" };
}
