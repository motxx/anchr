import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface SettingsState {
  serverUrl: string;
  apiKey: string;
  setServerUrl: (url: string) => void;
  setApiKey: (key: string) => void;
  load: () => Promise<void>;
}

const STORAGE_KEY_SERVER_URL = "anchr_server_url";
const STORAGE_KEY_API_KEY = "anchr_api_key";

const DEFAULT_SERVER_URL = __DEV__ ? "http://localhost:3000" : "https://anchr-app.fly.dev";

export const useSettingsStore = create<SettingsState>((set) => ({
  serverUrl: DEFAULT_SERVER_URL,
  apiKey: "",

  setServerUrl: (url: string) => {
    const trimmed = url.replace(/\/+$/, "");
    set({ serverUrl: trimmed });
    AsyncStorage.setItem(STORAGE_KEY_SERVER_URL, trimmed);
  },

  setApiKey: (key: string) => {
    set({ apiKey: key });
    AsyncStorage.setItem(STORAGE_KEY_API_KEY, key);
  },

  load: async () => {
    try {
      const [url, key] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY_SERVER_URL),
        AsyncStorage.getItem(STORAGE_KEY_API_KEY),
      ]);
      const resolvedUrl = url || DEFAULT_SERVER_URL;
      console.log(`[anchr-settings] load: stored="${url}", using="${resolvedUrl}"`);
      set({
        serverUrl: resolvedUrl,
        apiKey: key || "",
      });
    } catch (e) {
      console.error(`[anchr-settings] load error:`, e);
    }
  },
}));
