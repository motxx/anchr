import React, { useEffect, useReducer, useCallback, useRef, useState } from "react";
import { DemoColumn } from "./DemoColumn";
import { StoryView } from "./StoryView";

export interface DemoEvent {
  actor: "requester" | "worker" | "oracle" | "system";
  step: number;
  type: "step" | "ok" | "info" | "warn" | "fail";
  message: string;
  data?: Record<string, string | number>;
  timestamp: number;
}

interface State {
  events: DemoEvent[];
  connected: boolean;
  finished: boolean;
}

type Action =
  | { type: "ADD_EVENT"; event: DemoEvent }
  | { type: "CONNECTED" }
  | { type: "DISCONNECTED" }
  | { type: "RESET" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "ADD_EVENT":
      return {
        ...state,
        events: [...state.events, action.event],
        finished: action.event.type === "step" && action.event.message === "__done__",
      };
    case "CONNECTED":
      return { ...state, connected: true };
    case "DISCONNECTED":
      return { ...state, connected: false, finished: true };
    case "RESET":
      return { events: [], connected: false, finished: false };
    default:
      return state;
  }
}

const VIEW_MODES = ["story", "technical"] as const;
type ViewMode = (typeof VIEW_MODES)[number];
const VIEW_LABELS: Record<ViewMode, string> = {
  story: "Story",
  technical: "Technical",
};

const ACTORS = [
  { id: "requester" as const, label: "Requester", color: "blue", icon: "R" },
  { id: "worker" as const, label: "Worker", color: "emerald", icon: "W" },
  { id: "oracle" as const, label: "Oracle", color: "purple", icon: "O" },
];

export function DemoApp() {
  const [state, dispatch] = useReducer(reducer, { events: [], connected: false, finished: false });
  const [view, setView] = useState<ViewMode>("story");
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    dispatch({ type: "RESET" });
    const ws = new WebSocket(`ws://${location.host}/ws`);
    wsRef.current = ws;
    ws.onopen = () => dispatch({ type: "CONNECTED" });
    ws.onclose = () => dispatch({ type: "DISCONNECTED" });
    ws.onmessage = (e) => {
      const event = JSON.parse(e.data) as DemoEvent;
      dispatch({ type: "ADD_EVENT", event });
    };
  }, []);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  const controls = (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-2">
      <div className="flex rounded-md border border-border overflow-hidden text-xs">
        {VIEW_MODES.map((mode) => (
          <button
            key={mode}
            onClick={() => setView(mode)}
            className={`px-2.5 py-1 transition ${view === mode ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}
          >
            {VIEW_LABELS[mode]}
          </button>
        ))}
      </div>
      <button
        onClick={connect}
        disabled={state.connected && !state.finished}
        className="px-3 py-1.5 text-xs rounded-md bg-muted hover:bg-muted/80 disabled:opacity-40 transition border border-border"
      >
        {state.finished ? "Replay" : state.connected ? "Running..." : "Connect"}
      </button>
    </div>
  );

  if (view === "story") {
    return (
      <div className="relative">
        {controls}
        <StoryView events={state.events} finished={state.finished} />
      </div>
    );
  }

  // Technical view
  const totalSteps = 17;
  const currentStep = Math.max(
    0,
    ...state.events.filter((e) => e.type === "step" && e.message !== "__done__").map((e) => e.step),
  );
  const progress = state.finished ? 100 : Math.round((currentStep / totalSteps) * 100);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {controls}
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Anchr HTLC Demo</h1>
          <p className="text-sm text-muted-foreground">
            Live 3-Actor Flow — Requester / Worker / Oracle
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                state.connected ? "bg-emerald-400" : "bg-red-400"
              }`}
            />
            {state.connected ? "Connected" : "Disconnected"}
          </div>
        </div>
      </header>

      <div className="h-1 bg-muted">
        <div
          className="h-full bg-blue-400 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex-1 grid grid-cols-3 gap-0 divide-x divide-border overflow-hidden">
        {ACTORS.map((actor) => (
          <DemoColumn
            key={actor.id}
            actor={actor.id}
            label={actor.label}
            color={actor.color}
            icon={actor.icon}
            events={state.events.filter(
              (e) => e.actor === actor.id || e.actor === "system",
            )}
          />
        ))}
      </div>
    </div>
  );
}

