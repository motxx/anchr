import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchWalletConfig,
  requestFaucet,
} from "../api.ts";
import {
  initWallet,
  getBalance,
  isNostrBacked,
  receiveToken,
} from "../wallet.ts";
import { cn } from "../lib/utils.ts";

/**
 * Compact wallet entry point — replaces the full-width banner. Renders as a
 * pill in the page header with current balance; clicking opens a drawer
 * with connect / faucet / receive actions. Out of the way until the user
 * actually wants to spend.
 *
 * State model (Dan Abramov style):
 *   - Wallet config (mint URL) → useQuery
 *   - Connect / faucet / receive → useMutation
 *   - Balance is owned by the wallet module (localStorage); we re-read on
 *     each render via a "version" counter that mutations bump.
 *   - No useEffect — there's no external system to *subscribe to*; mutations
 *     write, then bump the version, then derive everything during render.
 */
export function WalletButton() {
  const [open, setOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [walletReady, setWalletReady] = useState(false);
  const queryClient = useQueryClient();

  const walletConfig = useQuery({
    queryKey: ["wallet-config"],
    queryFn: fetchWalletConfig,
  });
  const mintUrl = walletConfig.data?.mint_url ?? null;
  const relays = walletConfig.data?.nostr_relays ?? [];

  // Balance is owned by the wallet module (NIP-60 events or localStorage).
  // useQuery handles the async fetch and re-renders when invalidated.
  const balanceQuery = useQuery({
    queryKey: ["wallet-balance"],
    queryFn: () => getBalance(),
    enabled: walletReady,
    initialData: 0,
  });
  const balance = balanceQuery.data ?? 0;
  const refreshBalance = () =>
    queryClient.invalidateQueries({ queryKey: ["wallet-balance"] });

  const connectMutation = useMutation({
    mutationFn: async () => {
      if (!mintUrl) throw new Error("Mint not configured");
      await initWallet(mintUrl, relays);
    },
    onSuccess: () => {
      setWalletReady(true);
      refreshBalance();
    },
  });

  const faucetMutation = useMutation({
    mutationFn: async () => {
      if (!mintUrl) throw new Error("Mint not configured");
      const result = await requestFaucet(1000);
      const wallet = await initWallet(mintUrl, relays);
      await receiveToken(wallet, result.cashu_token);
      return result.amount_sats;
    },
    onSuccess: () => refreshBalance(),
  });

  const receiveMutation = useMutation({
    mutationFn: async (token: string) => {
      if (!mintUrl) throw new Error("Mint not configured");
      const wallet = await initWallet(mintUrl, relays);
      const proofs = await receiveToken(wallet, token);
      return proofs.reduce((sum, p) => sum + p.amount, 0);
    },
    onSuccess: () => {
      setTokenInput("");
      refreshBalance();
    },
  });

  if (walletConfig.isPending) return null;

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-9 px-3.5 rounded-full bg-card border border-border hover:border-primary/40 hover:bg-primary/5 transition-all flex items-center gap-2"
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
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed right-4 sm:right-5 top-16 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-5 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)]">
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

            <div className="rounded-md bg-muted p-4 mb-4">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">
                Balance
              </div>
              <div className="font-mono text-2xl font-bold text-foreground">
                {balance.toLocaleString()}
                <span className="text-sm text-muted-foreground ml-1.5">sats</span>
              </div>
            </div>

            {!mintUrl && (
              <p className="text-xs text-muted-foreground">Mint not configured.</p>
            )}

            {mintUrl && !walletReady && (
              <div>
                <button
                  onClick={() => connectMutation.mutate()}
                  disabled={connectMutation.isPending}
                  className="w-full h-10 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40"
                >
                  {connectMutation.isPending ? "Connecting…" : "Connect to mint"}
                </button>
                {connectMutation.isError && (
                  <p className="text-xs text-destructive mt-2">
                    {connectMutation.error instanceof Error ? connectMutation.error.message : "Failed to connect"}
                  </p>
                )}
              </div>
            )}

            {walletReady && (
              <div className="space-y-3">
                <button
                  onClick={() => faucetMutation.mutate()}
                  disabled={faucetMutation.isPending}
                  className="w-full h-10 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40"
                >
                  {faucetMutation.isPending ? "Minting…" : "Faucet · +1,000 sats"}
                </button>
                {faucetMutation.isSuccess && (
                  <p className="text-xs text-yes">+{faucetMutation.data?.toLocaleString()} sats</p>
                )}
                {faucetMutation.isError && (
                  <p className="text-xs text-destructive">
                    {faucetMutation.error instanceof Error ? faucetMutation.error.message : "Faucet failed"}
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
                      onClick={() => receiveMutation.mutate(tokenInput.trim())}
                      disabled={receiveMutation.isPending || !tokenInput.trim()}
                      className="h-9 px-3 rounded-full border border-border text-xs font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                    >
                      Receive
                    </button>
                  </div>
                  {receiveMutation.isSuccess && (
                    <p className="text-xs text-yes mt-1.5">+{receiveMutation.data?.toLocaleString()} sats</p>
                  )}
                  {receiveMutation.isError && (
                    <p className="text-xs text-destructive mt-1.5">
                      {receiveMutation.error instanceof Error ? receiveMutation.error.message : "Receive failed"}
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
