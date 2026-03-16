import React, { useEffect, useRef, useState } from "react";
import type { DemoEvent } from "./DemoApp";

// --- Story step definitions ---

type Actor = "requester" | "worker" | "oracle" | "system";

interface StoryStepDef {
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
  requester: { label: "依頼者", emoji: "\uD83D\uDC64", color: "blue" },
  worker: { label: "ワーカー", emoji: "\uD83D\uDCF7", color: "emerald" },
  oracle: { label: "審判", emoji: "\u2696\uFE0F", color: "purple" },
  system: { label: "システム", emoji: "\u26A1", color: "muted" },
};

const STEPS: StoryStepDef[] = [
  {
    step: 1, phase: "準備", phaseColor: "text-muted-foreground",
    icon: "\u26A1", actor: "system", title: "接続確認",
    desc: "Nostrリレー・Blossom・Cashu Mintへの接続を確認",
  },
  {
    step: 2, phase: "準備", phaseColor: "text-muted-foreground",
    icon: "\uD83D\uDC65", actor: "system", title: "参加者の登場",
    desc: "依頼者・ワーカー・審判がそれぞれ暗号鍵ペアを生成",
  },
  {
    step: 3, phase: "依頼", phaseColor: "text-purple-400",
    icon: "\uD83D\uDD10", actor: "oracle", target: "requester",
    title: "審判が「金庫の番号」を共有",
    desc: "審判が秘密の合鍵(プリイメージ)を生成し、そのハッシュを依頼者に渡す。このハッシュが報酬ロックの鍵穴になる",
  },
  {
    step: 4, phase: "依頼", phaseColor: "text-blue-400",
    icon: "\uD83D\uDCB0", actor: "requester",
    title: "報酬を準備 (21 sats)",
    desc: "依頼者がCashu Mintからecashトークンを発行。まだ誰にも渡さず手元に持つ",
  },
  {
    step: 5, phase: "依頼", phaseColor: "text-blue-400",
    icon: "\uD83D\uDCCB", actor: "requester",
    title: "リクエストを掲示板に投稿",
    desc: "「渋谷スクランブル交差点の写真が欲しい」というリクエストをNostr掲示板に公開投稿",
  },
  {
    step: 6, phase: "マッチング", phaseColor: "text-emerald-400",
    icon: "\uD83D\uDD0D", actor: "worker",
    title: "リクエストを発見",
    desc: "ワーカーが掲示板でリクエストを見つけ、指定された審判が信頼できるか確認",
  },
  {
    step: 7, phase: "マッチング", phaseColor: "text-emerald-400",
    icon: "\uD83D\uDE4B", actor: "worker", target: "requester",
    title: "「21 satsでやります」",
    desc: "ワーカーが依頼者に暗号化メッセージで見積もりを送信",
  },
  {
    step: 8, phase: "マッチング", phaseColor: "text-blue-400",
    icon: "\uD83D\uDC40", actor: "requester",
    title: "見積もりを確認",
    desc: "依頼者がワーカーの見積もりを復号して確認",
  },
  {
    step: 9, phase: "エスクロー", phaseColor: "text-amber-400",
    icon: "\uD83D\uDD12", actor: "requester",
    title: "報酬をエスクロー(金庫)にロック",
    desc: "報酬トークンにHTLC条件を追加: ワーカーが「合鍵」を持っていないと引き出せない。期限切れなら依頼者に返金",
  },
  {
    step: 10, phase: "エスクロー", phaseColor: "text-blue-400",
    icon: "\uD83E\uDD1D", actor: "requester", target: "worker",
    title: "ワーカーを選定・金庫の鍵を渡す",
    desc: "依頼者がワーカーを正式に選び、ロック済みトークンを暗号化メッセージで送付",
  },
  {
    step: 11, phase: "エスクロー", phaseColor: "text-emerald-400",
    icon: "\u2705", actor: "worker",
    title: "選定を確認",
    desc: "ワーカーが選定通知を復号し、自分の公開鍵が含まれていることを確認",
  },
  {
    step: 12, phase: "納品", phaseColor: "text-emerald-400",
    icon: "\uD83D\uDCF7", actor: "worker", target: "requester",
    title: "撮影 → 暗号化 → 提出",
    desc: "ワーカーが写真を撮影、AES-256-GCMで暗号化してBlossomにアップロード。復号鍵は依頼者用(K_R)と審判用(K_O)に分けてNIP-44で暗号化",
  },
  {
    step: 13, phase: "納品", phaseColor: "text-emerald-400",
    icon: "\uD83D\uDCE4", actor: "worker",
    title: "成果物をNostrに公開",
    desc: "暗号化された写真のリンクと復号鍵をNostrイベント(kind 6300)として公開",
  },
  {
    step: 14, phase: "納品", phaseColor: "text-blue-400",
    icon: "\uD83D\uDC41\uFE0F", actor: "requester",
    title: "成果物を受信・復号",
    desc: "依頼者がイベントを復号し、K_Rを使って写真にアクセス",
  },
  {
    step: 15, phase: "決済", phaseColor: "text-purple-400",
    icon: "\u2696\uFE0F", actor: "oracle", target: "worker",
    title: "検証OK → 合鍵をワーカーに送信",
    desc: "審判がK_Oで写真を復号・C2PA検証し、問題なければ秘密の合鍵(プリイメージ)をNIP-44 DMでワーカーに送信",
  },
  {
    step: 16, phase: "決済", phaseColor: "text-emerald-400",
    icon: "\uD83D\uDD11", actor: "worker",
    title: "合鍵を受信・検証",
    desc: "ワーカーが合鍵を受信し、hash(合鍵) が元のハッシュと一致することを確認",
  },
  {
    step: 17, phase: "決済", phaseColor: "text-amber-400",
    icon: "\uD83D\uDCB0", actor: "worker",
    title: "金庫を開けて報酬GET!",
    desc: "ワーカーが合鍵 + 自分の秘密鍵でHTLCトークンをMintに提示し、新しいecashトークンと交換",
  },
];

// --- Component ---

interface Props {
  events: DemoEvent[];
  finished: boolean;
}

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

function StoryCard({ def, active, completed }: { def: StoryStepDef; active: boolean; completed: boolean }) {
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
      {/* Phase + Step */}
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

      {/* Title with icon */}
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

  // Actor status
  const actorStatus = (actor: Actor): "idle" | "active" | "done" => {
    if (finished) return "done";
    const activeStep = STEPS.find((s) => s.step === currentStep);
    if (activeStep?.actor === actor) return "active";
    return "idle";
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border px-6 py-5">
        <h1 className="text-xl font-bold tracking-tight">Anchr HTLC Demo</h1>
        <p className="text-sm text-muted-foreground mt-1">
          写真撮影依頼から報酬の自動決済までの流れ
        </p>
      </header>

      {/* Actor bar */}
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
                  {status === "active" ? "実行中..." : status === "done" ? "完了" : "待機中"}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Progress */}
      <div className="h-1 bg-muted">
        <div
          className="h-full bg-blue-400 transition-all duration-700"
          style={{ width: `${finished ? 100 : Math.round((currentStep / 17) * 100)}%` }}
        />
      </div>

      {/* Timeline */}
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

        {/* Done card */}
        {finished && (
          <div className="rounded-xl border border-emerald-400/30 bg-emerald-950/20 p-6 text-center animate-slide-in">
            <span className="text-4xl">{"\uD83C\uDF89"}</span>
            <h3 className="text-lg font-bold text-emerald-400 mt-3">完了!</h3>
            <p className="text-sm text-muted-foreground mt-1">
              全てのステップが正常に完了しました。ワーカーは合鍵でエスクローを解除し、報酬を受け取りました。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
