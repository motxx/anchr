/**
 * FROST Signer — runs on each signer node.
 *
 * Each signer independently verifies the supplied requirement / evidence
 * before participating in the signing round. If verification fails the
 * signer refuses to sign — the group signature cannot be formed without
 * a threshold of honest signers.
 *
 * The interface is `(requirement, input)` — the same shape the standalone
 * `verifyProof()` accepts — so this signer is reachable equally from a
 * NIP-90 host (which adapts via `queryToRequirement` / `queryResultToInput`)
 * and from a fixed-stakeholder caller that constructs the requirement
 * directly.
 */

import { verifyProof } from "../proofs/mod.ts";
import type {
  BlossomKeyMap,
  VerificationInput,
  VerificationRequirement,
} from "../requests/domain/types.ts";
import {
  dkgRound1,
  dkgRound2,
  dkgRound3,
  signRound1,
  signRound2,
} from "./frost-cli.ts";

import { getLogger } from "../internal/runtime/logger.ts";
const log = getLogger(["anchr", "frost-signer"]);

export interface FrostSignerConfig {
  /** This signer's DKG index (1-based). */
  signerIndex: number;
  /** This signer's key package (from DKG round 3). */
  keyPackage: string;
}

export interface FrostSigner {
  /** Execute a DKG round. */
  dkgRound(
    round: 1 | 2 | 3,
    input: DkgRoundInput,
  ): Promise<DkgRoundOutput | null>;

  /**
   * Independently verify the requirement / evidence pair and produce
   * signing material if the check passes.
   */
  verifyAndSign(
    requirement: VerificationRequirement,
    input: VerificationInput,
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

function asJsonString(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function asJsonStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, asJsonString(item)]),
  );
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
          secretPackage: asJsonString(result.data.secret_package),
          package: asJsonString(result.data.package),
        };
      }

      if (round === 2) {
        if (!input.secretPackage || !input.round1Packages) return null;
        const result = await dkgRound2(
          input.secretPackage,
          input.round1Packages,
        );
        if (!result.ok || !result.data) return null;
        return {
          secretPackage: asJsonString(result.data.secret_package),
          packages: asJsonStringMap(result.data.packages),
        };
      }

      if (round === 3) {
        if (
          !input.round2SecretPackage || !input.round1Packages ||
          !input.round2Packages
        ) return null;
        const result = await dkgRound3(
          input.round2SecretPackage,
          input.round1Packages,
          input.round2Packages,
        );
        if (!result.ok || !result.data) return null;
        return {
          keyPackage: asJsonString(result.data.key_package),
          pubkeyPackage: asJsonString(result.data.pubkey_package),
          groupPubkey: String(result.data.group_pubkey),
        };
      }

      return null;
    },

    async verifyAndSign(
      requirement,
      input,
      message,
      commitmentsJson,
      blossomKeys,
    ) {
      const detail = await verifyProof(requirement, input, { blossomKeys });
      if (!detail.passed) {
        log.error(
          `Verification failed for ${requirement.id}: ${
            detail.failures.join(", ")
          }`,
        );
        return null;
      }

      // Step 2: If no commitments, this is round 1 — generate nonce commitments
      if (!commitmentsJson) {
        const r1 = await signRound1(config.keyPackage);
        if (!r1.ok || !r1.data) return null;
        pendingNonces = asJsonString(r1.data.nonces);
        return {
          nonce_commitment: asJsonString(r1.data.commitments),
          nonces: pendingNonces,
        };
      }

      // Step 3: Round 2 — produce signature share
      const nonces = pendingNonces;
      if (!nonces) {
        log.error(`No pending nonces for round 2`);
        return null;
      }

      const r2 = await signRound2(
        config.keyPackage,
        nonces,
        commitmentsJson,
        message,
      );
      pendingNonces = undefined; // Consume nonces
      if (!r2.ok || !r2.data) return null;

      return {
        signature_share: asJsonString(r2.data.signature_share),
      };
    },
  };
}
