import React, { useCallback, useEffect, useState } from "react";
import {
  fetchWalletConfig,
  requestFaucet,
  type FaucetResult,
} from "../api.ts";
import {
  initWallet,
  getMintUrl,
  getBalance,
  receiveToken,
} from "../wallet.ts";
import { cn } from "../lib/utils.ts";

type Status = "idle" | "loading" | "success" | "error";

/**
 * Compact wallet entry point — replaces the full-width banner. Renders as a
 * pill in the page header with current balance; clicking opens a drawer
 * with connect/faucet/receive actions. Out of the way until the user
 * actually wants to spend.
 */
export function WalletButton() {
  const [open, setOpen] = useState(false);
  const [mintUrl, setMintUrl] = useState<string | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [walletReady, setWalletReady] = useState(false);
  const [balance, setBalance] = useState(0);
  const [faucetStatus, setFaucetStatus] = useState<Status>("idle");
  const [faucetMsg, setFaucetMsg] = useState<string | null>(null);
  const [receiveStatus, setReceiveStatus] = useState<Status>("idle");
  const [receiveMsg, setReceiveMsg] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);

  const refreshBalance = useCallback(() => setBalance(getBalance()), []);

  useEffect(() => {
    let cancelled = false;
    fetchWalletConfig()
      .then((cfg) => {
        if (cancelled) return;
        setMintUrl(cfg.mint_url);
        setConfigLoaded(true);
        if (getMintUrl()) setWalletReady(true);
        refreshBalance();
      })
      .catch(() => {
        if (cancelled) return;
        setConfigLoaded(true);
      });
    return () => { cancelled = true; };
  }, [refreshBalance]);

  const handleConnect = useCallback(async () => {
    if (!mintUrl) return;
    setConnectError(null);
    try {
      await initWallet(mintUrl);
      setWalletReady(true);
      refreshBalance();
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Failed to connect");
    }
  }, [mintUrl, refreshBalance]);

  const handleFaucet = useCallback(async () => {
    if (!walletReady || !mintUrl) return;
    setFaucetStatus("loading");
    setFaucetMsg(null);
    try {
      const result: FaucetResult = await requestFaucet(1000);
      const wallet = await initWallet(mintUrl);
      await receiveToken(wallet, result.cashu_token);
      refreshBalance();
      setFaucetStatus("success");
      setFaucetMsg(`+${result.amount_sats.toLocaleString()} sats`);
    } catch (err) {
      setFaucetStatus("error");
      setFaucetMsg(err instanceof Error ? err.message : "Faucet failed");
    }
  }, [walletReady, mintUrl, refreshBalance]);

  const handleReceive = useCallback(async () => {
    if (!walletReady || !mintUrl) return;
    const trimmed = tokenInput.trim();
    if (!trimmed) return;
    setReceiveStatus("loading");
    setReceiveMsg(null);
    try {
      const wallet = await initWallet(mintUrl);
      const proofs = await receiveToken(wallet, trimmed);
      const total = proofs.reduce((sum, p) => sum + p.amount, 0);
      refreshBalance();
      setTokenInput("");
      setReceiveStatus("success");
      setReceiveMsg(`+${total.toLocaleString()} sats`);
    } catch (err) {
      setReceiveStatus("error");
      setReceiveMsg(err instanceof Error ? err.message : "Receive failed");
    }
  }, [walletReady, mintUrl, tokenInput, refreshBalance]);

  if (!configLoaded) return null;

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "h-9 px-3.5 rounded-full bg-card border border-border hover:border-primary/40 hover:bg-primary/5 transition-all flex items-center gap-2",
        )}
        title="Wallet"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
          <path d="M21 8H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2Z" />
          <path d="M16 14h.01" />
          <path d="M2 8V6a2 2 0 0 1 2-2h16" />
        </svg>
        <span className="font-mono text-sm font-semibold text-foreground tabular-nums">
          {balance.toLocaleString()}
        </span>
        <span className="text-[11px] text-muted-foreground">sats</span>
      </button>

      {open && (
        <>
          {/* click-away backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed right-5 top-16 z-50 w-80 rounded-2xl border border-border bg-card p-5 shadow-sakura">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">Wallet</h3>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="rounded-xl bg-muted p-4 mb-4">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">
                Balance
              </div>
              <div className="font-mono text-2xl font-bold text-foreground">
                {balance.toLocaleString()}
                <span className="text-sm text-muted-foreground ml-1.5">sats</span>
              </div>
            </div>

            {!mintUrl && (
              <p className="text-xs text-muted-foreground">
                Mint not configured.
              </p>
            )}

            {mintUrl && !walletReady && (
              <div>
                <button
                  onClick={handleConnect}
                  className="w-full h-10 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
                >
                  Connect to mint
                </button>
                {connectError && (
                  <p className="text-xs text-destructive mt-2">{connectError}</p>
                )}
              </div>
            )}

            {walletReady && (
              <div className="space-y-3">
                <button
                  onClick={handleFaucet}
                  disabled={faucetStatus === "loading"}
                  className="w-full h-10 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40"
                >
                  {faucetStatus === "loading" ? "Minting…" : "Faucet · +1,000 sats"}
                </button>
                {faucetMsg && (
                  <p className={cn("text-xs", faucetStatus === "success" ? "text-yes" : "text-destructive")}>
                    {faucetMsg}
                  </p>
                )}

                <div>
                  <label className="text-[11px] text-muted-foreground uppercase tracking-wider block mb-1.5">
                    Receive token
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      placeholder="cashuB…"
                      className="flex-1 h-9 rounded-full border border-border bg-muted px-3 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                    />
                    <button
                      onClick={handleReceive}
                      disabled={receiveStatus === "loading" || !tokenInput.trim()}
                      className="h-9 px-3 rounded-full border border-border text-xs font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                    >
                      Receive
                    </button>
                  </div>
                  {receiveMsg && (
                    <p className={cn("text-xs mt-1.5", receiveStatus === "success" ? "text-yes" : "text-destructive")}>
                      {receiveMsg}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
