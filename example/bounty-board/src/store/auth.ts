import { create } from "zustand";
import { secureStoreProvider } from "../platform/secure-store";
import { generateIdentity, restoreIdentity, type NostrIdentity } from "../nostr/identity";
import { npubEncode } from "../nostr/nip19";

interface AuthState {
  /** Whether auth has been loaded from storage. */
  loaded: boolean;
  /** Hex-encoded secret key (null if not logged in). */
  secretKeyHex: string | null;
  /** Hex-encoded public key. */
  publicKey: string | null;
  /** Bech32-encoded npub. */
  npub: string | null;
  /** Full identity object (derived from secretKeyHex). */
  identity: NostrIdentity | null;

  /** Load stored identity from SecureStore. */
  load: () => Promise<void>;
  /** Generate a new identity and persist it. */
  generateAndStore: () => Promise<void>;
  /** Import an nsec and persist it. */
  importSecretKey: (secretKeyHex: string) => Promise<void>;
  /** Clear identity and log out. */
  logout: () => Promise<void>;
}

const STORAGE_KEY = "anchr_nostr_secret_key";

export const useAuthStore = create<AuthState>((set) => ({
  loaded: false,
  secretKeyHex: null,
  publicKey: null,
  npub: null,
  identity: null,

  load: async () => {
    try {
      const stored = await secureStoreProvider.getItem(STORAGE_KEY);
      if (stored) {
        const identity = restoreIdentity(stored);
        set({
          loaded: true,
          secretKeyHex: identity.secretKeyHex,
          publicKey: identity.publicKey,
          npub: npubEncode(identity.publicKey),
          identity,
        });
      } else {
        set({ loaded: true });
      }
    } catch (e) {
      console.error("[auth] load error:", e);
      set({ loaded: true });
    }
  },

  generateAndStore: async () => {
    const identity = generateIdentity();
    await secureStoreProvider.setItem(STORAGE_KEY, identity.secretKeyHex);
    set({
      secretKeyHex: identity.secretKeyHex,
      publicKey: identity.publicKey,
      npub: npubEncode(identity.publicKey),
      identity,
    });
  },

  importSecretKey: async (secretKeyHex: string) => {
    const identity = restoreIdentity(secretKeyHex);
    await secureStoreProvider.setItem(STORAGE_KEY, identity.secretKeyHex);
    set({
      secretKeyHex: identity.secretKeyHex,
      publicKey: identity.publicKey,
      npub: npubEncode(identity.publicKey),
      identity,
    });
  },

  logout: async () => {
    await secureStoreProvider.deleteItem(STORAGE_KEY);
    set({
      secretKeyHex: null,
      publicKey: null,
      npub: null,
      identity: null,
    });
  },
}));
