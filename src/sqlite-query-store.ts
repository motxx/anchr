import { Database } from "bun:sqlite";
import { normalizeQueryResult } from "./attachments";
import { getRuntimeConfig } from "./config";
import type {
  BountyInfo,
  PaymentStatus,
  Query,
  QueryResult,
  QueryStatus,
  RequesterMeta,
  SubmissionMeta,
  VerificationDetail,
} from "./types";

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    _db = new Database(getRuntimeConfig().dbPath);
    _db.exec("PRAGMA journal_mode=WAL");
    migrate(_db);
  }
  return _db;
}

function migrate(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS queries (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      params TEXT NOT NULL,
      challenge_nonce TEXT NOT NULL,
      challenge_rule TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      requester_meta TEXT,
      submitted_at INTEGER,
      result TEXT,
      verification TEXT,
      submission_meta TEXT,
      payment_status TEXT NOT NULL DEFAULT 'locked'
    )
  `);

  const columns = db.prepare("PRAGMA table_info(queries)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "submission_meta")) {
    db.exec("ALTER TABLE queries ADD COLUMN submission_meta TEXT");
  }
  if (!columns.some((column) => column.name === "requester_meta")) {
    db.exec("ALTER TABLE queries ADD COLUMN requester_meta TEXT");
  }
  if (!columns.some((column) => column.name === "bounty")) {
    db.exec("ALTER TABLE queries ADD COLUMN bounty TEXT");
  }
}

interface QueryRow {
  id: string;
  type: string;
  status: string;
  params: string;
  challenge_nonce: string;
  challenge_rule: string;
  created_at: number;
  expires_at: number;
  requester_meta: string | null;
  bounty: string | null;
  submitted_at: number | null;
  result: string | null;
  verification: string | null;
  submission_meta: string | null;
  payment_status: string;
}

function rowToQuery(row: QueryRow): Query {
  const result = row.result ? normalizeQueryResult(JSON.parse(row.result)) : undefined;
  return {
    id: row.id,
    type: row.type as Query["type"],
    status: row.status as QueryStatus,
    params: JSON.parse(row.params),
    challenge_nonce: row.challenge_nonce,
    challenge_rule: row.challenge_rule,
    created_at: row.created_at,
    expires_at: row.expires_at,
    requester_meta: row.requester_meta ? JSON.parse(row.requester_meta) as RequesterMeta : undefined,
    bounty: row.bounty ? JSON.parse(row.bounty) as BountyInfo : undefined,
    submitted_at: row.submitted_at ?? undefined,
    result,
    verification: row.verification ? JSON.parse(row.verification) : undefined,
    submission_meta: row.submission_meta ? JSON.parse(row.submission_meta) : undefined,
    payment_status: row.payment_status as PaymentStatus,
  };
}

export function insertQueryRecord(query: Query): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO queries (id, type, status, params, challenge_nonce, challenge_rule, created_at, expires_at, requester_meta, bounty, payment_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    query.id,
    query.type,
    query.status,
    JSON.stringify(query.params),
    query.challenge_nonce,
    query.challenge_rule,
    query.created_at,
    query.expires_at,
    query.requester_meta ? JSON.stringify(query.requester_meta) : null,
    query.bounty ? JSON.stringify(query.bounty) : null,
    query.payment_status,
  );
}

export function getQueryRecord(id: string): Query | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM queries WHERE id = ?").get(id) as QueryRow | null;
  return row ? rowToQuery(row) : null;
}

export function listQueryRecords(status?: QueryStatus): Query[] {
  const db = getDb();
  const rows = status
    ? (db.prepare("SELECT * FROM queries WHERE status = ? ORDER BY created_at DESC").all(status) as QueryRow[])
    : (db.prepare("SELECT * FROM queries ORDER BY created_at DESC").all() as QueryRow[]);
  return rows.map(rowToQuery);
}

export function updateQuerySubmittedRecord(
  id: string,
  result: QueryResult,
  verification: VerificationDetail,
  newStatus: QueryStatus,
  paymentStatus: PaymentStatus,
  submissionMeta: SubmissionMeta,
): void {
  const db = getDb();
  db.prepare(`
    UPDATE queries SET status = ?, submitted_at = ?, result = ?, verification = ?, submission_meta = ?, payment_status = ?
    WHERE id = ?
  `).run(
    newStatus,
    Date.now(),
    JSON.stringify(result),
    JSON.stringify(verification),
    JSON.stringify(submissionMeta),
    paymentStatus,
    id,
  );
}

export function updateQueryStatusRecord(id: string, status: QueryStatus, paymentStatus?: PaymentStatus): void {
  const db = getDb();
  if (paymentStatus) {
    db.prepare("UPDATE queries SET status = ?, payment_status = ? WHERE id = ?").run(status, paymentStatus, id);
  } else {
    db.prepare("UPDATE queries SET status = ? WHERE id = ?").run(status, id);
  }
}

export function expirePendingQueries(): number {
  const db = getDb();
  const now = Date.now();
  const result = db.prepare(`
    UPDATE queries SET status = 'expired', payment_status = 'cancelled'
    WHERE status = 'pending' AND expires_at < ?
  `).run(now);
  return result.changes;
}
