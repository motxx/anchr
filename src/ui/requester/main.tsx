import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { RequesterApp } from "./RequesterApp";

const qc = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <QueryClientProvider client={qc}>
      <RequesterApp />
    </QueryClientProvider>
  </ErrorBoundary>
);
