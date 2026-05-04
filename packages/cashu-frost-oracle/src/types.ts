/** Configuration for a threshold oracle group. */
export interface ThresholdOracleConfig {
  /** Minimum signers required (t in t-of-n). */
  threshold: number;
  /** Total signers in the group. */
  total_signers: number;
  /** Each signer's Nostr pubkey (hex). */
  signer_pubkeys: string[];
  /** FROST DKG-generated group public key (BIP-340 x-only hex). */
  group_pubkey: string;
}

/** Tracks a FROST signing session for a query. */
export interface FrostSigningSession {
  session_id: string;
  query_id: string;
  config: ThresholdOracleConfig;
  /** Hex-encoded message to sign (SIG_ALL of Cashu proofs). */
  message: string;
  /** signer_pubkey -> nonce commitments JSON. */
  nonce_commitments: Map<string, string>;
  /** signer_pubkey -> signature share JSON. */
  signature_shares: Map<string, string>;
  /** BIP-340 Schnorr signature (set when threshold reached). */
  group_signature?: string;
  finalized: boolean;
  created_at: number;
}

/** DKG session state. */
export interface DkgSession {
  session_id: string;
  threshold: number;
  total_signers: number;
  current_round: 0 | 1 | 2 | 3;
  /** index -> round1 package JSON. */
  round1_packages: Map<number, string>;
  /** index -> round1 secret package JSON (kept by each signer). */
  round1_secret_packages: Map<number, string>;
  /** index -> { target_index -> round2 package JSON }. */
  round2_packages: Map<number, Map<number, string>>;
  /** index -> round2 secret package JSON. */
  round2_secret_packages: Map<number, string>;
  /** Results after round 3. */
  key_packages: Map<number, string>;
  pubkey_package?: string;
  group_pubkey?: string;
  created_at: number;
}

/** Result of advancing a DKG round. */
export interface DkgRoundResult {
  round: 1 | 2 | 3;
  complete: boolean;
  /** Set after round 3 completes. */
  group_pubkey?: string;
  pubkey_package?: string;
}

/** NIP-44 DM messages for FROST inter-signer communication. */
export interface FrostDkgMessage {
  type: "frost_dkg_round1" | "frost_dkg_round2" | "frost_dkg_round3";
  session_id: string;
  signer_index: number;
  payload: string;
}

export interface FrostSigningMessage {
  type: "frost_sign_round1" | "frost_sign_round2";
  session_id: string;
  query_id: string;
  signer_pubkey: string;
  payload: string;
}
