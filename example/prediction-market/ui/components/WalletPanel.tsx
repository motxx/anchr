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
 * Top-of-page wallet panel.
 *
 * Discovers the mint via /markets/wallet/config, lazily initializes the
 * browser-side Cashu wallet, and surfaces three actions:
 *   - request faucet sats (regtest demo)
 *   - paste an external cashuB token to receive
 *   - watch the running balance
 *
 * The panel is intentionally lazy — we only call wallet.loadMint() the
 * first time the user actually clicks "Connect" so a missing/dev mint
 * doesn't keep retrying on every page render.
 */
export function WalletPanel() {
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

  const refreshBalance = useCallback(() => {
    setBalance(getBalance());
  }, []);

  // Discover mint URL once on mount.
  useEffect(() => {
    let cancelled = false;
    fetchWalletConfig()
      .then((cfg) => {
        if (cancelled) return;
        setMintUrl(cfg.mint_url);
        setConfigLoaded(true);
        // If a wallet was already initialized in this tab, surface its URL.
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
      setConnectError(err instanceof Error ? err.message : "Failed to connect to mint");
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
      setFaucetMsg(`Received ${result.amount_sats.toLocaleString()} sats from faucet`);
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
      setReceiveMsg(`Received ${total.toLocaleString()} sats`);
    } catch (err) {
      setReceiveStatus("error");
      setReceiveMsg(err instanceof Error ? err.message : "Receive failed");
    }
  }, [walletReady, mintUrl, tokenInput, refreshBalance]);

  if (!configLoaded) return null;

  if (!mintUrl) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 mb-6 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Cashu wallet:</span> mint
        not configured (set <code className="font-mono text-primary">CASHU_MINT_URL</code> on
        the server to enable real betting).
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Wallet Balance</div>
            <div className="font-mono text-2xl font-bold text-foreground">
              {balance.toLocaleString()} <span className="text-xs text-muted-foreground">sats</span>
            </div>
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground font-mono break-all max-w-[40ch]">
          {mintUrl}
        </div>
      </div>

      {!walletReady && (
        <div>
          <button
            onClick={handleConnect}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Connect to mint
          </button>
          {connectError && (
            <p className="text-xs text-destructive mt-2">{connectError}</p>
          )}
        </div>
      )}

      {walletReady && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Faucet */}
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="text-xs text-muted-foreground mb-2">Demo faucet (regtest)</div>
            <button
              onClick={handleFaucet}
              disabled={faucetStatus === "loading"}
              className="h-9 w-full rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {faucetStatus === "loading" ? "Minting..." : "+ 1,000 sats"}
            </button>
            {faucetMsg && (
              <p className={cn(
                "text-xs mt-2",
                faucetStatus === "success" ? "text-yes" : "text-destructive",
              )}>{faucetMsg}</p>
            )}
          </div>

          {/* Receive token */}
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="text-xs text-muted-foreground mb-2">Receive cashuB token</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="cashuB..."
                className="flex-1 h-9 rounded-lg border border-border bg-background px-3 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
              <button
                onClick={handleReceive}
                disabled={receiveStatus === "loading" || !tokenInput.trim()}
                className="h-9 px-3 rounded-lg border border-border text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {receiveStatus === "loading" ? "..." : "Receive"}
              </button>
            </div>
            {receiveMsg && (
              <p className={cn(
                "text-xs mt-2",
                receiveStatus === "success" ? "text-yes" : "text-destructive",
              )}>{receiveMsg}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
