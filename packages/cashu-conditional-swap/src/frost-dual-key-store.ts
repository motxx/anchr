/**
 * Binary-outcome release authority for P2PK conditional swaps.
 *
 * Single-key demo mode wraps `DualKeyStore` behind an async port.
 * FROST mode exposes the same async port but delegates signing to the
 * threshold Oracle cluster through `coordinateSigning()`.
 */

import type { DualKeyEntry, DualKeyStore } from "./frost-conditional-swap.ts";
import { createDualKeyStore } from "./frost-conditional-swap.ts";
import type { DualOutcomeFrostNodeConfig } from "@anchr/frost-oracle/dual-outcome-config";
import {
  coordinateSigning,
  type SigningCoordinatorConfig,
} from "@anchr/frost-oracle/signing-coordinator";
import { isFrostSignerAvailable } from "@anchr/frost-oracle/frost-cli";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { getLogger } from "@anchr/core-runtime/logger";
const log = getLogger(["anchr", "release-authority"]);

export type BinaryOutcome = "a" | "b";

export interface BinaryOutcomeConditionData {
  condition_id: string;
  resolution_url: string;
  verified_body: string;
}

export interface ReleaseSignatureRequest {
  swap_id: string;
  outcome: BinaryOutcome;
  message: Uint8Array;
  conditionData?: BinaryOutcomeConditionData;
}

export interface ReleaseProofSecretsRequest {
  swap_id: string;
  outcome: BinaryOutcome;
  proofSecrets: string[];
  conditionData?: BinaryOutcomeConditionData;
}

export interface BinaryOutcomeReleaseAuthority {
  create(swap_id: string): DualKeyEntry;
  getPubkeys(swap_id: string): { pubkey_a: string; pubkey_b: string } | null;
  has(swap_id: string): boolean;
  releaseSignature(request: ReleaseSignatureRequest): Promise<string | null>;
  releaseProofSecretSignatures(
    request: ReleaseProofSecretsRequest,
  ): Promise<Map<string, string> | null>;
}

export interface FrostReleaseAuthorityConfig {
  nodeConfig: DualOutcomeFrostNodeConfig;
  peerTimeoutMs?: number;
}

export function createSingleKeyReleaseAuthority(
  store: DualKeyStore = createDualKeyStore(),
): BinaryOutcomeReleaseAuthority {
  return {
    create: (swap_id) => store.create(swap_id),
    getPubkeys: (swap_id) => store.getPubkeys(swap_id),
    has: (swap_id) => store.has(swap_id),
    releaseSignature(request) {
      return Promise.resolve(
        store.sign(request.swap_id, request.outcome, request.message),
      );
    },
    releaseProofSecretSignatures(request) {
      if (request.proofSecrets.length === 0) return Promise.resolve(null);
      return Promise.resolve(
        store.signProofSecrets(
          request.swap_id,
          request.outcome,
          request.proofSecrets,
        ),
      );
    },
  };
}

export function createFrostReleaseAuthority(
  config: FrostReleaseAuthorityConfig,
): BinaryOutcomeReleaseAuthority {
  const { nodeConfig, peerTimeoutMs } = config;
  const entries = new Map<string, DualKeyEntry>();
  const signedSwaps = new Set<string>();

  return {
    create(swap_id: string): DualKeyEntry {
      const existing = entries.get(swap_id);
      if (existing) return existing;

      const entry: DualKeyEntry = {
        swap_id,
        pubkey_a: nodeConfig.group_pubkey,
        pubkey_b: nodeConfig.group_pubkey_b,
        signed: false,
      };
      entries.set(swap_id, entry);
      return entry;
    },

    getPubkeys(swap_id: string): { pubkey_a: string; pubkey_b: string } | null {
      const entry = entries.get(swap_id);
      if (!entry) return null;
      return { pubkey_a: entry.pubkey_a, pubkey_b: entry.pubkey_b };
    },

    has(swap_id: string): boolean {
      return entries.has(swap_id);
    },

    async releaseSignature(
      request: ReleaseSignatureRequest,
    ): Promise<string | null> {
      const entry = entries.get(request.swap_id);
      if (!entry || entry.signed || signedSwaps.has(request.swap_id)) {
        return null;
      }
      const signature = await coordinateFrostReleaseSignature(
        nodeConfig,
        request.outcome,
        request.message,
        request.conditionData,
        peerTimeoutMs,
      );
      if (!signature) return null;
      entry.signed = true;
      signedSwaps.add(request.swap_id);
      return signature;
    },

    async releaseProofSecretSignatures(
      request: ReleaseProofSecretsRequest,
    ): Promise<Map<string, string> | null> {
      const entry = entries.get(request.swap_id);
      if (!entry || entry.signed || signedSwaps.has(request.swap_id)) {
        return null;
      }
      const signatures = await coordinateFrostProofSecretSignatures(
        nodeConfig,
        request.outcome,
        request.proofSecrets,
        request.conditionData,
        peerTimeoutMs,
      );
      if (!signatures) return null;
      entry.signed = true;
      signedSwaps.add(request.swap_id);
      return signatures;
    },
  };
}

/**
 * Perform FROST threshold signing for a binary-outcome resolution.
 */
async function coordinateFrostReleaseSignature(
  config: DualOutcomeFrostNodeConfig,
  outcome: BinaryOutcome,
  message: Uint8Array,
  conditionData?: BinaryOutcomeConditionData,
  peerTimeoutMs: number = 15_000,
): Promise<string | null> {
  const messageHex = bytesToHex(message);
  const signingConfig = buildSigningCoordinatorConfig(
    config,
    outcome,
    conditionData,
    peerTimeoutMs,
  );

  const result = await coordinateSigning(signingConfig, messageHex);
  if (!result) {
    log.error("FROST signing failed -- threshold not met");
    return null;
  }

  log.info(
    `FROST signing succeeded: ${result.signers_participated.length} signers participated`,
  );
  return result.signature;
}

/**
 * Perform FROST threshold signing for multiple proof secrets (NUT-11 P2PK).
 */
async function coordinateFrostProofSecretSignatures(
  config: DualOutcomeFrostNodeConfig,
  outcome: BinaryOutcome,
  proofSecrets: string[],
  conditionData?: BinaryOutcomeConditionData,
  peerTimeoutMs: number = 15_000,
): Promise<Map<string, string> | null> {
  if (proofSecrets.length === 0) return null;

  const result = new Map<string, string>();

  for (const proofSecret of proofSecrets) {
    const msgHash = sha256(new TextEncoder().encode(proofSecret));
    const sig = await coordinateFrostReleaseSignature(
      config,
      outcome,
      msgHash,
      conditionData,
      peerTimeoutMs,
    );
    if (!sig) {
      log.error("FROST per-proof signing failed");
      return null;
    }
    result.set(proofSecret, sig);
  }

  log.info(
    `FROST per-proof signing succeeded: ${proofSecrets.length} proofs signed`,
  );
  return result;
}

export function createAdaptiveReleaseAuthority(
  dualOutcomeFrostConfig?: DualOutcomeFrostNodeConfig,
): {
  authority: BinaryOutcomeReleaseAuthority;
  mode: "frost" | "single-key";
  config?: DualOutcomeFrostNodeConfig;
} {
  if (dualOutcomeFrostConfig && isFrostSignerAvailable()) {
    return {
      authority: createFrostReleaseAuthority({
        nodeConfig: dualOutcomeFrostConfig,
      }),
      mode: "frost",
      config: dualOutcomeFrostConfig,
    };
  }

  return {
    authority: createSingleKeyReleaseAuthority(),
    mode: "single-key",
  };
}

function buildSigningCoordinatorConfig(
  config: DualOutcomeFrostNodeConfig,
  outcome: BinaryOutcome,
  conditionData: BinaryOutcomeConditionData | undefined,
  peerTimeoutMs: number,
): SigningCoordinatorConfig {
  return {
    nodeConfig: outcome === "a"
      ? {
        signer_index: config.signer_index,
        total_signers: config.total_signers,
        threshold: config.threshold,
        key_package: config.key_package,
        pubkey_package: config.pubkey_package,
        group_pubkey: config.group_pubkey,
        peers: config.peers,
      }
      : {
        signer_index: config.signer_index,
        total_signers: config.total_signers,
        threshold: config.threshold,
        key_package: config.key_package_b,
        pubkey_package: config.pubkey_package_b,
        group_pubkey: config.group_pubkey_b,
        peers: config.peers,
      },
    peerTimeoutMs,
    requirement: conditionData
      ? {
        id: conditionData.condition_id,
        factors: ["tlsn"],
        tlsn_requirements: {
          target_url: conditionData.resolution_url,
          conditions: [],
        },
      }
      : undefined,
    input: conditionData
      ? {
        attachments: [],
        tlsn_attestation: { presentation: conditionData.verified_body },
      }
      : undefined,
  };
}
