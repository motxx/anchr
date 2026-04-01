import "react-native-get-random-values";
import { Buffer } from "buffer";
globalThis.Buffer = Buffer as unknown as typeof globalThis.Buffer;

import React, { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "../src/components/ErrorBoundary";
import { useSettingsStore } from "../src/store/settings";
import { useWalletStore } from "../src/store/wallet";
import { useAuthStore } from "../src/store/auth";
import "../global.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 3000,
    },
  },
});

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([
      useSettingsStore.getState().load(),
      useWalletStore.getState().load(),
      useAuthStore.getState().load(),
    ]).then(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#09090b" }}>
        <ActivityIndicator size="large" color="#10b981" />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "#09090b" },
          }}
        >
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="bounty/[id]"
            options={{ presentation: "card" }}
          />
          <Stack.Screen
            name="user/[npub]"
            options={{ presentation: "card" }}
          />
        </Stack>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
