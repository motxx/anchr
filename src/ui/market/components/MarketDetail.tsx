import React, { useState, useCallback } from "react";
import type { Market } from "../mock-data";
import { placeBet } from "../api";
import { cn } from "../../lib/utils";

/** Demo bettor pubkey — in production this would come from a Nostr wallet */
import { getDemoPubkey } from "./Header";
const DEMO_BETTOR_PUBKEY = getDemoPubkey();

function formatSats(sats: number): string {
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(2)}M`;
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(1)}K`;
  return sats.toLocaleString();
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("ja-JP", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatTimeLeft(deadline: number): string {
  const diff = deadline - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "Ended";
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  return `${hours}h ${mins}m`;
}

interface MarketDetailProps {
  market: Market;
  onBack: () => void;
  onBetPlaced?: () => void;
}

type BetStatus = "idle" | "submitting" | "success" | "error";

export function MarketDetail({ market, onBack, onBetPlaced }: MarketDetailProps) {
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [amount, setAmount] = useState("");
  const [betStatus, setBetStatus] = useState<BetStatus>("idle");
  const [betMessage, setBetMessage] = useState<string | null>(null);

  const total = market.yes_pool_sats + market.no_pool_sats;
  const yesPercent = total > 0 ? Math.round((market.yes_pool_sats / total) * 100) : 50;
  const noPercent = 100 - yesPercent;
  const isOpen = market.status === "open";
  const isResolved = market.status.startsWith("resolved_");

  const amountNum = parseInt(amount) || 0;
  const potentialPayout = amountNum > 0
    ? side === "yes"
      ? Math.floor((amountNum / (market.yes_pool_sats + amountNum)) * (total + amountNum) * (1 - market.fee_ppm / 1_000_000))
      : Math.floor((amountNum / (market.no_pool_sats + amountNum)) * (total + amountNum) * (1 - market.fee_ppm / 1_000_000))
    : 0;

  const handlePlaceBet = useCallback(async () => {
    if (amountNum < market.min_bet_sats) return;
    if (betStatus === "submitting") return;

    setBetStatus("submitting");
    setBetMessage(null);

    try {
      const result = await placeBet(market.id, side, amountNum, DEMO_BETTOR_PUBKEY);
      const matchCount = result.matches?.length ?? 0;
      setBetStatus("success");
      setBetMessage(`Bet placed! ${amountNum} sats on ${side.toUpperCase()}${matchCount > 0 ? ` — ${matchCount} match(es)` : ""}`);
      setAmount("");
      if (onBetPlaced) onBetPlaced();
    } catch (err) {
      setBetStatus("error");
      setBetMessage(err instanceof Error ? err.message : "Network error — please try again");
    }
  }, [amountNum, market.id, market.min_bet_sats, side, betStatus, onBetPlaced]);

  const clearBetStatus = useCallback(() => {
    setBetStatus("idle");
    setBetMessage(null);
  }, []);

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        Back to Markets
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — Market info */}
        <div className="lg:col-span-2 space-y-5">
          {/* Title card */}
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider mb-3">
              <span>{market.category}</span>
              <span className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                isOpen && "bg-primary/15 text-primary",
                market.status === "resolved_yes" && "bg-yes/15 text-yes",
                market.status === "resolved_no" && "bg-no/15 text-no",
              )}>
                {isResolved ? (market.status === "resolved_yes" ? "Resolved YES" : "Resolved NO") : market.status}
              </span>
            </div>
            <h1 className="text-xl font-bold text-foreground mb-4">{market.title}</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">{market.description}</p>
          </div>

          {/* Probability */}
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-sm font-medium text-muted-foreground mb-4 uppercase tracking-wider">Probability</h2>
            <div className="flex items-end justify-between mb-3">
              <div>
                <span className="text-yes font-mono text-4xl font-bold">{yesPercent}%</span>
                <span className="text-muted-foreground text-sm ml-2">Yes</span>
              </div>
              <div className="text-right">
                <span className="text-muted-foreground text-sm mr-2">No</span>
                <span className="text-no font-mono text-4xl font-bold">{noPercent}%</span>
              </div>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden flex">
              <div className="h-full bg-yes rounded-l-full transition-all duration-500" style={{ width: `${yesPercent}%` }} />
              <div className="h-full bg-no rounded-r-full transition-all duration-500" style={{ width: `${noPercent}%` }} />
            </div>
          </div>

          {/* Market info */}
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-sm font-medium text-muted-foreground mb-4 uppercase tracking-wider">Market Details</h2>
            <div className="grid grid-cols-2 gap-4">
              <InfoRow label="Volume" value={`${formatSats(market.volume_sats)} sats`} mono />
              <InfoRow label="Bettors" value={String(market.num_bettors)} />
              <InfoRow label="YES Pool" value={`${formatSats(market.yes_pool_sats)} sats`} mono />
              <InfoRow label="NO Pool" value={`${formatSats(market.no_pool_sats)} sats`} mono />
              <InfoRow label="Min Bet" value={`${market.min_bet_sats} sats`} mono />
              <InfoRow label="Max Bet" value={market.max_bet_sats === 0 ? "No limit" : `${formatSats(market.max_bet_sats)} sats`} mono />
              <InfoRow label="Creator Fee" value={`${(market.fee_ppm / 10_000).toFixed(1)}%`} />
              <InfoRow label="Oracle Fee" value="0.5%" />
              <InfoRow label="Deadline" value={formatDate(market.resolution_deadline)} />
              <InfoRow label="Created" value={formatDate(market.created_at)} />
            </div>
          </div>

          {/* Resolution source */}
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-sm font-medium text-muted-foreground mb-4 uppercase tracking-wider">Resolution Oracle</h2>
            <div className="space-y-3">
              <div>
                <span className="text-xs text-muted-foreground block mb-1">Data Source (TLSNotary Verified)</span>
                <code className="text-xs font-mono text-primary bg-primary/10 px-2 py-1 rounded break-all">{market.resolution_url}</code>
              </div>
              {market.resolution_condition && (
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">Condition (YES if...)</span>
                  <code className="text-xs font-mono text-foreground bg-muted px-2 py-1 rounded">
                    {market.resolution_condition.jsonpath && `${market.resolution_condition.jsonpath} `}
                    {market.resolution_condition.type.replace("jsonpath_", "").replace("price_", "")}
                    {market.resolution_condition.threshold !== undefined && ` ${market.resolution_condition.threshold.toLocaleString()}`}
                    {market.resolution_condition.expected_text && ` "${market.resolution_condition.expected_text}"`}
                  </code>
                </div>
              )}
              <div>
                <span className="text-xs text-muted-foreground block mb-1">Oracle Pubkey</span>
                <code className="text-xs font-mono text-muted-foreground">{market.oracle_pubkey}</code>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block mb-1">HTLC Hash</span>
                <code className="text-xs font-mono text-muted-foreground">{market.htlc_hash}</code>
              </div>
            </div>
          </div>

          {/* Settlement info */}
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-sm font-medium text-muted-foreground mb-4 uppercase tracking-wider">Settlement</h2>
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-start gap-3">
                <span className="text-primary mt-0.5">1.</span>
                <span>Bets are locked in Cashu HTLC escrow (NUT-14) — no custodian holds your sats</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-primary mt-0.5">2.</span>
                <span>Oracle fetches resolution data via TLSNotary MPC-TLS — cryptographic proof, not trust</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-primary mt-0.5">3.</span>
                <span>If YES: Oracle reveals preimage on Nostr, winners redeem HTLC tokens from mint</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-primary mt-0.5">4.</span>
                <span>If NO: HTLC locktime expires, NO bettors claim proportional payouts</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right column — Betting panel */}
        <div className="space-y-5">
          {isOpen ? (
            <div className="rounded-xl border border-border bg-card p-6 sticky top-6">
              <h2 className="text-sm font-medium text-foreground mb-4">Place a Bet</h2>

              {/* Bet status feedback */}
              {betMessage && (
                <div
                  className={cn(
                    "rounded-lg p-3 mb-4 text-sm",
                    betStatus === "success" && "bg-yes/10 text-yes border border-yes/20",
                    betStatus === "error" && "bg-destructive/10 text-destructive border border-destructive/20",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span>{betMessage}</span>
                    <button
                      onClick={clearBetStatus}
                      className="shrink-0 text-xs opacity-60 hover:opacity-100"
                    >
                      x
                    </button>
                  </div>
                </div>
              )}

              {/* Side selector */}
              <div className="grid grid-cols-2 gap-2 mb-5">
                <button
                  onClick={() => setSide("yes")}
                  className={cn(
                    "h-12 rounded-lg font-semibold text-sm transition-all duration-200",
                    side === "yes"
                      ? "bg-yes text-yes-foreground shadow-[0_0_16px_-4px_hsl(152_60%_48%/0.4)]"
                      : "border border-border text-muted-foreground hover:border-yes/40 hover:text-yes"
                  )}
                >
                  Yes {yesPercent}%
                </button>
                <button
                  onClick={() => setSide("no")}
                  className={cn(
                    "h-12 rounded-lg font-semibold text-sm transition-all duration-200",
                    side === "no"
                      ? "bg-no text-no-foreground shadow-[0_0_16px_-4px_hsl(0_72%_56%/0.4)]"
                      : "border border-border text-muted-foreground hover:border-no/40 hover:text-no"
                  )}
                >
                  No {noPercent}%
                </button>
              </div>

              {/* Amount input */}
              <div className="mb-4">
                <label className="text-xs text-muted-foreground block mb-1.5">Amount (sats)</label>
                <div className="relative">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={`Min ${market.min_bet_sats}`}
                    min={market.min_bet_sats}
                    max={market.max_bet_sats || undefined}
                    disabled={betStatus === "submitting"}
                    className="w-full h-11 rounded-lg border border-border bg-muted px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">sats</span>
                </div>
              </div>

              {/* Quick amounts */}
              <div className="grid grid-cols-4 gap-1.5 mb-5">
                {[100, 1000, 5000, 10000].map((v) => (
                  <button
                    key={v}
                    onClick={() => setAmount(String(v))}
                    disabled={betStatus === "submitting"}
                    className="h-8 rounded-md border border-border text-xs font-mono text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    {v >= 1000 ? `${v / 1000}K` : v}
                  </button>
                ))}
              </div>

              {/* Payout estimate */}
              {amountNum > 0 && (
                <div className="rounded-lg bg-muted p-3 mb-5">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Potential payout</span>
                    <span className="font-mono text-foreground">{formatSats(potentialPayout)} sats</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Return</span>
                    <span className={cn("font-mono", potentialPayout > amountNum ? "text-yes" : "text-no")}>
                      {amountNum > 0 ? `${((potentialPayout / amountNum - 1) * 100).toFixed(0)}%` : "--"}
                    </span>
                  </div>
                </div>
              )}

              {/* Submit */}
              <button
                onClick={handlePlaceBet}
                disabled={amountNum < market.min_bet_sats || betStatus === "submitting"}
                className={cn(
                  "w-full h-12 rounded-lg font-semibold text-sm transition-all duration-200",
                  "disabled:opacity-40 disabled:cursor-not-allowed",
                  side === "yes"
                    ? "bg-yes text-yes-foreground hover:brightness-110"
                    : "bg-no text-no-foreground hover:brightness-110",
                )}
              >
                {betStatus === "submitting"
                  ? "Placing bet..."
                  : amountNum < market.min_bet_sats
                    ? `Enter amount (min ${market.min_bet_sats} sats)`
                    : `Bet ${side.toUpperCase()} -- ${formatSats(amountNum)} sats`}
              </button>

              <p className="text-[11px] text-muted-foreground text-center mt-3">
                Escrowed via Cashu HTLC. No custodian.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-sm font-medium text-foreground mb-3">Market Closed</h2>
              {isResolved && (
                <div className={cn(
                  "rounded-lg p-4 text-center",
                  market.status === "resolved_yes" ? "bg-yes/10" : "bg-no/10",
                )}>
                  <span className={cn(
                    "font-mono text-3xl font-bold",
                    market.status === "resolved_yes" ? "text-yes" : "text-no",
                  )}>
                    {market.status === "resolved_yes" ? "YES" : "NO"}
                  </span>
                  <p className="text-xs text-muted-foreground mt-2">
                    Verified by TLSNotary oracle proof
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Time remaining */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
              {isOpen ? "Time Remaining" : "Ended"}
            </div>
            <div className="font-mono text-2xl font-bold text-foreground">
              {formatTimeLeft(market.resolution_deadline)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {formatDate(market.resolution_deadline)}
            </div>
          </div>

          {/* Nostr info */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Nostr Event</div>
            <div className="space-y-2">
              <div className="text-xs">
                <span className="text-muted-foreground">Kind: </span>
                <span className="font-mono text-primary">30078</span>
              </div>
              <div className="text-xs">
                <span className="text-muted-foreground">Tag: </span>
                <span className="font-mono text-accent-foreground">anchr-prediction-market</span>
              </div>
              <div className="text-xs">
                <span className="text-muted-foreground">Relays: </span>
                <span className="text-muted-foreground">relay.damus.io, nos.lol, relay.nostr.band</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground block mb-0.5">{label}</span>
      <span className={cn("text-sm text-foreground", mono && "font-mono")}>{value}</span>
    </div>
  );
}
