import { Platform } from "react-native";

export interface SecureStoreProvider {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

function createNativeProvider(): SecureStoreProvider {
  return {
    async getItem(key) {
      const SecureStore = await import("expo-secure-store");
      return SecureStore.getItemAsync(key);
    },
    async setItem(key, value) {
      const SecureStore = await import("expo-secure-store");
      await SecureStore.setItemAsync(key, value);
    },
    async deleteItem(key) {
      const SecureStore = await import("expo-secure-store");
      await SecureStore.deleteItemAsync(key);
    },
  };
}

function createWebProvider(): SecureStoreProvider {
  return {
    async getItem(key) {
      return localStorage.getItem(key);
    },
    async setItem(key, value) {
      localStorage.setItem(key, value);
    },
    async deleteItem(key) {
      localStorage.removeItem(key);
    },
  };
}

export function createSecureStoreProvider(): SecureStoreProvider {
  return Platform.OS === "web" ? createWebProvider() : createNativeProvider();
}

export const secureStoreProvider = createSecureStoreProvider();
