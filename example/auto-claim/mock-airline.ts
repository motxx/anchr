/**
 * Auto-Claim Demo — Mock Airline API
 *
 * Serves flight status JSON that transitions from "on_time" to "delayed"
 * after DELAY_AFTER_SECONDS to simulate a real delay event.
 *
 * Usage:
 *   deno run --allow-all --env example/auto-claim/mock-airline.ts
 *
 * Endpoints:
 *   GET /api/flights/NH123  — returns flight status JSON
 *   GET /api/flights/JL456  — second flight (always on time)
 */

const PORT = Number(Deno.env.get("MOCK_PORT") ?? "4000");
const DELAY_AFTER_SECONDS = Number(Deno.env.get("DELAY_AFTER_SECONDS") ?? "20");

const startTime = Date.now();

const flights: Record<string, {
  flight: string;
  origin: string;
  destination: string;
  scheduled_departure: string;
  simulateDelay: boolean;
}> = {
  NH123: {
    flight: "NH123",
    origin: "NRT",
    destination: "SFO",
    scheduled_departure: "2026-04-05T10:00:00Z",
    simulateDelay: true,
  },
  JL456: {
    flight: "JL456",
    origin: "HND",
    destination: "LAX",
    scheduled_departure: "2026-04-05T14:00:00Z",
    simulateDelay: false,
  },
};

console.log("=== Mock Airline API ===\n");
console.log(`Port:    ${PORT}`);
console.log(`Flights: ${Object.keys(flights).join(", ")}`);
console.log(`NH123 will switch to "delayed" in ${DELAY_AFTER_SECONDS}s\n`);

Deno.serve({ port: PORT }, (req) => {
  const url = new URL(req.url);
  const match = url.pathname.match(/^\/api\/flights\/(\w+)$/);

  if (!match) {
    return Response.json({ error: "Not found. Try /api/flights/NH123" }, { status: 404 });
  }

  const base = flights[match[1]];
  if (!base) {
    return Response.json({ error: `Flight ${match[1]} not found` }, { status: 404 });
  }

  const elapsed = (Date.now() - startTime) / 1000;
  const isDelayed = base.simulateDelay && elapsed >= DELAY_AFTER_SECONDS;

  if (isDelayed) {
    return Response.json({
      flight: base.flight,
      origin: base.origin,
      destination: base.destination,
      scheduled_departure: base.scheduled_departure,
      status: "delayed",
      delay_minutes: 185,
      actual_departure: "2026-04-05T13:05:00Z",
      message: "Delayed due to mechanical issues. We apologize for the inconvenience.",
    });
  }

  return Response.json({
    flight: base.flight,
    origin: base.origin,
    destination: base.destination,
    scheduled_departure: base.scheduled_departure,
    status: "on_time",
    delay_minutes: 0,
    actual_departure: null,
    message: "Flight is on schedule.",
  });
});
