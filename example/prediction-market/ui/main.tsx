import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { MarketApp } from "./MarketApp.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Markets / wallet config update slowly compared to UI interaction.
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <MarketApp />
    </QueryClientProvider>
  </ErrorBoundary>,
);
