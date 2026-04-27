import React, { useMemo, useState, useCallback, useEffect } from "react";
import type { Market } from "../mock-data.ts";
import {
  placeBet,
  redeemWinnings,
  submitToken,
  fetchWalletConfig,
  type RedeemResult,
  type MatchInfo,
} from "../api.ts";
import { cn } from "../lib/utils.ts";
import { getUserPubkey } from "../keypair.ts";
import {
  lockFundsForMatch,
  saveHeldToken,
  loadHeldTokensForMarket,
  type HeldToken,
} from "../wallet.ts";
import { generateHistory, generateActivity } from "../lib/market-history.ts";
import { PriceChart } from "./PriceChart.tsx";
import { ActivityFeed } from "./ActivityFeed.tsx";

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
  const userPubkey = getUserPubkey();
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [amount, setAmount] = useState("");
  const [betStatus, setBetStatus] = useState<BetStatus>("idle");
  const [betMessage, setBetMessage] = useState<string | null>(null);
  const [redeemStatus, setRedeemStatus] = useState<"idle" | "redeeming" | "success" | "error">("idle");
  const [redeemMessage, setRedeemMessage] = useState<string | null>(null);
  const [mintUrl, setMintUrl] = useState<string | null>(null);
  const [heldTokens, setHeldTokens] = useState<HeldToken[]>(
    () => loadHeldTokensForMarket(market.id),
  );

  useEffect(() => {
    let cancelled = false;
    fetchWalletConfig()
      .then((cfg) => { if (!cancelled) setMintUrl(cfg.mint_url); })
      .catch(() => { /* leave null — UI falls back to "configure mint" message */ });
    return () => { cancelled = true; };
  }, []);

  const refreshHeldTokens = useCallback(() => {
    setHeldTokens(loadHeldTokensForMarket(market.id));
  }, [market.id]);

  const total = market.yes_pool_sats + market.no_pool_sats;
  const yesPercent = total > 0 ? Math.round((market.yes_pool_sats / total) * 100) : 50;
  const noPercent = 100 - yesPercent;
  const isOpen = market.status === "open";
  const isResolved = market.status.startsWith("resolved_");
  const history = useMemo(() => generateHistory(market, 64), [market]);
  const activity = useMemo(() => generateActivity(market, 16), [market]);

  const amountNum = parseInt(amount) || 0;
  const potentialPayout = amountNum > 0
    ? side === "yes"
      ? Math.floor((amountNum / (market.yes_pool_sats + amountNum)) * (total + amountNum) * (1 - market.fee_ppm / 1_000_000))
      : Math.floor((amountNum / (market.no_pool_sats + amountNum)) * (total + amountNum) * (1 - market.fee_ppm / 1_000_000))
    : 0;

  const lockMatchTokens = useCallback(
    async (matches: MatchInfo[]): Promise<{ locked: number; failures: string[] }> => {
      if (!mintUrl) {
        return {
          locked: 0,
          failures: ["mint not configured — funds remain unlocked. Set CASHU_MINT_URL on the server"],
        };
      }
      let locked = 0;
      const failures: string[] = [];
      for (const match of matches) {
        try {
          // 1. Lock our own funds in a P2PK token.
          const { token } = await lockFundsForMatch({
            mintUrl,
            myPubkey: userPubkey,
            mySide: side,
            counterpartyPubkey: match.counterparty_pubkey,
            groupPubkeyYes: match.group_pubkey_yes,
            groupPubkeyNo: match.group_pubkey_no,
            exchangeLocktime: match.locktime_exchange,
            marketLocktime: match.locktime_market,
            amountSats: match.amount_sats,
          });
          // 2. Submit to the matchmaker; if both sides have submitted, the
          //    server returns the counterparty's redeemable token.
          const submitResult = await submitToken(market.id, match.pair_id, token, userPubkey);
          if (submitResult.redeemable_token) {
            saveHeldToken({
              market_id: market.id,
              pair_id: match.pair_id,
              my_side: side,
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
    },
    [mintUrl, userPubkey, side, market.id],
  );

  const handlePlaceBet = useCallback(async () => {
    if (amountNum < market.min_bet_sats) return;
    if (betStatus === "submitting") return;

    setBetStatus("submitting");
    setBetMessage(null);

    try {
      const result = await placeBet(market.id, side, amountNum, userPubkey);
      const matchCount = result.matches?.length ?? 0;
      if (matchCount > 0) {
        // Try to lock funds for each match. If the mint isn't configured, the
        // server still has the order; the user can lock later from another
        // session that has wallet access.
        const { locked, failures } = await lockMatchTokens(result.matches);
        if (locked > 0 && failures.length === 0) {
          setBetStatus("success");
          setBetMessage(
            `Matched and locked ${locked} pair${locked > 1 ? "s" : ""} (${amountNum} sats on ${side.toUpperCase()}). ` +
            `Held redeemable token saved.`,
          );
          refreshHeldTokens();
        } else if (locked > 0) {
          setBetStatus("success");
          setBetMessage(
            `Matched ${matchCount}, locked ${locked}. ${failures.length} failed: ${failures[0]}`,
          );
          refreshHeldTokens();
        } else {
          // All locks failed — surface the first error so the user can fix balance / mint config.
          setBetStatus("error");
          setBetMessage(`Match found but lock failed: ${failures[0] ?? "unknown error"}`);
        }
      } else {
        setBetStatus("success");
        setBetMessage(`Order placed! ${amountNum} sats on ${side.toUpperCase()} — waiting for counterparty`);
      }
      setAmount("");
      if (onBetPlaced) onBetPlaced();
    } catch (err) {
      setBetStatus("error");
      setBetMessage(err instanceof Error ? err.message : "Network error — please try again");
    }
  }, [
    amountNum,
    market.id,
    market.min_bet_sats,
    side,
    betStatus,
    onBetPlaced,
    userPubkey,
    lockMatchTokens,
    refreshHeldTokens,
  ]);

  const clearBetStatus = useCallback(() => {
    setBetStatus("idle");
    setBetMessage(null);
  }, []);

  const handleRedeem = useCallback(async () => {
    if (redeemStatus === "redeeming") return;
    setRedeemStatus("redeeming");
    setRedeemMessage(null);
    try {
      const result = await redeemWinnings(market.id, userPubkey);
      setRedeemStatus("success");
      setRedeemMessage(
        result.winning_pairs > 0
          ? `Won ${result.total_winning_sats.toLocaleString()} sats from ${result.winning_pairs} pair(s). Use sign-proofs endpoint with your held token to redeem at mint.`
          : "No winning pairs found for your pubkey."
      );
    } catch (err) {
      setRedeemStatus("error");
      setRedeemMessage(err instanceof Error ? err.message : "Redemption failed");
    }
  }, [market.id, userPubkey, redeemStatus]);

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

          {/* Probability chart */}
          <PriceChart data={history} />

          {/* YES/NO split */}
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-sm font-medium text-muted-foreground mb-4 uppercase tracking-wider">Current Odds</h2>
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

          {/* Activity feed */}
          <ActivityFeed events={activity} limit={8} />

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
                <span className="text-xs text-muted-foreground block mb-1">HTLC Hash (YES)</span>
                <code className="text-xs font-mono text-muted-foreground">{market.htlc_hash_yes}</code>
              </div>
            </div>
          </div>

          {/* Settlement info */}
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-sm font-medium text-muted-foreground mb-4 uppercase tracking-wider">Settlement</h2>
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-start gap-3">
                <span className="text-primary mt-0.5">1.</span>
                <span>You create P2PK-locked tokens in your browser — server never touches your sats</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-primary mt-0.5">2.</span>
                <span>Matchmaker announces pairs; you exchange tokens P2P with counterparty</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-primary mt-0.5">3.</span>
                <span>Oracle fetches resolution data via TLSNotary MPC-TLS — cryptographic proof, not trust</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="text-primary mt-0.5">4.</span>
                <span>Winner submits proof secrets; Oracle signs each proof (NUT-11 P2PK 2-of-2). Redeem at mint.</span>
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
                Trustless P2PK exchange. Server is a matchmaker only.
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

              {/* Redeem winnings */}
              {isResolved && (
                <div className="mt-4 space-y-3">
                  {redeemMessage && (
                    <div className={cn(
                      "rounded-lg p-3 text-sm",
                      redeemStatus === "success" && "bg-yes/10 text-yes border border-yes/20",
                      redeemStatus === "error" && "bg-destructive/10 text-destructive border border-destructive/20",
                    )}>
                      {redeemMessage}
                    </div>
                  )}
                  <button
                    onClick={handleRedeem}
                    disabled={redeemStatus === "redeeming" || redeemStatus === "success"}
                    className={cn(
                      "w-full h-10 rounded-lg font-semibold text-sm transition-all duration-200",
                      "disabled:opacity-40 disabled:cursor-not-allowed",
                      "bg-primary text-primary-foreground hover:bg-primary/90",
                    )}
                  >
                    {redeemStatus === "redeeming"
                      ? "Redeeming..."
                      : redeemStatus === "success"
                        ? "Redeemed"
                        : "Redeem Winnings"}
                  </button>
                  <p className="text-[11px] text-muted-foreground text-center">
                    Submit your token's proof secrets to get Oracle signatures, then redeem at the Cashu mint.
                  </p>
                </div>
              )}

              {/* Preimage display */}
              {isResolved && market.resolved_preimage && (
                <div className="mt-4 rounded-lg bg-muted p-3">
                  <span className="text-xs text-muted-foreground block mb-1">Winning Preimage</span>
                  <code className="text-xs font-mono text-primary break-all">{market.resolved_preimage}</code>
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    Use this preimage to independently verify and redeem HTLC tokens at the mint.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Held redeemable tokens for this market */}
          {heldTokens.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-sm font-medium text-foreground mb-3">
                Held Tokens ({heldTokens.length})
              </h2>
              <p className="text-[11px] text-muted-foreground mb-3">
                Counterparty-locked tokens redeemable if your side wins.
              </p>
              <div className="space-y-2">
                {heldTokens.map((t) => (
                  <div key={t.pair_id} className="rounded-lg bg-muted p-3 space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Pair</span>
                      <span className="font-mono text-foreground">{t.pair_id.slice(0, 12)}...</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Side / Amount</span>
                      <span className={cn("font-mono", t.my_side === "yes" ? "text-yes" : "text-no")}>
                        {t.my_side.toUpperCase()} · {t.amount_sats} sats
                      </span>
                    </div>
                    <details className="text-[11px]">
                      <summary className="text-muted-foreground cursor-pointer hover:text-foreground">
                        cashuB token
                      </summary>
                      <code className="font-mono text-foreground break-all block mt-1.5 max-h-24 overflow-y-auto">
                        {t.cashu_token}
                      </code>
                    </details>
                  </div>
                ))}
              </div>
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
