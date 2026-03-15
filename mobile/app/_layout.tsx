import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSettingsStore } from "../src/store/settings";
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
  useEffect(() => {
    useSettingsStore.getState().load();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#f5f5f4" },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="query/[id]"
          options={{
            headerShown: true,
            headerTitle: "Query",
            headerBackTitle: "Back",
            headerTintColor: "#1c1917",
            headerStyle: { backgroundColor: "#f5f5f4" },
            presentation: "card",
          }}
        />
      </Stack>
    </QueryClientProvider>
  );
}
