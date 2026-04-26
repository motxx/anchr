import React from "react";
import { getUserPubkey, truncatePubkey } from "../keypair.ts";

/** Re-export for other components that need the user's pubkey. */
export { getUserPubkey } from "../keypair.ts";

export function Header() {
  const pubkey = getUserPubkey();
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
