import React, { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Market } from "../mock-data.ts";
import {
  placeBet,
  redeemWinnings,
  submitToken,
  fetchWalletConfig,
  type BetResult,
  type MatchInfo,
} from "../api.ts";
import { cn } from "../lib/utils.ts";
import { getUserPubkey } from "../keypair.ts";
import {
  initWallet,
  lockFundsForMatch,
  saveHeldToken,
  loadHeldTokensForMarket,
} from "../wallet.ts";
import {
  generateHistory,
  generateActivity,
  generateHolders,
  volume24h,
} from "../lib/market-history.ts";
import { PriceChart } from "./PriceChart.tsx";
import { ActivityFeed } from "./ActivityFeed.tsx";
import { TopHolders } from "./TopHolders.tsx";

function formatSats(sats: number): string {
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(2)}M`;
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(1)}K`;
  return sats.toLocaleString();
}

function formatTimeLeft(deadline: number): string {
  const diff = deadline - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "Ended";
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${mins}m`;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface MarketDetailProps {
  market: Market;
  onBack: () => void;
  onBetPlaced?: () => void;
}

interface LockOutcome {
  locked: number;
  failures: string[];
}

async function lockMatches(
  matches: MatchInfo[],
  ctx: { mintUrl: string | null; userPubkey: string; side: "yes" | "no"; marketId: string },
): Promise<LockOutcome> {
  if (matches.length === 0) return { locked: 0, failures: [] };
  if (!ctx.mintUrl) {
    return {
      locked: 0,
      failures: ["mint not configured — funds remain unlocked"],
    };
  }
  let locked = 0;
  const failures: string[] = [];
  for (const match of matches) {
    try {
      const { token } = await lockFundsForMatch({
        mintUrl: ctx.mintUrl,
        myPubkey: ctx.userPubkey,
        mySide: ctx.side,
        counterpartyPubkey: match.counterparty_pubkey,
        groupPubkeyYes: match.group_pubkey_yes,
        groupPubkeyNo: match.group_pubkey_no,
        exchangeLocktime: match.locktime_exchange,
        marketLocktime: match.locktime_market,
        amountSats: match.amount_sats,
      });
      const submitResult = await submitToken(ctx.marketId, match.pair_id, token, ctx.userPubkey);
      if (submitResult.redeemable_token) {
        saveHeldToken({
          market_id: ctx.marketId,
          pair_id: match.pair_id,
          my_side: ctx.side,
          amount_sats: match.amount_sats,
          cashu_token: submitResult.redeemable_token,
          received_at: Math.floor(Date.now() / 1000),
        });
      }
      locked += 1;
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { locked, failures };
}

interface Feedback {
  tone: "success" | "error";
  message: string;
}

function describeBetOutcome(
  mutation: {
    isSuccess: boolean;
    isError: boolean;
    error: unknown;
    data: { result: BetResult; lockOutcome: LockOutcome; side: "yes" | "no"; amount: number } | undefined;
  },
  dismissed: boolean,
): Feedback | null {
  if (dismissed) return null;
  if (mutation.isError) {
    return {
      tone: "error",
      message: mutation.error instanceof Error ? mutation.error.message : "Network error",
    };
  }
  if (mutation.isSuccess && mutation.data) {
    const { result, lockOutcome, side, amount } = mutation.data;
    const matchCount = result.matches?.length ?? 0;
    const sideLabel = side.toUpperCase();
    if (matchCount === 0) {
      return { tone: "success", message: `Bet placed · ${amount.toLocaleString()} sats on ${sideLabel}` };
    }
    if (lockOutcome.locked === 0) {
      return { tone: "error", message: lockOutcome.failures[0] ?? "Match found but lock failed" };
    }
    if (lockOutcome.failures.length > 0) {
      return {
        tone: "success",
        message: `Matched ${matchCount}, locked ${lockOutcome.locked}. ${lockOutcome.failures.length} failed.`,
      };
    }
    return { tone: "success", message: `Bet placed · ${amount.toLocaleString()} sats on ${sideLabel}` };
  }
  return null;
}

function describeRedeemOutcome(mutation: {
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  data: { winning_pairs: number; total_winning_sats: number } | undefined;
}): Feedback | null {
  if (mutation.isError) {
    return {
      tone: "error",
      message: mutation.error instanceof Error ? mutation.error.message : "Redemption failed",
    };
  }
  if (mutation.isSuccess && mutation.data) {
    const { winning_pairs, total_winning_sats } = mutation.data;
    return {
      tone: "success",
      message: winning_pairs > 0
        ? `Won ${total_winning_sats.toLocaleString()} sats from ${winning_pairs} pair(s).`
        : "No winning pairs found.",
    };
  }
  return null;
}

export function MarketDetail({ market, onBack, onBetPlaced }: MarketDetailProps) {
  const userPubkey = getUserPubkey();
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [amount, setAmount] = useState("");
  const [betDismissed, setBetDismissed] = useState(false);
  // Held tokens are owned by localStorage (an external system); we re-read
  // each render via a counter that bumps after a successful bet — keeps the
  // wallet module the source of truth without a useEffect subscription.
  const [tokensVersion, setTokensVersion] = useState(0);
  const heldTokens = useMemo(
    () => loadHeldTokensForMarket(market.id),
    [market.id, tokensVersion],
  );

  const walletConfigQuery = useQuery({
    queryKey: ["wallet-config"],
    queryFn: fetchWalletConfig,
  });
  const mintUrl = walletConfigQuery.data?.mint_url ?? null;
  const relays = walletConfigQuery.data?.nostr_relays ?? [];

  const total = market.yes_pool_sats + market.no_pool_sats;
  const yesPercent = total > 0 ? Math.round((market.yes_pool_sats / total) * 100) : 50;
  const noPercent = 100 - yesPercent;
  const isOpen = market.status === "open";
  const isResolved = market.status.startsWith("resolved_");
  const v24 = volume24h(market);

  const history = useMemo(() => generateHistory(market, 64), [market]);
  const activity = useMemo(() => generateActivity(market, 12), [market]);
  const holders = useMemo(() => generateHolders(market, 8), [market]);

  const amountNum = parseInt(amount) || 0;
  const potentialPayout = amountNum > 0
    ? side === "yes"
      ? Math.floor((amountNum / (market.yes_pool_sats + amountNum)) * (total + amountNum) * (1 - market.fee_ppm / 1_000_000))
      : Math.floor((amountNum / (market.no_pool_sats + amountNum)) * (total + amountNum) * (1 - market.fee_ppm / 1_000_000))
    : 0;
  const sidePercent = side === "yes" ? yesPercent : noPercent;
  const sharesEstimate = sidePercent > 0 ? Math.floor((amountNum / sidePercent) * 100) : 0;

  const placeBetMutation = useMutation({
    mutationFn: async (input: { side: "yes" | "no"; amount: number }) => {
      // Ensure the wallet is initialized with the right mint + NIP-60 relays
      // before any P2PK lock so /submit-token gets a valid cashuB token.
      if (mintUrl) {
        await initWallet(mintUrl, relays);
      }
      const result = await placeBet(market.id, input.side, input.amount, userPubkey);
      const lockOutcome = await lockMatches(result.matches, {
        mintUrl,
        userPubkey,
        side: input.side,
        marketId: market.id,
      });
      return { result, lockOutcome, side: input.side, amount: input.amount };
    },
    onSuccess: ({ lockOutcome }) => {
      if (lockOutcome.locked > 0) {
        // localStorage was written; bump the read-key so derived heldTokens refresh.
        setTokensVersion((v) => v + 1);
      }
      setAmount("");
      setBetDismissed(false);
      onBetPlaced?.();
    },
  });

  const redeemMutation = useMutation({
    mutationFn: () => redeemWinnings(market.id, userPubkey),
  });

  const betFeedback = describeBetOutcome(placeBetMutation, betDismissed);
  const redeemFeedback = describeRedeemOutcome(redeemMutation);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Back */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-5"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Markets
      </button>

      {/* Hero — title + topline stats */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-muted-foreground uppercase tracking-wider">
            {market.category}
          </span>
          <span className="text-muted-foreground">·</span>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
              isOpen && "bg-primary/12 text-primary",
              market.status === "resolved_yes" && "bg-yes/15 text-yes",
              market.status === "resolved_no" && "bg-no/15 text-no",
              !isOpen && !isResolved && "bg-muted text-muted-foreground",
            )}
          >
            {isResolved
              ? (market.status === "resolved_yes" ? "Resolved YES" : "Resolved NO")
              : isOpen ? "Open" : market.status}
          </span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold leading-tight text-foreground mb-3 tracking-tight">
          {market.title}
        </h1>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <Topline label="Volume" value={`${formatSats(market.volume_sats)} sats`} />
          <Topline label="24h" value={`${formatSats(v24)} sats`} />
          <Topline label="Liquidity" value={`${formatSats(total)} sats`} />
          <Topline label="Bettors" value={String(market.num_bettors)} />
          <Topline label="Ends" value={formatDate(market.resolution_deadline)} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Chart — top of mobile, top-left on desktop */}
        <div className="lg:col-span-2 lg:col-start-1 lg:row-start-1">
          <PriceChart data={history} />
        </div>

        {/* Bet panel + sidebar — second on mobile (right after Chart),
         * right column rows 1–2 on desktop. Inner wrapper sticks on lg. */}
        <div className="lg:col-start-3 lg:row-start-1 lg:row-span-2">
          <div className="space-y-5 lg:sticky lg:top-20">
          {isOpen ? (
            <div className="rounded-lg border border-border bg-card p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">Place a Bet</h2>

              {betFeedback && (
                <div
                  className={cn(
                    "rounded-md p-3 mb-4 text-xs flex items-start justify-between gap-2",
                    betFeedback.tone === "success" && "bg-yes/10 text-yes border border-yes/20",
                    betFeedback.tone === "error" && "bg-destructive/10 text-destructive border border-destructive/30",
                  )}
                >
                  <span>{betFeedback.message}</span>
                  <button
                    onClick={() => setBetDismissed(true)}
                    className="shrink-0 opacity-60 hover:opacity-100"
                    aria-label="Dismiss"
                  >
                    ×
                  </button>
                </div>
              )}

              {/* Side selector */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                <button
                  onClick={() => setSide("yes")}
                  className={cn(
                    "h-11 rounded-md font-bold text-sm transition-colors",
                    side === "yes"
                      ? "bg-yes text-yes-foreground"
                      : "bg-yes/8 text-yes hover:bg-yes/15",
                  )}
                >
                  Yes · {yesPercent}%
                </button>
                <button
                  onClick={() => setSide("no")}
                  className={cn(
                    "h-11 rounded-md font-bold text-sm transition-colors",
                    side === "no"
                      ? "bg-no text-no-foreground"
                      : "bg-no/8 text-no hover:bg-no/15",
                  )}
                >
                  No · {noPercent}%
                </button>
              </div>

              {/* Amount */}
              <label className="text-xs text-muted-foreground block mb-1.5">
                Amount
              </label>
              <div className="relative mb-3">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={`Min ${market.min_bet_sats}`}
                  min={market.min_bet_sats}
                  max={market.max_bet_sats || undefined}
                  disabled={placeBetMutation.isPending}
                  className="w-full h-11 rounded-md border border-border bg-muted px-3 pr-12 text-base font-mono font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25 disabled:opacity-50"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground">
                  sats
                </span>
              </div>

              {/* Quick amounts */}
              <div className="grid grid-cols-4 gap-1.5 mb-4">
                {[100, 1000, 5000, 10000].map((v) => (
                  <button
                    key={v}
                    onClick={() => setAmount(String(v))}
                    disabled={placeBetMutation.isPending}
                    className="h-8 rounded-full border border-border text-[11px] font-mono font-semibold text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
                  >
                    {v >= 1000 ? `${v / 1000}K` : v}
                  </button>
                ))}
              </div>

              {/* Payout summary */}
              {amountNum > 0 && (
                <div className="rounded-md bg-muted p-3 mb-4 space-y-1.5">
                  <Row label="Avg price" value={`${sidePercent}¢`} />
                  <Row label="Shares" value={`~${formatSats(sharesEstimate)}`} />
                  <Row
                    label="Max payout"
                    value={`${formatSats(potentialPayout)} sats`}
                    highlight
                  />
                  <Row
                    label="Return"
                    value={`+${(((potentialPayout / Math.max(amountNum, 1)) - 1) * 100).toFixed(0)}%`}
                    color={potentialPayout > amountNum ? "text-yes" : "text-no"}
                  />
                </div>
              )}

              <button
                onClick={() => placeBetMutation.mutate({ side, amount: amountNum })}
                disabled={amountNum < market.min_bet_sats || placeBetMutation.isPending}
                className={cn(
                  "w-full h-11 rounded-md font-bold text-sm transition-colors",
                  "disabled:opacity-40 disabled:cursor-not-allowed",
                  side === "yes"
                    ? "bg-yes text-yes-foreground hover:brightness-105"
                    : "bg-no text-no-foreground hover:brightness-105",
                )}
              >
                {placeBetMutation.isPending
                  ? "Placing…"
                  : amountNum < market.min_bet_sats
                    ? `Enter at least ${market.min_bet_sats} sats`
                    : `Buy ${side.toUpperCase()} · ${formatSats(amountNum)} sats`}
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card p-5">
              <h2 className="text-sm font-semibold text-foreground mb-3">Market Closed</h2>
              {isResolved && (
                <div
                  className={cn(
                    "rounded-md p-4 text-center mb-4",
                    market.status === "resolved_yes" ? "bg-yes/10" : "bg-no/10",
                  )}
                >
                  <span
                    className={cn(
                      "font-mono text-3xl font-bold",
                      market.status === "resolved_yes" ? "text-yes" : "text-no",
                    )}
                  >
                    {market.status === "resolved_yes" ? "YES" : "NO"}
                  </span>
                </div>
              )}

              {isResolved && (
                <>
                  {redeemFeedback && (
                    <div
                      className={cn(
                        "rounded-md p-3 mb-3 text-xs",
                        redeemFeedback.tone === "success" && "bg-yes/10 text-yes border border-yes/20",
                        redeemFeedback.tone === "error" && "bg-destructive/10 text-destructive border border-destructive/30",
                      )}
                    >
                      {redeemFeedback.message}
                    </div>
                  )}
                  <button
                    onClick={() => redeemMutation.mutate()}
                    disabled={redeemMutation.isPending || redeemMutation.isSuccess}
                    className="w-full h-11 rounded-full font-bold text-sm bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    {redeemMutation.isPending
                      ? "Redeeming…"
                      : redeemMutation.isSuccess
                        ? "Redeemed"
                        : "Redeem winnings"}
                  </button>
                </>
              )}
            </div>
          )}

          {/* Time remaining */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5">
              {isOpen ? "Time Remaining" : "Ended"}
            </div>
            <div className="font-mono text-2xl font-bold text-foreground">
              {formatTimeLeft(market.resolution_deadline)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {formatDate(market.resolution_deadline)}
            </div>
          </div>

          {/* Held tokens — compact, technical details hidden */}
          {heldTokens.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Your Positions
              </h3>
              <ul className="space-y-2">
                {heldTokens.map((t) => (
                  <li
                    key={t.pair_id}
                    className="flex items-center justify-between rounded-md bg-muted px-3 py-2"
                  >
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                        t.my_side === "yes" ? "bg-yes/18 text-yes" : "bg-no/18 text-no",
                      )}
                    >
                      {t.my_side}
                    </span>
                    <span className="font-mono text-sm font-semibold text-foreground">
                      {formatSats(t.amount_sats)} sats
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          </div>
        </div>

        {/* Rest of left column — Odds, Activity, Holders, About — below
         * the Chart on desktop, below the Bet panel on mobile. */}
        <div className="lg:col-span-2 lg:col-start-1 lg:row-start-2 space-y-5">
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
              Current Odds
            </h2>
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
              <div
                className="h-full bg-yes rounded-l-full transition-all duration-500"
                style={{ width: `${yesPercent}%` }}
              />
              <div
                className="h-full bg-no rounded-r-full transition-all duration-500"
                style={{ width: `${noPercent}%` }}
              />
            </div>
          </div>

          <ActivityFeed events={activity} limit={8} />
          <TopHolders rows={holders} limit={8} />

          {market.description && (
            <div className="rounded-lg border border-border bg-card p-5">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                About
              </h2>
              <p className="text-sm text-foreground/85 leading-relaxed">{market.description}</p>
              {market.resolution_url && (
                <p className="text-xs text-muted-foreground mt-3">
                  Source:{" "}
                  <a
                    href={market.resolution_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground hover:underline break-all"
                  >
                    {market.resolution_url}
                  </a>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Topline({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-sm font-semibold text-foreground">{value}</span>
    </span>
  );
}

function Row({
  label,
  value,
  highlight,
  color,
}: { label: string; value: string; highlight?: boolean; color?: string }) {
  return (
    <div className="flex justify-between items-baseline text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono",
          highlight && "text-base font-bold",
          color ?? "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}
