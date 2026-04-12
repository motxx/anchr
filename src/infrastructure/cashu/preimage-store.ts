/**
 * Preimage store for HTLC escrow — re-exports from @noble/hashes implementation.
 *
 * The canonical implementation lives in src/infrastructure/preimage/preimage-store.ts,
 * decoupled from Cashu. This file provides backward compatibility for existing imports.
 */

export {
  createPreimageStore,
  createPersistentPreimageStore,
  type PreimageEntry,
  type PreimageStore,
} from "../preimage/preimage-store";
