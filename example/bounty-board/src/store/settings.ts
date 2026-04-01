import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface SettingsState {
  serverUrl: string;
  relayUrls: string[];
  mintUrl: string;

  setServerUrl: (url: string) => void;
  setRelayUrls: (urls: string[]) => void;
  setMintUrl: (url: string) => void;
  load: () => Promise<void>;
}

const STORAGE_KEY_SERVER = "anchr_server_url";
const STORAGE_KEY_RELAYS = "anchr_relay_urls";
const STORAGE_KEY_MINT = "anchr_mint_url";

const DEFAULT_SERVER_URL = __DEV__ ? "http://localhost:3000" : "https://anchr-app.fly.dev";
const DEFAULT_RELAY_URLS = ["wss://relay.damus.io", "wss://nos.lol"];
const DEFAULT_MINT_URL = "https://mint.minibits.cash/Bitcoin";

export const useSettingsStore = create<SettingsState>((set) => ({
  serverUrl: DEFAULT_SERVER_URL,
  relayUrls: DEFAULT_RELAY_URLS,
  mintUrl: DEFAULT_MINT_URL,

  setServerUrl: (url: string) => {
    const trimmed = url.replace(/\/+$/, "");
    set({ serverUrl: trimmed });
    AsyncStorage.setItem(STORAGE_KEY_SERVER, trimmed);
  },

  setRelayUrls: (urls: string[]) => {
    set({ relayUrls: urls });
    AsyncStorage.setItem(STORAGE_KEY_RELAYS, JSON.stringify(urls));
  },

  setMintUrl: (url: string) => {
    const trimmed = url.replace(/\/+$/, "");
    set({ mintUrl: trimmed });
    AsyncStorage.setItem(STORAGE_KEY_MINT, trimmed);
  },

  load: async () => {
    try {
      const [server, relays, mint] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY_SERVER),
        AsyncStorage.getItem(STORAGE_KEY_RELAYS),
        AsyncStorage.getItem(STORAGE_KEY_MINT),
      ]);
      set({
        serverUrl: server || DEFAULT_SERVER_URL,
        relayUrls: relays ? JSON.parse(relays) : DEFAULT_RELAY_URLS,
        mintUrl: mint || DEFAULT_MINT_URL,
      });
    } catch (e) {
      console.error("[settings] load error:", e);
    }
  },
}));
