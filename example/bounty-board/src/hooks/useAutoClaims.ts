import { useMemo } from "react";
import { useQueries } from "./useQueries";
import type { QuerySummary } from "../api/types";

export interface FlightClaim {
  id: string;
  queryId: string;
  flightNumber: string;
  origin: string;
  destination: string;
  scheduledDeparture: string;
  status: "monitoring" | "verifying" | "claimed" | "rejected" | "expired";
  payoutSats: number;
  expiresAt: number;
  raw: QuerySummary;
}

// Flight route lookup for demo
const ROUTE_MAP: Record<string, { origin: string; destination: string; departure: string }> = {
  NH123: { origin: "NRT", destination: "SFO", departure: "10:00" },
  JL456: { origin: "HND", destination: "LAX", departure: "14:00" },
  NH789: { origin: "NRT", destination: "CDG", departure: "11:30" },
  JL102: { origin: "HND", destination: "JFK", departure: "18:00" },
  NH203: { origin: "KIX", destination: "SIN", departure: "09:15" },
};

function parseFlightNumber(description: string): string | null {
  // "Auto-claim: NH123 delay >= 120 min → 10000 sats"
  const match = description.match(/Auto-claim:\s*([A-Z]{2}\d{2,4})/i);
  return match ? match[1].toUpperCase() : null;
}

function mapStatus(queryStatus: string): FlightClaim["status"] {
  switch (queryStatus) {
    case "approved": return "claimed";
    case "rejected": return "rejected";
    case "expired": return "expired";
    case "submitted":
    case "verifying": return "verifying";
    default: return "monitoring";
  }
}

function toFlightClaim(q: QuerySummary): FlightClaim | null {
  if (!q.description.toLowerCase().includes("auto-claim")) return null;

  const flightNumber = parseFlightNumber(q.description) ?? "---";
  const route = ROUTE_MAP[flightNumber] ?? { origin: "???", destination: "???", departure: "--:--" };

  return {
    id: q.id,
    queryId: q.id,
    flightNumber,
    origin: route.origin,
    destination: route.destination,
    scheduledDeparture: route.departure,
    status: mapStatus(q.status),
    payoutSats: q.bounty?.amount_sats ?? 0,
    expiresAt: q.expires_at,
    raw: q,
  };
}

// 1 sat ≈ ¥0.1 (rough estimate for demo display)
const SAT_TO_JPY = 0.1;

export function useAutoClaims() {
  const { data: queries, isLoading, error, refetch } = useQueries();

  return useMemo(() => {
    const all = (queries ?? [])
      .map(toFlightClaim)
      .filter((c): c is FlightClaim => c !== null);

    // Deduplicate by flight number — keep newest per flight
    const byFlight = new Map<string, FlightClaim>();
    for (const c of all) {
      const existing = byFlight.get(c.flightNumber);
      if (!existing || c.expiresAt > existing.expiresAt) {
        byFlight.set(c.flightNumber, c);
      }
    }
    const unique = [...byFlight.values()];

    const monitoring = unique.filter((c) => c.status === "monitoring" || c.status === "verifying");
    const claimed = unique.filter((c) => c.status === "claimed");
    const finished = unique.filter((c) => c.status === "expired" || c.status === "rejected");

    monitoring.sort((a, b) => a.expiresAt - b.expiresAt);
    claimed.sort((a, b) => b.expiresAt - a.expiresAt);

    const totalRecoveredSats = claimed.reduce((sum, c) => sum + c.payoutSats, 0);
    const totalRecoveredJpy = Math.round(totalRecoveredSats * SAT_TO_JPY);

    return {
      monitoring,
      claimed,
      finished,
      totalRecoveredSats,
      totalRecoveredJpy,
      claimCount: claimed.length,
      isLoading,
      error,
      refetch,
    };
  }, [queries, isLoading, error, refetch]);
}
