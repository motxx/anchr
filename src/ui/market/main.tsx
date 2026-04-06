import React from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { MarketApp } from "./MarketApp";

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <MarketApp />
  </ErrorBoundary>
);
