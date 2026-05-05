import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface SettingsState {
  serverUrl: string;
  apiKey: string;
  workerPubkey: string;
  setServerUrl: (url: string) => void;
  setApiKey: (key: string) => void;
  setWorkerPubkey: (pubkey: string) => void;
  load: () => Promise<void>;
}

const STORAGE_KEY_SERVER_URL = "anchr_server_url";
const STORAGE_KEY_API_KEY = "anchr_api_key";
const STORAGE_KEY_WORKER_PUBKEY = "anchr_worker_pubkey";

const DEFAULT_SERVER_URL = __DEV__ ? "http://localhost:3000" : "https://anchr-app.fly.dev";

export const useSettingsStore = create<SettingsState>((set) => ({
  serverUrl: DEFAULT_SERVER_URL,
  apiKey: "",
  workerPubkey: "",

  setServerUrl: (url: string) => {
    const trimmed = url.replace(/\/+$/, "");
    set({ serverUrl: trimmed });
    AsyncStorage.setItem(STORAGE_KEY_SERVER_URL, trimmed);
  },

  setApiKey: (key: string) => {
    set({ apiKey: key });
    AsyncStorage.setItem(STORAGE_KEY_API_KEY, key);
  },

  setWorkerPubkey: (pubkey: string) => {
    const trimmed = pubkey.trim();
    set({ workerPubkey: trimmed });
    AsyncStorage.setItem(STORAGE_KEY_WORKER_PUBKEY, trimmed);
  },

  load: async () => {
    try {
      const [url, key, pubkey] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY_SERVER_URL),
        AsyncStorage.getItem(STORAGE_KEY_API_KEY),
        AsyncStorage.getItem(STORAGE_KEY_WORKER_PUBKEY),
      ]);
      const resolvedUrl = url || DEFAULT_SERVER_URL;
      console.log(`[anchr-settings] load: stored="${url}", using="${resolvedUrl}"`);
      set({
        serverUrl: resolvedUrl,
        apiKey: key || "",
        workerPubkey: pubkey || "",
      });
    } catch (e) {
      console.error(`[anchr-settings] load error:`, e);
    }
  },
}));
