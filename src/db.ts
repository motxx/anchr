import { Database } from "bun:sqlite";
import type { Job, JobResult, JobStatus, PaymentStatus, VerificationDetail } from "./types";

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    _db = new Database(process.env.DB_PATH ?? "jobs.db");
    _db.exec("PRAGMA journal_mode=WAL");
    migrate(_db);
  }
  return _db;
}

function migrate(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      params TEXT NOT NULL,
      challenge_nonce TEXT NOT NULL,
      challenge_rule TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      submitted_at INTEGER,
      result TEXT,
      verification TEXT,
      payment_status TEXT NOT NULL DEFAULT 'locked'
    )
  `);
}

interface JobRow {
  id: string;
  type: string;
  status: string;
  params: string;
  challenge_nonce: string;
  challenge_rule: string;
  created_at: number;
  expires_at: number;
  submitted_at: number | null;
  result: string | null;
  verification: string | null;
  payment_status: string;
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    type: row.type as Job["type"],
    status: row.status as JobStatus,
    params: JSON.parse(row.params),
    challenge_nonce: row.challenge_nonce,
    challenge_rule: row.challenge_rule,
    created_at: row.created_at,
    expires_at: row.expires_at,
    submitted_at: row.submitted_at ?? undefined,
    result: row.result ? JSON.parse(row.result) : undefined,
    verification: row.verification ? JSON.parse(row.verification) : undefined,
    payment_status: row.payment_status as PaymentStatus,
  };
}

export function insertJob(job: Job): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO jobs (id, type, status, params, challenge_nonce, challenge_rule, created_at, expires_at, payment_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.id,
    job.type,
    job.status,
    JSON.stringify(job.params),
    job.challenge_nonce,
    job.challenge_rule,
    job.created_at,
    job.expires_at,
    job.payment_status,
  );
}

export function getJob(id: string): Job | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | null;
  return row ? rowToJob(row) : null;
}

export function listJobs(status?: JobStatus): Job[] {
  const db = getDb();
  const rows = status
    ? (db.prepare("SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC").all(status) as JobRow[])
    : (db.prepare("SELECT * FROM jobs ORDER BY created_at DESC").all() as JobRow[]);
  return rows.map(rowToJob);
}

export function updateJobSubmitted(
  id: string,
  result: JobResult,
  verification: VerificationDetail,
  newStatus: JobStatus,
  paymentStatus: PaymentStatus,
): void {
  const db = getDb();
  db.prepare(`
    UPDATE jobs SET status = ?, submitted_at = ?, result = ?, verification = ?, payment_status = ?
    WHERE id = ?
  `).run(
    newStatus,
    Date.now(),
    JSON.stringify(result),
    JSON.stringify(verification),
    paymentStatus,
    id,
  );
}

export function updateJobStatus(id: string, status: JobStatus, paymentStatus?: PaymentStatus): void {
  const db = getDb();
  if (paymentStatus) {
    db.prepare("UPDATE jobs SET status = ?, payment_status = ? WHERE id = ?").run(status, paymentStatus, id);
  } else {
    db.prepare("UPDATE jobs SET status = ? WHERE id = ?").run(status, id);
  }
}

export function expireJobs(): number {
  const db = getDb();
  const now = Date.now();
  const result = db.prepare(`
    UPDATE jobs SET status = 'expired', payment_status = 'cancelled'
    WHERE status = 'pending' AND expires_at < ?
  `).run(now);
  return result.changes;
}
