/**
 * FROST-backed DualKeyStore -- delegates signing to threshold Oracle cluster.
 *
 * In single-node (demo) mode, `createDualKeyStore()` in frost-conditional-swap.ts
 * generates plain Schnorr keypairs and signs locally.
 *
 * This implementation instead:
 * - Loads pre-generated FROST group pubkeys (from DKG bootstrap)
 * - Delegates signing to `coordinateSigning()` across peer Oracle nodes
 * - Falls back to single-key `createDualKeyStore()` when FROST is unavailable
 *
 * The `DualKeyStore` interface remains identical -- consumers are unaware of
 * whether signing is local or distributed.
 */

import type { DualKeyStore, DualKeyEntry } from "./frost-conditional-swap.ts";
import { createDualKeyStore } from "./frost-conditional-swap.ts";
import type { DualOutcomeFrostNodeConfig } from "@anchr/frost-oracle/dual-outcome-config";
import { coordinateSigning, type SigningCoordinatorConfig } from "@anchr/frost-oracle/signing-coordinator";
import { isFrostSignerAvailable } from "@anchr/frost-oracle/frost-cli";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { getLogger } from "@anchr/core-runtime/logger";
const log = getLogger(["anchr", "frost-dual-key-store"]);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface FrostDualKeyStoreConfig {
  /** FROST node config — outcome A by default; outcome B is read from the dual-outcome fields. */
  yesConfig: DualOutcomeFrostNodeConfig;
  /** Timeout for peer signing HTTP calls (ms). */
  peerTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// FROST-backed DualKeyStore
// ---------------------------------------------------------------------------

/**
 * Create a DualKeyStore that delegates signing to a FROST threshold cluster.
 *
 * Keys are pre-generated via `scripts/frost-dual-outcome-dkg-bootstrap.ts`.
 * The store does not hold secret key material -- it coordinates signing
 * across peer nodes, each of which holds a key share.
 *
 * Falls back to single-key `createDualKeyStore()` when the frost-signer
 * binary is not available.
 */
export function createFrostDualKeyStore(config: FrostDualKeyStoreConfig): DualKeyStore {
  if (!isFrostSignerAvailable()) {
    log.warn("frost-signer not available, falling back to single-key mode");
    return createDualKeyStore();
  }

  const { yesConfig, peerTimeoutMs } = config;
  const entries = new Map<string, DualKeyEntry>();
  const signedSwaps = new Set<string>();

  return {
    create(swap_id: string): DualKeyEntry {
      const existing = entries.get(swap_id);
      if (existing) return existing;

      const entry: DualKeyEntry = {
        swap_id,
        pubkey_a: yesConfig.group_pubkey,
        pubkey_b: yesConfig.group_pubkey_b,
        // No secret keys in FROST mode -- signing is distributed
        signed: false,
      };

      entries.set(swap_id, entry);
      return entry;
    },

    sign(swap_id: string, outcome: "a" | "b", message: Uint8Array): string | null {
      const entry = entries.get(swap_id);
      if (!entry || entry.signed || signedSwaps.has(swap_id)) return null;

      // Mark as signed immediately to prevent concurrent sign attempts
      entry.signed = true;
      signedSwaps.add(swap_id);

      // FROST signing is async but DualKeyStore.sign() is sync.
      // Return a placeholder -- the actual signing happens via signAsync().
      // Consumers that need FROST should use signAsync() instead.
      log.warn("sign() called synchronously -- " +
        "use signAsync() for real FROST threshold signing"
      );
      return null;
    },

    signProofSecrets(
      swap_id: string,
      _outcome: "a" | "b",
      _proofSecrets: string[],
    ): Map<string, string> | null {
      const entry = entries.get(swap_id);
      if (!entry || entry.signed || signedSwaps.has(swap_id)) return null;

      // FROST per-proof signing is async -- use frostSignProofSecretsAsync() instead.
      log.warn("signProofSecrets() called synchronously -- " +
        "use frostSignProofSecretsAsync() for real FROST threshold signing"
      );
      return null;
    },

    getPubkeys(swap_id: string): { pubkey_a: string; pubkey_b: string } | null {
      const entry = entries.get(swap_id);
      if (!entry) return null;
      return { pubkey_a: entry.pubkey_a, pubkey_b: entry.pubkey_b };
    },

    has(swap_id: string): boolean {
      return entries.has(swap_id);
    },
  };
}

// ---------------------------------------------------------------------------
// Async signing (FROST threshold)
// ---------------------------------------------------------------------------

/**
 * Perform FROST threshold signing for a binary-outcome resolution (e.g. binary bet, dispute).
 *
 * This is the async counterpart of `DualKeyStore.sign()`. It coordinates
 * signing across peer Oracle nodes and returns the group signature only
 * if t-of-n signers agree on the outcome.
 *
 * @param config FROST node config (contains key material and peer list)
 * @param outcome Which group key to sign with ("a" = outcome A, "b" = outcome B)
 * @param message Message to sign (typically `${condition_id}:${outcome}`)
 * @param conditionData Optional condition data for peers to verify independently
 */
export async function frostDualKeySignAsync(
  config: DualOutcomeFrostNodeConfig,
  outcome: "a" | "b",
  message: Uint8Array,
  conditionData?: { condition_id: string; resolution_url: string; verified_body: string },
): Promise<string | null> {
  const messageHex = bytesToHex(message);

  // Select the correct FROST group config based on outcome
  const signingConfig: SigningCoordinatorConfig = {
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
    peerTimeoutMs: 15_000,
    // Forward condition context to peers for independent verification.
    // The shape is the host-side `VerificationRequirement` / `VerificationInput`
    // pair the FROST signer route in `oracle-frost-signer-routes.ts` consumes.
    requirement: conditionData ? {
      id: conditionData.condition_id,
      factors: ["tlsn"],
      tlsn_requirements: {
        target_url: conditionData.resolution_url,
        conditions: [],
      },
    } : undefined,
    input: conditionData ? {
      attachments: [],
      tlsn_attestation: { presentation: conditionData.verified_body },
    } : undefined,
  };

  const result = await coordinateSigning(signingConfig, messageHex);
  if (!result) {
    log.error("FROST signing failed -- threshold not met");
    return null;
  }

  log.info(`FROST signing succeeded: ${result.signers_participated.length} signers participated`
  );
  return result.signature;
}

/**
 * Perform FROST threshold signing for multiple proof secrets (NUT-11 P2PK).
 *
 * For each proof secret, computes SHA256(secret) and coordinates FROST signing
 * across peer Oracle nodes. Returns a map of proofSecret -> hex signature.
 *
 * This is sequential per-proof for simplicity. Future optimization: batch
 * nonce commitments across all secrets in one round-trip.
 *
 * @param config FROST node config
 * @param outcome Which group key to sign with ("a" = outcome A, "b" = outcome B)
 * @param proofSecrets Array of proof secret strings to sign
 * @param conditionData Optional condition data for peers to verify independently
 */
export async function frostSignProofSecretsAsync(
  config: DualOutcomeFrostNodeConfig,
  outcome: "a" | "b",
  proofSecrets: string[],
  conditionData?: { condition_id: string; resolution_url: string; verified_body: string },
): Promise<Map<string, string> | null> {
  const result = new Map<string, string>();

  for (const proofSecret of proofSecrets) {
    // NUT-11 P2PK: signing message = SHA256(proof.secret)
    const msgHash = sha256(new TextEncoder().encode(proofSecret));
    const sig = await frostDualKeySignAsync(config, outcome, msgHash, conditionData);
    if (!sig) {
      log.error(`FROST per-proof signing failed for secret`);
      return null;
    }
    result.set(proofSecret, sig);
  }

  log.info(`FROST per-proof signing succeeded: ${proofSecrets.length} proofs signed`
  );
  return result;
}

// ---------------------------------------------------------------------------
// Adaptive store factory
// ---------------------------------------------------------------------------

/**
 * Create a DualKeyStore with automatic FROST/single-key selection.
 *
 * - If `dualOutcomeFrostConfig` is provided and frost-signer is available:
 *   returns a FROST-backed store.
 * - Otherwise: returns the single-key demo store.
 *
 * This is the recommended entry point for dual-outcome Oracle servers.
 */
export function createAdaptiveDualKeyStore(
  dualOutcomeFrostConfig?: DualOutcomeFrostNodeConfig,
): { store: DualKeyStore; mode: "frost" | "single-key"; config?: DualOutcomeFrostNodeConfig } {
  if (dualOutcomeFrostConfig && isFrostSignerAvailable()) {
    return {
      store: createFrostDualKeyStore({ yesConfig: dualOutcomeFrostConfig }),
      mode: "frost",
      config: dualOutcomeFrostConfig,
    };
  }

  return {
    store: createDualKeyStore(),
    mode: "single-key",
  };
}
