import { Database } from "@db/sqlite";
import type {
  ProofGateCampaign,
  ProofGateClaim,
  ProofGateCondition,
  ProofGateStore,
} from "./types.ts";

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS proof_gate_campaigns (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS proof_gate_claims (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES proof_gate_campaigns(id),
  claimant_pubkey TEXT NOT NULL,
  htlc_hash TEXT NOT NULL UNIQUE,
  preimage TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'approved', 'rejected')),
  nullifier_hash TEXT,
  json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proof_gate_claims_campaign ON proof_gate_claims(campaign_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_proof_gate_claims_nullifier_once
  ON proof_gate_claims(campaign_id, nullifier_hash)
  WHERE nullifier_hash IS NOT NULL AND status = 'approved';

CREATE TABLE IF NOT EXISTS proof_gate_presentation_hashes (
  hash TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

export function openSqliteProofGateStore<
  C extends ProofGateCondition = ProofGateCondition,
>(
  path: string,
): ProofGateStore<C> {
  const db = new Database(path);
  db.exec(SCHEMA_SQL);

  return {
    upsertCampaign(campaign) {
      const row = JSON.stringify(campaign);
      db.prepare(
        "INSERT INTO proof_gate_campaigns (id, json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(id) DO UPDATE SET json=excluded.json, status=excluded.status, updated_at=excluded.updated_at",
      ).run(
        campaign.id,
        row,
        campaign.status,
        campaign.created_at,
        campaign.updated_at,
      );
      return Promise.resolve();
    },
    getCampaign(id) {
      const row = db.prepare(
        "SELECT json FROM proof_gate_campaigns WHERE id = ?",
      ).get<{ json: string }>(id);
      return Promise.resolve(
        row ? JSON.parse(row.json) as ProofGateCampaign<C> : undefined,
      );
    },
    listCampaigns() {
      const rows = db.prepare(
        "SELECT json FROM proof_gate_campaigns ORDER BY created_at DESC",
      ).all<{ json: string }>();
      return Promise.resolve(
        rows.map((r) => JSON.parse(r.json) as ProofGateCampaign<C>),
      );
    },
    createClaim(claim) {
      db.prepare(
        "INSERT INTO proof_gate_claims (id, campaign_id, claimant_pubkey, htlc_hash, preimage, status, nullifier_hash, json, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        claim.id,
        claim.campaign_id,
        claim.claimant_pubkey,
        claim.htlc_hash,
        claim.preimage,
        claim.status,
        claim.nullifier_hash ?? null,
        JSON.stringify(claim),
        claim.created_at,
        claim.updated_at,
      );
      return Promise.resolve();
    },
    getClaim(id) {
      const row = db.prepare("SELECT json FROM proof_gate_claims WHERE id = ?")
        .get<{ json: string }>(id);
      return Promise.resolve(
        row ? JSON.parse(row.json) as ProofGateClaim<C> : undefined,
      );
    },
    updateClaim(claim) {
      db.prepare(
        "UPDATE proof_gate_claims SET status = ?, nullifier_hash = ?, json = ?, updated_at = ? WHERE id = ?",
      ).run(
        claim.status,
        claim.nullifier_hash ?? null,
        JSON.stringify(claim),
        claim.updated_at,
        claim.id,
      );
      return Promise.resolve();
    },
    approvedClaimCount(campaignId) {
      const row = db.prepare(
        "SELECT COUNT(*) AS count FROM proof_gate_claims WHERE campaign_id = ? AND status = 'approved'",
      ).get<{ count: number }>(campaignId);
      return Promise.resolve(row?.count ?? 0);
    },
    findApprovedByNullifier(campaignId, nullifierHash) {
      const row = db.prepare(
        "SELECT json FROM proof_gate_claims WHERE campaign_id = ? AND nullifier_hash = ? AND status = 'approved'",
      ).get<{ json: string }>(campaignId, nullifierHash);
      return Promise.resolve(
        row ? JSON.parse(row.json) as ProofGateClaim<C> : undefined,
      );
    },
    reservePresentationHashes(campaignId, claimId, hashes) {
      try {
        const tx = db.transaction(() => {
          const stmt = db.prepare(
            "INSERT INTO proof_gate_presentation_hashes (hash, campaign_id, claim_id, created_at) VALUES (?, ?, ?, ?)",
          );
          const now = Math.floor(Date.now() / 1000);
          for (const hash of hashes) stmt.run(hash, campaignId, claimId, now);
        });
        tx();
        return Promise.resolve(true);
      } catch {
        return Promise.resolve(false);
      }
    },
    close() {
      db.close();
      return Promise.resolve();
    },
  };
}
