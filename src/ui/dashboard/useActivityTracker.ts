import { useEffect, useRef, useState } from "react";

export interface ActivityEvent {
  time: number;
  actor: "requester" | "worker" | "oracle" | "system";
  message: string;
  detail?: string;
  type: "info" | "success" | "warning" | "error";
}

interface QuerySummary {
  id: string;
  status: string;
  description: string;
  bounty: { amount_sats: number } | null;
}

export function useActivityTracker(queries: QuerySummary[]): ActivityEvent[] {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const prevRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const prev = prevRef.current;
    const next = new Map<string, string>();
    const newEvents: ActivityEvent[] = [];

    for (const q of queries) {
      next.set(q.id, q.status);
      const prevStatus = prev.get(q.id);

      if (!prevStatus) {
        newEvents.push({
          time: Date.now(),
          actor: "requester",
          message: `Query created: ${q.description}`,
          detail: q.bounty ? `Bounty: ${q.bounty.amount_sats} sats` : undefined,
          type: "info",
        });
      } else if (prevStatus !== q.status) {
        const transitions: Record<string, ActivityEvent> = {
          processing: {
            time: Date.now(), actor: "worker",
            message: `Worker accepted query`, type: "info",
          },
          verifying: {
            time: Date.now(), actor: "worker",
            message: `Proof submitted, verifying...`, type: "info",
          },
          approved: {
            time: Date.now(), actor: "oracle",
            message: `Verification passed`,
            detail: q.bounty ? `${q.bounty.amount_sats} sats released to worker` : undefined,
            type: "success",
          },
          rejected: {
            time: Date.now(), actor: "oracle",
            message: `Verification failed`,
            detail: q.bounty ? `${q.bounty.amount_sats} sats refunded to requester` : undefined,
            type: "error",
          },
        };
        const evt = transitions[q.status];
        if (evt) newEvents.push(evt);
      }
    }

    if (newEvents.length > 0) {
      setEvents((prev) => [...prev, ...newEvents].slice(-50));
    }
    prevRef.current = next;
  }, [queries]);

  return events;
}
