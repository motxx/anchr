import React, { useState } from "react";
import { MOCK_MARKETS, CATEGORIES, type Market, type MarketCategory } from "./mock-data";
import { Header } from "./components/Header";
import { StatsBar } from "./components/StatsBar";
import { MarketCard } from "./components/MarketCard";
import { MarketDetail } from "./components/MarketDetail";
import { cn } from "../lib/utils";

type SortMode = "volume" | "newest" | "ending_soon" | "bettors";

export function MarketApp() {
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [category, setCategory] = useState<MarketCategory | "all">("all");
  const [sort, setSort] = useState<SortMode>("volume");
  const [search, setSearch] = useState("");

  const filtered = MOCK_MARKETS
    .filter((m) => category === "all" || m.category === category)
    .filter((m) => search === "" || m.title.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      switch (sort) {
        case "volume": return b.volume_sats - a.volume_sats;
        case "newest": return b.created_at - a.created_at;
        case "ending_soon": return a.resolution_deadline - b.resolution_deadline;
        case "bettors": return b.num_bettors - a.num_bettors;
        default: return 0;
      }
    });

  if (selectedMarket) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="max-w-6xl mx-auto px-5 py-8">
          <MarketDetail market={selectedMarket} onBack={() => setSelectedMarket(null)} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-6xl mx-auto px-5 py-8">
        {/* Hero */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Prediction Markets</h1>
          <p className="text-muted-foreground text-sm">
            Bet on real-world outcomes with sats. No KYC. No bridges. Verified by TLSNotary.
          </p>
        </div>

        <StatsBar markets={MOCK_MARKETS} />

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
          {/* Category tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1 -mb-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                className={cn(
                  "shrink-0 px-3 h-8 rounded-lg text-xs font-medium transition-all duration-200",
                  category === cat.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 sm:ml-auto w-full sm:w-auto">
            {/* Search */}
            <div className="relative flex-1 sm:flex-initial">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search markets..."
                className="h-8 w-full sm:w-48 rounded-lg border border-border bg-muted pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
              />
            </div>

            {/* Sort */}
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="h-8 rounded-lg border border-border bg-muted px-2 text-xs text-foreground focus:outline-none focus:border-primary appearance-none cursor-pointer"
            >
              <option value="volume">Volume</option>
              <option value="newest">Newest</option>
              <option value="ending_soon">Ending Soon</option>
              <option value="bettors">Most Bettors</option>
            </select>
          </div>
        </div>

        {/* Market grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((market) => (
            <MarketCard
              key={market.id}
              market={market}
              onClick={() => setSelectedMarket(market)}
            />
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-lg mb-2">No markets found</p>
            <p className="text-sm">Try a different category or search term</p>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-16 pt-6 border-t border-border text-center text-xs text-muted-foreground">
          <p className="mb-1">
            Powered by <span className="text-primary font-medium">Anchr</span> — Cashu HTLC + Nostr + TLSNotary
          </p>
          <p>No Polygon. No USDC. No KYC. Just sats and math.</p>
        </footer>
      </main>
    </div>
  );
}
