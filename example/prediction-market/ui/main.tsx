import React from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary.tsx";
import { MarketApp } from "./MarketApp.tsx";

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <MarketApp />
  </ErrorBoundary>
);
