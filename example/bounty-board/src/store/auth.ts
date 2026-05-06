import { create } from "zustand";
import { secureStoreProvider } from "../platform/secure-store.ts";
import { generateIdentity, restoreIdentity, type NostrIdentity } from "../nostr/identity.ts";
import { npubEncode } from "../nostr/nip19.ts";

interface AuthState {
  loaded: boolean;
  secretKeyHex: string | null;
  publicKey: string | null;
  npub: string | null;
  identity: NostrIdentity | null;

  load: () => Promise<void>;
  generateAndStore: () => Promise<void>;
  importSecretKey: (secretKeyHex: string) => Promise<void>;
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
