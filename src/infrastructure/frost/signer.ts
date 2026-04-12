/**
 * FROST Signer -- runs on each signer node.
 *
 * Each signer independently verifies the query result before
 * participating in the signing round. If verification fails,
 * the signer refuses to sign -> group signature cannot be formed
 * without threshold honest signers.
 */

import { verify } from "../verification/verifier.ts";
import type { Query, QueryResult, BlossomKeyMap } from "../../domain/types.ts";
import { signRound1, signRound2, dkgRound1, dkgRound2, dkgRound3 } from "./frost-cli.ts";

export interface FrostSignerConfig {
  /** This signer's DKG index (1-based). */
  signerIndex: number;
  /** This signer's key package (from DKG round 3). */
  keyPackage: string;
}

export interface FrostSigner {
  /** Execute a DKG round. */
  dkgRound(round: 1 | 2 | 3, input: DkgRoundInput): Promise<DkgRoundOutput | null>;

  /** Independently verify query result and produce signing material if valid. */
  verifyAndSign(
    query: Query,
    result: QueryResult,
    message: string,
    commitmentsJson?: string,
    blossomKeys?: BlossomKeyMap,
  ): Promise<SignerOutput | null>;
}

export interface DkgRoundInput {
  maxSigners?: number;
  minSigners?: number;
  secretPackage?: string;
  round1Packages?: string;
  round2SecretPackage?: string;
  round2Packages?: string;
}

export interface DkgRoundOutput {
  secretPackage?: string;
  package?: string;
  packages?: Record<string, string>;
  keyPackage?: string;
  pubkeyPackage?: string;
  groupPubkey?: string;
}

export interface SignerOutput {
  /** Round 1: nonce commitments. */
  nonce_commitment?: string;
  /** Round 1: nonces (kept secret for round 2). */
  nonces?: string;
  /** Round 2: signature share. */
  signature_share?: string;
}

export function createFrostSigner(config: FrostSignerConfig): FrostSigner {
  // Nonces are generated in round 1 and consumed in round 2
  let pendingNonces: string | undefined;

  return {
    async dkgRound(round, input) {
      if (round === 1) {
        const result = await dkgRound1(
          config.signerIndex,
          input.maxSigners ?? 3,
          input.minSigners ?? 2,
        );
        if (!result.ok || !result.data) return null;
        return {
          secretPackage: result.data.secret_package as string,
          package: result.data.package as string,
        };
      }

      if (round === 2) {
        if (!input.secretPackage || !input.round1Packages) return null;
        const result = await dkgRound2(input.secretPackage, input.round1Packages);
        if (!result.ok || !result.data) return null;
        return {
          secretPackage: result.data.secret_package as string,
          packages: result.data.packages as Record<string, string>,
        };
      }

      if (round === 3) {
        if (!input.round2SecretPackage || !input.round1Packages || !input.round2Packages) return null;
        const result = await dkgRound3(
          input.round2SecretPackage,
          input.round1Packages,
          input.round2Packages,
        );
        if (!result.ok || !result.data) return null;
        return {
          keyPackage: result.data.key_package as string,
          pubkeyPackage: result.data.pubkey_package as string,
          groupPubkey: result.data.group_pubkey as string,
        };
      }

      return null;
    },

    async verifyAndSign(query, result, message, commitmentsJson, blossomKeys) {
      // Step 1: Independent verification using existing oracle verify
      const detail = await verify(query, result, blossomKeys);
      if (!detail.passed) {
        console.error(`[frost-signer] Verification failed for ${query.id}: ${detail.failures.join(", ")}`);
        return null; // Refuse to sign
      }

      // Step 2: If no commitments, this is round 1 — generate nonce commitments
      if (!commitmentsJson) {
        const r1 = await signRound1(config.keyPackage);
        if (!r1.ok || !r1.data) return null;
        pendingNonces = r1.data.nonces as string;
        return {
          nonce_commitment: r1.data.commitments as string,
          nonces: pendingNonces,
        };
      }

      // Step 3: Round 2 — produce signature share
      const nonces = pendingNonces;
      if (!nonces) {
        console.error(`[frost-signer] No pending nonces for round 2`);
        return null;
      }

      const r2 = await signRound2(config.keyPackage, nonces, commitmentsJson, message);
      pendingNonces = undefined; // Consume nonces
      if (!r2.ok || !r2.data) return null;

      return {
        signature_share: r2.data.signature_share as string,
      };
    },
  };
}
