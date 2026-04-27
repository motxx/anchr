import React from "react";
import { getUserPubkey, truncatePubkey } from "../keypair.ts";
import { SakuraIcon, SparkleIcon, ToriiIcon } from "./Motifs.tsx";
import { WalletButton } from "./WalletButton.tsx";

export { getUserPubkey } from "../keypair.ts";

export function Header() {
  const pubkey = getUserPubkey();
  return (
    <header className="border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Brand mark — torii on a soft pink rounded square */}
          <div className="relative w-10 h-10 rounded-2xl bg-primary/12 ring-1 ring-primary/20 flex items-center justify-center">
            <ToriiIcon className="text-primary" size={20} />
            <SakuraIcon
              size={10}
              className="absolute -top-1 -right-1 text-sakura animate-sparkle"
            />
          </div>

          <div className="flex items-baseline gap-2.5">
            <span className="font-shrine text-2xl font-semibold text-foreground tracking-tight leading-none">
              Kannagi
            </span>
            <span className="font-shrine text-sm text-muted-foreground hidden sm:inline">
              かんなぎ
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <WalletButton />

          {/* Pubkey */}
          <div
            className="hidden sm:flex items-center gap-1.5 rounded-full border border-border bg-card px-3 h-9"
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

          {/* Live indicator */}
          <div className="flex items-center gap-1.5 rounded-full bg-yes/12 px-3 h-9">
            <SparkleIcon size={12} className="text-yes animate-sparkle" />
            <span className="text-xs font-semibold text-yes">live</span>
          </div>
        </div>
      </div>
    </header>
  );
}
