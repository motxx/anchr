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
import type { MarketFrostNodeConfig } from "../frost/market-frost-config.ts";
import { coordinateSigning, type SigningCoordinatorConfig } from "../frost/signing-coordinator.ts";
import { isFrostSignerAvailable } from "../frost/frost-cli.ts";
import { bytesToHex } from "@noble/hashes/utils.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface FrostDualKeyStoreConfig {
  /** FROST node config for YES group (DKG group 1). */
  yesConfig: MarketFrostNodeConfig;
  /** Timeout for peer signing HTTP calls (ms). */
  peerTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// FROST-backed DualKeyStore
// ---------------------------------------------------------------------------

/**
 * Create a DualKeyStore that delegates signing to a FROST threshold cluster.
 *
 * Keys are pre-generated via `scripts/frost-market-dkg-bootstrap.ts`.
 * The store does not hold secret key material -- it coordinates signing
 * across peer nodes, each of which holds a key share.
 *
 * Falls back to single-key `createDualKeyStore()` when the frost-signer
 * binary is not available.
 */
export function createFrostDualKeyStore(config: FrostDualKeyStoreConfig): DualKeyStore {
  if (!isFrostSignerAvailable()) {
    console.warn("[frost-dual-key-store] frost-signer not available, falling back to single-key mode");
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
        pubkey_b: yesConfig.group_pubkey_no,
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
      console.warn(
        "[frost-dual-key-store] sign() called synchronously -- " +
        "use signAsync() for real FROST threshold signing"
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
 * Perform FROST threshold signing for a prediction market resolution.
 *
 * This is the async counterpart of `DualKeyStore.sign()`. It coordinates
 * signing across peer Oracle nodes and returns the group signature only
 * if t-of-n signers agree on the outcome.
 *
 * @param config FROST node config (contains key material and peer list)
 * @param outcome Which group key to sign with ("a" = YES, "b" = NO)
 * @param message Message to sign (typically `${market_id}:${outcome}`)
 * @param conditionData Optional condition data for peers to verify independently
 */
export async function frostDualKeySignAsync(
  config: MarketFrostNodeConfig,
  outcome: "a" | "b",
  message: Uint8Array,
  conditionData?: { market_id: string; resolution_url: string; verified_body: string },
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
          key_package: config.key_package_no,
          pubkey_package: config.pubkey_package_no,
          group_pubkey: config.group_pubkey_no,
          peers: config.peers,
        },
    peerTimeoutMs: 15_000,
    // Pass condition data for peer independent verification
    query: conditionData ? {
      id: conditionData.market_id,
      type: "market_resolution",
      resolution_url: conditionData.resolution_url,
    } : undefined,
    result: conditionData ? {
      verified_body: conditionData.verified_body,
    } : undefined,
  };

  const result = await coordinateSigning(signingConfig, messageHex);
  if (!result) {
    console.error("[frost-dual-key-store] FROST signing failed -- threshold not met");
    return null;
  }

  console.log(
    `[frost-dual-key-store] FROST signing succeeded: ${result.signers_participated.length} signers participated`
  );
  return result.signature;
}

// ---------------------------------------------------------------------------
// Adaptive store factory
// ---------------------------------------------------------------------------

/**
 * Create a DualKeyStore with automatic FROST/single-key selection.
 *
 * - If `marketFrostConfig` is provided and frost-signer is available:
 *   returns a FROST-backed store.
 * - Otherwise: returns the single-key demo store.
 *
 * This is the recommended entry point for market Oracle servers.
 */
export function createAdaptiveDualKeyStore(
  marketFrostConfig?: MarketFrostNodeConfig,
): { store: DualKeyStore; mode: "frost" | "single-key"; config?: MarketFrostNodeConfig } {
  if (marketFrostConfig && isFrostSignerAvailable()) {
    return {
      store: createFrostDualKeyStore({ yesConfig: marketFrostConfig }),
      mode: "frost",
      config: marketFrostConfig,
    };
  }

  return {
    store: createDualKeyStore(),
    mode: "single-key",
  };
}
