import React from "react";

export function Header() {
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
        <div className="flex items-center gap-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-yes animate-pulse" />
            Nostr Connected
          </div>
          <button className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
            Connect Wallet
          </button>
        </div>
      </div>
    </header>
  );
}
