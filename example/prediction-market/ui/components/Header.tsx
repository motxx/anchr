import React, { useState, useEffect, useCallback } from "react";
import { fetchBalance, requestFaucet } from "../api";
import { getUserPubkey, truncatePubkey } from "../keypair";

/** Re-export for other components that need the user's pubkey. */
export { getUserPubkey } from "../keypair";

export function Header() {
  const pubkey = getUserPubkey();
  const [balance, setBalance] = useState<number | null>(null);
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [faucetMsg, setFaucetMsg] = useState<string | null>(null);

  const loadBalance = useCallback(async () => {
    try {
      const data = await fetchBalance(pubkey);
      setBalance(data.balance_sats);
    } catch {
      setBalance(null);
    }
  }, [pubkey]);

  useEffect(() => {
    loadBalance();
    const interval = setInterval(loadBalance, 5000);
    return () => clearInterval(interval);
  }, [loadBalance]);

  const handleFaucet = async () => {
    setFaucetLoading(true);
    setFaucetMsg(null);
    try {
      const result = await requestFaucet(pubkey, 1000);
      setBalance(result.balance_sats);
      setFaucetMsg(`+${result.funded_sats} sats`);
      setTimeout(() => setFaucetMsg(null), 3000);
    } catch (err) {
      setFaucetMsg(err instanceof Error ? err.message : "Faucet error");
      setTimeout(() => setFaucetMsg(null), 5000);
    } finally {
      setFaucetLoading(false);
    }
  };

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-5 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="hsl(270 80% 60%)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          </div>
          <span className="font-bold text-foreground tracking-tight">Anchr</span>
          <span className="text-xs text-primary font-medium bg-primary/10 rounded-full px-2 py-0.5">Markets</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Pubkey */}
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 h-8" title={pubkey}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
              <path d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
            </svg>
            <span className="text-xs font-mono text-muted-foreground">{truncatePubkey(pubkey)}</span>
          </div>

          {/* Balance */}
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 h-8">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
              <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2.5" />
              <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
            </svg>
            <span className="text-xs font-mono text-foreground">
              {balance !== null ? `${balance.toLocaleString()} sats` : "---"}
            </span>
          </div>

          {/* Faucet */}
          <button
            onClick={handleFaucet}
            disabled={faucetLoading}
            className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {faucetLoading ? "..." : faucetMsg ?? "Get 1K sats"}
          </button>

          {/* Status */}
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-yes animate-pulse" />
            regtest
          </div>
        </div>
      </div>
    </header>
  );
}
