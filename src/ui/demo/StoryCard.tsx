import React, { useState } from "react";

type Actor = "requester" | "worker" | "oracle" | "system";

export interface StoryStepDef {
  step: number;
  phase: string;
  phaseColor: string;
  icon: string;
  actor: Actor;
  target?: Actor;
  title: string;
  desc: string;
}

const ACTOR_INFO: Record<Actor, { label: string; emoji: string; color: string }> = {
  requester: { label: "\u4F9D\u983C\u8005", emoji: "\uD83D\uDC64", color: "blue" },
  worker: { label: "\u30EF\u30FC\u30AB\u30FC", emoji: "\uD83D\uDCF7", color: "emerald" },
  oracle: { label: "\u5BE9\u5224", emoji: "\u2696\uFE0F", color: "purple" },
  system: { label: "\u30B7\u30B9\u30C6\u30E0", emoji: "\u26A1", color: "muted" },
};

function FlowIndicator({ actor, target }: { actor: Actor; target?: Actor }) {
  if (!target || actor === "system") return null;
  const from = ACTOR_INFO[actor];
  const to = ACTOR_INFO[target];
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-2">
      <span>{from.emoji} {from.label}</span>
      <span className="text-muted-foreground/50">{"\u2192"}</span>
      <span>{to.emoji} {to.label}</span>
    </div>
  );
}

export function StoryCard({ def, active, completed }: { def: StoryStepDef; active: boolean; completed: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const actorInfo = ACTOR_INFO[def.actor];

  const bgColor: Record<string, string> = {
    blue: "border-blue-400/20 bg-blue-950/20",
    emerald: "border-emerald-400/20 bg-emerald-950/20",
    purple: "border-purple-400/20 bg-purple-950/20",
    muted: "border-border bg-muted/10",
  };

  const activeBg: Record<string, string> = {
    blue: "border-blue-400/50 bg-blue-950/40 shadow-lg shadow-blue-400/5",
    emerald: "border-emerald-400/50 bg-emerald-950/40 shadow-lg shadow-emerald-400/5",
    purple: "border-purple-400/50 bg-purple-950/40 shadow-lg shadow-purple-400/5",
    muted: "border-border bg-muted/20",
  };

  return (
    <div
      className={`
        relative rounded-xl border p-4 transition-all duration-500 cursor-pointer
        ${active ? activeBg[actorInfo.color] ?? "" : completed ? `${bgColor[actorInfo.color] ?? ""} opacity-70` : "border-border/30 bg-card/30 opacity-30"}
        ${active ? "animate-slide-in scale-[1.01]" : ""}
      `}
      onClick={() => setExpanded((e) => !e)}
    >
      <StoryCardHeader def={def} active={active} completed={completed} />
      <StoryCardBody def={def} active={active} expanded={expanded} />
    </div>
  );
}

function StoryCardHeader({ def, active, completed }: { def: StoryStepDef; active: boolean; completed: boolean }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <span className={`text-[10px] uppercase tracking-widest font-semibold ${def.phaseColor}`}>
        {def.phase}
      </span>
      <span className="text-[10px] text-muted-foreground/50">Step {def.step}</span>
      {active && (
        <span className="ml-auto w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
      )}
      {completed && !active && (
        <span className="ml-auto text-[10px] text-emerald-400">{"\u2713"}</span>
      )}
    </div>
  );
}

function StoryCardBody({ def, active, expanded }: { def: StoryStepDef; active: boolean; expanded: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-2xl leading-none mt-0.5 shrink-0">{def.icon}</span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-foreground leading-snug">
          {def.title}
        </h3>
        {(active || expanded) && (
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            {def.desc}
          </p>
        )}
        <FlowIndicator actor={def.actor} target={def.target} />
      </div>
    </div>
  );
}
