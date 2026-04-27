import React from "react";
import { getUserPubkey, truncatePubkey } from "../keypair.ts";
import { ToriiIcon } from "./Motifs.tsx";
import { WalletButton } from "./WalletButton.tsx";

export { getUserPubkey } from "../keypair.ts";

interface HeaderProps {
  /** Click on the brand mark sends the user back to the markets list. */
  onLogoClick?: () => void;
}

export function Header({ onLogoClick }: HeaderProps) {
  const pubkey = getUserPubkey();
  return (
    <header className="border-b border-border bg-card/85 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-6xl mx-auto px-4 sm:px-5 h-14 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onLogoClick}
          className="flex items-center gap-2.5 min-w-0 rounded-md -mx-1 px-1 py-0.5 hover:bg-foreground/5 transition-colors"
          aria-label="Go to markets list"
        >
          {/* Brand mark — torii in a sumi square. No decorative ornaments. */}
          <div className="shrink-0 w-8 h-8 rounded-lg bg-foreground/5 ring-1 ring-foreground/10 flex items-center justify-center">
            <ToriiIcon className="text-foreground" size={16} />
          </div>
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-shrine text-xl font-semibold text-foreground tracking-tight leading-none">
              Kannagi
            </span>
            <span className="font-shrine text-xs text-muted-foreground hidden sm:inline">
              かんなぎ
            </span>
          </div>
        </button>

        <div className="flex items-center gap-2">
          <WalletButton />

          {/* Pubkey — secondary; hide on mobile */}
          <div
            className="hidden md:flex items-center gap-1.5 rounded-full border border-border bg-card px-3 h-9"
            title={pubkey}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-muted-foreground"
            >
              <path d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
            </svg>
            <span className="text-xs font-mono text-muted-foreground">
              {truncatePubkey(pubkey)}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
