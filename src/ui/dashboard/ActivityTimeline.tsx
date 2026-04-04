import React, { useEffect, useRef } from "react";
import type { ActivityEvent } from "./useActivityTracker";

const ACTOR_LABEL: Record<string, { emoji: string; color: string }> = {
  requester: { emoji: "R", color: "bg-blue-400" },
  worker: { emoji: "W", color: "bg-emerald-400" },
  oracle: { emoji: "O", color: "bg-purple-400" },
  system: { emoji: "S", color: "bg-amber-400" },
};

const TYPE_COLOR: Record<string, string> = {
  info: "text-foreground",
  success: "text-emerald-400",
  warning: "text-amber-400",
  error: "text-red-400",
};

export function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 h-full flex flex-col">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
        Activity Timeline
      </div>
      <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 italic">
            Waiting for events... Create a query to begin.
          </p>
        ) : (
          events.map((evt, i) => {
            const actor = ACTOR_LABEL[evt.actor] ?? ACTOR_LABEL.system!;
            return (
              <div key={i} className="flex items-start gap-2">
                <span className={`${actor!.color} text-background text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5`}>
                  {actor!.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <span className={`text-xs ${TYPE_COLOR[evt.type]}`}>{evt.message}</span>
                  {evt.detail && (
                    <span className="text-[10px] text-muted-foreground ml-1.5">{evt.detail}</span>
                  )}
                </div>
                <span className="text-[9px] text-muted-foreground/50 tabular-nums shrink-0">
                  {new Date(evt.time).toLocaleTimeString()}
                </span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
