/**
 * FROST Coordinator -- manages DKG and signing sessions.
 *
 * The coordinator is a relay: it collects round packages from signers
 * and advances rounds via the frost-signer CLI. It never holds
 * secret key material.
 */

import { randomBytes } from "node:crypto";
import type {
  DkgSession,
  DkgRoundResult,
  FrostSigningSession,
  ThresholdOracleConfig,
} from "./types.ts";
import {
  aggregateSignatures,
} from "./frost-cli.ts";

export interface FrostCoordinator {
  /** Start a new DKG session. */
  initDkg(config: { threshold: number; total: number }): DkgSession;

  /** Submit a signer's DKG round package. Returns result when round is complete. */
  submitDkgPackage(
    sessionId: string,
    round: 1 | 2 | 3,
    signerIndex: number,
    packageJson: string,
    secretPackageJson?: string,
  ): Promise<DkgRoundResult | null>;

  /** Get DKG session state. */
  getDkgSession(sessionId: string): DkgSession | undefined;

  /** Start a FROST signing session for a query. */
  startSigning(
    queryId: string,
    message: string,
    config: ThresholdOracleConfig,
  ): FrostSigningSession;

  /** Submit a signer's nonce commitment. */
  submitNonceCommitment(
    sessionId: string,
    signerPubkey: string,
    commitment: string,
  ): void;

  /** Submit a signer's signature share. */
  submitSignatureShare(
    sessionId: string,
    signerPubkey: string,
    share: string,
  ): void;

  /** Try to aggregate signatures if threshold is met. Returns signature or null. */
  tryAggregate(sessionId: string, pubkeyPackage?: string): Promise<{ signature: string } | null>;

  /** Get signing session state. */
  getSigningSession(sessionId: string): FrostSigningSession | undefined;
}

function generateSessionId(): string {
  return `frost_${Date.now()}_${randomBytes(8).toString("hex")}`;
}

export function createFrostCoordinator(): FrostCoordinator {
  const dkgSessions = new Map<string, DkgSession>();
  const signingSessions = new Map<string, FrostSigningSession>();
  // queryId -> sessionId for lookup
  const querySessionMap = new Map<string, string>();

  return {
    initDkg(config) {
      const session: DkgSession = {
        session_id: generateSessionId(),
        threshold: config.threshold,
        total_signers: config.total,
        current_round: 0,
        round1_packages: new Map(),
        round1_secret_packages: new Map(),
        round2_packages: new Map(),
        round2_secret_packages: new Map(),
        key_packages: new Map(),
        created_at: Date.now(),
      };
      dkgSessions.set(session.session_id, session);
      return session;
    },

    async submitDkgPackage(sessionId, round, signerIndex, packageJson, secretPackageJson) {
      const session = dkgSessions.get(sessionId);
      if (!session) return null;

      if (round === 1) {
        session.round1_packages.set(signerIndex, packageJson);
        if (secretPackageJson) {
          session.round1_secret_packages.set(signerIndex, secretPackageJson);
        }

        if (session.round1_packages.size >= session.total_signers) {
          session.current_round = 1;
          return { round: 1, complete: true };
        }
        return { round: 1, complete: false };
      }

      if (round === 2) {
        // packageJson contains the packages map for this signer
        const packages = JSON.parse(packageJson) as Record<string, string>;
        const pkgMap = new Map<number, string>();
        for (const [idx, pkg] of Object.entries(packages)) {
          pkgMap.set(Number(idx), pkg);
        }
        session.round2_packages.set(signerIndex, pkgMap);
        if (secretPackageJson) {
          session.round2_secret_packages.set(signerIndex, secretPackageJson);
        }

        if (session.round2_packages.size >= session.total_signers) {
          session.current_round = 2;
          return { round: 2, complete: true };
        }
        return { round: 2, complete: false };
      }

      if (round === 3) {
        session.key_packages.set(signerIndex, packageJson);

        // Parse group_pubkey and pubkey_package from the result
        try {
          const parsed = JSON.parse(packageJson);
          if (parsed.group_pubkey && !session.group_pubkey) {
            session.group_pubkey = parsed.group_pubkey;
          }
          if (parsed.pubkey_package && !session.pubkey_package) {
            session.pubkey_package = parsed.pubkey_package;
          }
        } catch { /* ignore parse errors */ }

        if (session.key_packages.size >= session.total_signers) {
          session.current_round = 3;
          return {
            round: 3,
            complete: true,
            group_pubkey: session.group_pubkey,
            pubkey_package: session.pubkey_package,
          };
        }
        return { round: 3, complete: false };
      }

      return null;
    },

    getDkgSession(sessionId) {
      return dkgSessions.get(sessionId);
    },

    startSigning(queryId, message, config) {
      const session: FrostSigningSession = {
        session_id: generateSessionId(),
        query_id: queryId,
        config,
        message,
        nonce_commitments: new Map(),
        signature_shares: new Map(),
        finalized: false,
        created_at: Date.now(),
      };
      signingSessions.set(session.session_id, session);
      querySessionMap.set(queryId, session.session_id);
      return session;
    },

    submitNonceCommitment(sessionId, signerPubkey, commitment) {
      const session = signingSessions.get(sessionId);
      if (!session || session.finalized) return;
      session.nonce_commitments.set(signerPubkey, commitment);
    },

    submitSignatureShare(sessionId, signerPubkey, share) {
      const session = signingSessions.get(sessionId);
      if (!session || session.finalized) return;
      session.signature_shares.set(signerPubkey, share);
    },

    async tryAggregate(sessionId, pubkeyPackage) {
      const session = signingSessions.get(sessionId);
      if (!session || session.finalized) return null;
      if (session.signature_shares.size < session.config.threshold) return null;

      // Collect commitments and shares as JSON maps
      const commitmentsObj: Record<string, string> = {};
      for (const [pk, c] of session.nonce_commitments) {
        commitmentsObj[pk] = c;
      }

      const sharesObj: Record<string, string> = {};
      for (const [pk, s] of session.signature_shares) {
        sharesObj[pk] = s;
      }

      const resolvedPubkeyPkg = pubkeyPackage ?? "";

      const result = await aggregateSignatures(
        session.config.group_pubkey,
        JSON.stringify(commitmentsObj),
        session.message,
        JSON.stringify(sharesObj),
        resolvedPubkeyPkg,
      );

      if (!result.ok || !result.data?.signature) return null;

      const signature = result.data.signature as string;
      session.group_signature = signature;
      session.finalized = true;
      return { signature };
    },

    getSigningSession(sessionId) {
      return signingSessions.get(sessionId);
    },
  };
}
