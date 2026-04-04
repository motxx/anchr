import React, { useEffect, useRef } from "react";
import type { DemoEvent } from "./DemoApp";
import { StoryCard } from "./StoryCard";
import type { StoryStepDef } from "./StoryCard";

type Actor = "requester" | "worker" | "oracle" | "system";

const ACTOR_INFO: Record<Actor, { label: string; emoji: string; color: string }> = {
  requester: { label: "\u4F9D\u983C\u8005", emoji: "\uD83D\uDC64", color: "blue" },
  worker: { label: "\u30EF\u30FC\u30AB\u30FC", emoji: "\uD83D\uDCF7", color: "emerald" },
  oracle: { label: "\u5BE9\u5224", emoji: "\u2696\uFE0F", color: "purple" },
  system: { label: "\u30B7\u30B9\u30C6\u30E0", emoji: "\u26A1", color: "muted" },
};

const STEPS: StoryStepDef[] = [
  { step: 1, phase: "\u6E96\u5099", phaseColor: "text-muted-foreground", icon: "\u26A1", actor: "system", title: "\u63A5\u7D9A\u78BA\u8A8D", desc: "Nostr\u30EA\u30EC\u30FC\u30FBBlossom\u30FBCashu Mint\u3078\u306E\u63A5\u7D9A\u3092\u78BA\u8A8D" },
  { step: 2, phase: "\u6E96\u5099", phaseColor: "text-muted-foreground", icon: "\uD83D\uDC65", actor: "system", title: "\u53C2\u52A0\u8005\u306E\u767B\u5834", desc: "\u4F9D\u983C\u8005\u30FB\u30EF\u30FC\u30AB\u30FC\u30FB\u5BE9\u5224\u304C\u305D\u308C\u305E\u308C\u6697\u53F7\u9375\u30DA\u30A2\u3092\u751F\u6210" },
  { step: 3, phase: "\u4F9D\u983C", phaseColor: "text-purple-400", icon: "\uD83D\uDD10", actor: "oracle", target: "requester", title: "\u5BE9\u5224\u304C\u300C\u91D1\u5EAB\u306E\u756A\u53F7\u300D\u3092\u5171\u6709", desc: "\u5BE9\u5224\u304C\u79D8\u5BC6\u306E\u5408\u9375\uFF08\u30D7\u30EA\u30A4\u30E1\u30FC\u30B8\uFF09\u3092\u751F\u6210\u3057\u3001\u305D\u306E\u30CF\u30C3\u30B7\u30E5\u3092\u4F9D\u983C\u8005\u306B\u6E21\u3059\u3002\u3053\u306E\u30CF\u30C3\u30B7\u30E5\u304C\u5831\u916C\u30ED\u30C3\u30AF\u306E\u9375\u7A74\u306B\u306A\u308B" },
  { step: 4, phase: "\u4F9D\u983C", phaseColor: "text-blue-400", icon: "\uD83D\uDCB0", actor: "requester", title: "\u5831\u916C\u3092\u6E96\u5099 (21 sats)", desc: "\u4F9D\u983C\u8005\u304CCashu Mint\u304B\u3089ecash\u30C8\u30FC\u30AF\u30F3\u3092\u767A\u884C\u3002\u307E\u3060\u8AB0\u306B\u3082\u6E21\u3055\u305A\u624B\u5143\u306B\u6301\u3064" },
  { step: 5, phase: "\u4F9D\u983C", phaseColor: "text-blue-400", icon: "\uD83D\uDCCB", actor: "requester", title: "\u30EA\u30AF\u30A8\u30B9\u30C8\u3092\u63B2\u793A\u677F\u306B\u6295\u7A3F", desc: "\u300C\u6E0B\u8C37\u30B9\u30AF\u30E9\u30F3\u30D6\u30EB\u4EA4\u5DEE\u70B9\u306E\u5199\u771F\u304C\u6B32\u3057\u3044\u300D\u3068\u3044\u3046\u30EA\u30AF\u30A8\u30B9\u30C8\u3092Nostr\u63B2\u793A\u677F\u306B\u516C\u958B\u6295\u7A3F" },
  { step: 6, phase: "\u30DE\u30C3\u30C1\u30F3\u30B0", phaseColor: "text-emerald-400", icon: "\uD83D\uDD0D", actor: "worker", title: "\u30EA\u30AF\u30A8\u30B9\u30C8\u3092\u767A\u898B", desc: "\u30EF\u30FC\u30AB\u30FC\u304C\u63B2\u793A\u677F\u3067\u30EA\u30AF\u30A8\u30B9\u30C8\u3092\u898B\u3064\u3051\u3001\u6307\u5B9A\u3055\u308C\u305F\u5BE9\u5224\u304C\u4FE1\u983C\u3067\u304D\u308B\u304B\u78BA\u8A8D" },
  { step: 7, phase: "\u30DE\u30C3\u30C1\u30F3\u30B0", phaseColor: "text-emerald-400", icon: "\uD83D\uDE4B", actor: "worker", target: "requester", title: "\u300C21 sats\u3067\u3084\u308A\u307E\u3059\u300D", desc: "\u30EF\u30FC\u30AB\u30FC\u304C\u4F9D\u983C\u8005\u306B\u6697\u53F7\u5316\u30E1\u30C3\u30BB\u30FC\u30B8\u3067\u898B\u7A4D\u3082\u308A\u3092\u9001\u4FE1" },
  { step: 8, phase: "\u30DE\u30C3\u30C1\u30F3\u30B0", phaseColor: "text-blue-400", icon: "\uD83D\uDC40", actor: "requester", title: "\u898B\u7A4D\u3082\u308A\u3092\u78BA\u8A8D", desc: "\u4F9D\u983C\u8005\u304C\u30EF\u30FC\u30AB\u30FC\u306E\u898B\u7A4D\u3082\u308A\u3092\u5FA9\u53F7\u3057\u3066\u78BA\u8A8D" },
  { step: 9, phase: "\u30A8\u30B9\u30AF\u30ED\u30FC", phaseColor: "text-amber-400", icon: "\uD83D\uDD12", actor: "requester", title: "\u5831\u916C\u3092\u30A8\u30B9\u30AF\u30ED\u30FC\uFF08\u91D1\u5EAB\uFF09\u306B\u30ED\u30C3\u30AF", desc: "\u5831\u916C\u30C8\u30FC\u30AF\u30F3\u306BHTLC\u6761\u4EF6\u3092\u8FFD\u52A0: \u30EF\u30FC\u30AB\u30FC\u304C\u300C\u5408\u9375\u300D\u3092\u6301\u3063\u3066\u3044\u306A\u3044\u3068\u5F15\u304D\u51FA\u305B\u306A\u3044\u3002\u671F\u9650\u5207\u308C\u306A\u3089\u4F9D\u983C\u8005\u306B\u8FD4\u91D1" },
  { step: 10, phase: "\u30A8\u30B9\u30AF\u30ED\u30FC", phaseColor: "text-blue-400", icon: "\uD83E\uDD1D", actor: "requester", target: "worker", title: "\u30EF\u30FC\u30AB\u30FC\u3092\u9078\u5B9A\u30FB\u91D1\u5EAB\u306E\u9375\u3092\u6E21\u3059", desc: "\u4F9D\u983C\u8005\u304C\u30EF\u30FC\u30AB\u30FC\u3092\u6B63\u5F0F\u306B\u9078\u3073\u3001\u30ED\u30C3\u30AF\u6E08\u307F\u30C8\u30FC\u30AF\u30F3\u3092\u6697\u53F7\u5316\u30E1\u30C3\u30BB\u30FC\u30B8\u3067\u9001\u4ED8" },
  { step: 11, phase: "\u30A8\u30B9\u30AF\u30ED\u30FC", phaseColor: "text-emerald-400", icon: "\u2705", actor: "worker", title: "\u9078\u5B9A\u3092\u78BA\u8A8D", desc: "\u30EF\u30FC\u30AB\u30FC\u304C\u9078\u5B9A\u901A\u77E5\u3092\u5FA9\u53F7\u3057\u3001\u81EA\u5206\u306E\u516C\u958B\u9375\u304C\u542B\u307E\u308C\u3066\u3044\u308B\u3053\u3068\u3092\u78BA\u8A8D" },
  { step: 12, phase: "\u7D0D\u54C1", phaseColor: "text-emerald-400", icon: "\uD83D\uDCF7", actor: "worker", target: "requester", title: "\u64AE\u5F71 \u2192 \u6697\u53F7\u5316 \u2192 \u63D0\u51FA", desc: "\u30EF\u30FC\u30AB\u30FC\u304C\u5199\u771F\u3092\u64AE\u5F71\u3001AES-256-GCM\u3067\u6697\u53F7\u5316\u3057\u3066Blossom\u306B\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u3002\u5FA9\u53F7\u9375\u306F\u4F9D\u983C\u8005\u7528(K_R)\u3068\u5BE9\u5224\u7528(K_O)\u306B\u5206\u3051\u3066NIP-44\u3067\u6697\u53F7\u5316" },
  { step: 13, phase: "\u7D0D\u54C1", phaseColor: "text-emerald-400", icon: "\uD83D\uDCE4", actor: "worker", title: "\u6210\u679C\u7269\u3092Nostr\u306B\u516C\u958B", desc: "\u6697\u53F7\u5316\u3055\u308C\u305F\u5199\u771F\u306E\u30EA\u30F3\u30AF\u3068\u5FA9\u53F7\u9375\u3092Nostr\u30A4\u30D9\u30F3\u30C8(kind 6300)\u3068\u3057\u3066\u516C\u958B" },
  { step: 14, phase: "\u7D0D\u54C1", phaseColor: "text-blue-400", icon: "\uD83D\uDC41\uFE0F", actor: "requester", title: "\u6210\u679C\u7269\u3092\u53D7\u4FE1\u30FB\u5FA9\u53F7", desc: "\u4F9D\u983C\u8005\u304C\u30A4\u30D9\u30F3\u30C8\u3092\u5FA9\u53F7\u3057\u3001K_R\u3092\u4F7F\u3063\u3066\u5199\u771F\u306B\u30A2\u30AF\u30BB\u30B9" },
  { step: 15, phase: "\u6C7A\u6E08", phaseColor: "text-purple-400", icon: "\u2696\uFE0F", actor: "oracle", target: "worker", title: "\u691C\u8A3COK \u2192 \u5408\u9375\u3092\u30EF\u30FC\u30AB\u30FC\u306B\u9001\u4FE1", desc: "\u5BE9\u5224\u304CK_O\u3067\u5199\u771F\u3092\u5FA9\u53F7\u30FBC2PA\u691C\u8A3C\u3057\u3001\u554F\u984C\u306A\u3051\u308C\u3070\u79D8\u5BC6\u306E\u5408\u9375\uFF08\u30D7\u30EA\u30A4\u30E1\u30FC\u30B8\uFF09\u3092NIP-44 DM\u3067\u30EF\u30FC\u30AB\u30FC\u306B\u9001\u4FE1" },
  { step: 16, phase: "\u6C7A\u6E08", phaseColor: "text-emerald-400", icon: "\uD83D\uDD11", actor: "worker", title: "\u5408\u9375\u3092\u53D7\u4FE1\u30FB\u691C\u8A3C", desc: "\u30EF\u30FC\u30AB\u30FC\u304C\u5408\u9375\u3092\u53D7\u4FE1\u3057\u3001hash(\u5408\u9375) \u304C\u5143\u306E\u30CF\u30C3\u30B7\u30E5\u3068\u4E00\u81F4\u3059\u308B\u3053\u3068\u3092\u78BA\u8A8D" },
  { step: 17, phase: "\u6C7A\u6E08", phaseColor: "text-amber-400", icon: "\uD83D\uDCB0", actor: "worker", title: "\u91D1\u5EAB\u3092\u958B\u3051\u3066\u5831\u916CGET!", desc: "\u30EF\u30FC\u30AB\u30FC\u304C\u5408\u9375 + \u81EA\u5206\u306E\u79D8\u5BC6\u9375\u3067HTLC\u30C8\u30FC\u30AF\u30F3\u3092Mint\u306B\u63D0\u793A\u3057\u3001\u65B0\u3057\u3044ecash\u30C8\u30FC\u30AF\u30F3\u3068\u4EA4\u63DB" },
];

interface Props {
  events: DemoEvent[];
  finished: boolean;
}

function ActorBar({ currentStep, finished }: { currentStep: number; finished: boolean }) {
  function actorStatus(actor: Actor): "idle" | "active" | "done" {
    if (finished) return "done";
    const activeStep = STEPS.find((s) => s.step === currentStep);
    if (activeStep?.actor === actor) return "active";
    return "idle";
  }

  return (
    <div className="border-b border-border px-6 py-4 flex items-center justify-center gap-8">
      {(["requester", "worker", "oracle"] as const).map((id) => {
        const info = ACTOR_INFO[id];
        const status = actorStatus(id);
        return (
          <div key={id} className="flex items-center gap-2.5">
            <div className={`
              w-10 h-10 rounded-full flex items-center justify-center text-lg
              transition-all duration-300
              ${status === "active" ? "ring-2 ring-offset-2 ring-offset-background scale-110" : ""}
              ${id === "requester" ? "bg-blue-950 ring-blue-400" : ""}
              ${id === "worker" ? "bg-emerald-950 ring-emerald-400" : ""}
              ${id === "oracle" ? "bg-purple-950 ring-purple-400" : ""}
            `}>
              {info.emoji}
            </div>
            <div>
              <div className="text-sm font-medium">{info.label}</div>
              <div className={`text-[10px] ${status === "active" ? "text-emerald-400" : "text-muted-foreground"}`}>
                {status === "active" ? "\u5B9F\u884C\u4E2D..." : status === "done" ? "\u5B8C\u4E86" : "\u5F85\u6A5F\u4E2D"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function StoryView({ events, finished }: Props) {
  const currentStep = Math.max(
    0,
    ...events.filter((e) => e.type === "step" && e.message !== "__done__").map((e) => e.step),
  );

  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [currentStep]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border px-6 py-5">
        <h1 className="text-xl font-bold tracking-tight">Anchr HTLC Demo</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {"\u5199\u771F\u64AE\u5F71\u4F9D\u983C\u304B\u3089\u5831\u916C\u306E\u81EA\u52D5\u6C7A\u6E08\u307E\u3067\u306E\u6D41\u308C"}
        </p>
      </header>

      <ActorBar currentStep={currentStep} finished={finished} />

      <div className="h-1 bg-muted">
        <div
          className="h-full bg-blue-400 transition-all duration-700"
          style={{ width: `${finished ? 100 : Math.round((currentStep / 17) * 100)}%` }}
        />
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-3">
        {STEPS.map((def) => {
          const isActive = def.step === currentStep && !finished;
          const isCompleted = def.step < currentStep || finished;
          return (
            <div key={def.step} ref={isActive ? activeRef : undefined}>
              <StoryCard def={def} active={isActive} completed={isCompleted} />
            </div>
          );
        })}

        {finished && (
          <div className="rounded-xl border border-emerald-400/30 bg-emerald-950/20 p-6 text-center animate-slide-in">
            <span className="text-4xl">{"\uD83C\uDF89"}</span>
            <h3 className="text-lg font-bold text-emerald-400 mt-3">{"\u5B8C\u4E86!"}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {"\u5168\u3066\u306E\u30B9\u30C6\u30C3\u30D7\u304C\u6B63\u5E38\u306B\u5B8C\u4E86\u3057\u307E\u3057\u305F\u3002\u30EF\u30FC\u30AB\u30FC\u306F\u5408\u9375\u3067\u30A8\u30B9\u30AF\u30ED\u30FC\u3092\u89E3\u9664\u3057\u3001\u5831\u916C\u3092\u53D7\u3051\u53D6\u308A\u307E\u3057\u305F\u3002"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
