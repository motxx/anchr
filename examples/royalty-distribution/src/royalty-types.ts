/**
 * Royalty Distribution — type stubs for the verification-only chain
 * across rights-graph edges.
 *
 * These types describe the shape of a distribution graph so that the
 * verification engine and demo can exercise the recursive
 * Requester/Worker/Oracle pattern. Wire-format alignment with Anchr
 * core types comes later; for now this is a self-contained sketch.
 */

/**
 * A piece of content (song, image, video, dataset) with optional
 * upstream derivatives (samples, covers, remixes, translations).
 */
export interface Content {
  /** Stable ID — typically a content-addressed hash (sha256, IPFS CID). */
  id: string;
  title: string;
  /** Optional pointers to upstream content this work derives from. */
  derived_from?: string[];
}

/**
 * One holder's share of a piece of content.
 *
 * `type` is descriptive and unconstrained — the example suite uses
 * "composer", "lyricist", "performer", "producer", "publisher",
 * "marketplace_creator", etc. The verification engine treats them
 * opaquely.
 */
export interface RightHolder {
  type: string;
  holder_pubkey: string;
  /** Share as basis points (10000 = 100%). Avoid floating point. */
  share_bps: number;
}

/** The full rights-graph entry for one piece of content. */
export interface ContentRights {
  content_id: string;
  holders: RightHolder[];
}

/**
 * A reported use of content: stream, download, performance, sync,
 * secondary sale, etc. The numeric volume is unitless — could be
 * play counts, copies, seconds — interpreted by the rate logic.
 */
export interface UseEvent {
  content_id: string;
  platform: string;
  use_type: string;
  volume: number;
  /** Reporting period, unix seconds. */
  period_start: number;
  period_end: number;
}

/**
 * A composed proof for one verified edge of the distribution graph.
 *
 * Each field corresponds to a TLSNotary presentation against an
 * external API (or a Nostr event reference for chain audit). In this
 * sketch they are opaque strings; the wired-up version would carry
 * actual TLSN presentations.
 */
export interface EdgeProof {
  /** TLSN proof of platform's reported use. */
  use_proof: string;
  /** TLSN proof of content identification (recognition API). */
  identity_proof?: string;
  /** TLSN proof of rights-database lookup. */
  rights_proof: string;
  /** Optional Nostr event ID linking to a parent content's rights chain. */
  derivative_chain_event?: string;
}

/** One edge of the verified distribution: who pays whom how much, with proof. */
export interface DistributionEdge {
  edge_id: string;
  use_event: UseEvent;
  from_pubkey: string;
  to_pubkey: string;
  amount_sats: number;
  proof: EdgeProof;
}

/** A verification report for a single use across the rights graph. */
export interface DistributionReport {
  use_event: UseEvent;
  edges: DistributionEdge[];
  total_distributed_sats: number;
  all_proofs_verified: boolean;
  audit_trail_intact: boolean;
}
