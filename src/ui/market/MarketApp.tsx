import React, { useState, useEffect, useCallback } from "react";
import { CATEGORIES, type Market, type MarketCategory } from "./mock-data";
import { fetchMarkets, createMarket, type CreateMarketParams } from "./api";
import { Header } from "./components/Header";
import { StatsBar } from "./components/StatsBar";
import { MarketCard } from "./components/MarketCard";
import { MarketDetail } from "./components/MarketDetail";
import { cn } from "../lib/utils";

type SortMode = "volume" | "newest" | "ending_soon" | "bettors";

export function MarketApp() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [category, setCategory] = useState<MarketCategory | "all">("all");
  const [sort, setSort] = useState<SortMode>("volume");
  const [search, setSearch] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);

  const loadMarkets = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchMarkets();
      setMarkets(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load markets");
      setMarkets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMarkets();
  }, [loadMarkets]);

  const handleMarketCreated = useCallback(() => {
    setShowCreateForm(false);
    loadMarkets();
  }, [loadMarkets]);

  const handleBetPlaced = useCallback(() => {
    loadMarkets();
  }, [loadMarkets]);

  const handleSelectMarket = useCallback((market: Market) => {
    setSelectedMarket(market);
  }, []);

  // When returning from detail, refresh to get latest data
  const handleBack = useCallback(() => {
    setSelectedMarket(null);
    loadMarkets();
  }, [loadMarkets]);

  const filtered = markets
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
          <MarketDetail
            market={selectedMarket}
            onBack={handleBack}
            onBetPlaced={handleBetPlaced}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="max-w-6xl mx-auto px-5 py-8">
        {/* Hero */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Prediction Markets</h1>
            <p className="text-muted-foreground text-sm">
              Bet on real-world outcomes with sats. No KYC. No bridges. Verified by TLSNotary.
            </p>
          </div>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="shrink-0 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            {showCreateForm ? "Cancel" : "+ Create Market"}
          </button>
        </div>

        {/* Create Market Form */}
        {showCreateForm && (
          <CreateMarketForm
            onCreated={handleMarketCreated}
            onCancel={() => setShowCreateForm(false)}
          />
        )}

        <StatsBar markets={markets} />

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

        {/* Loading state */}
        {loading && (
          <div className="text-center py-16">
            <div className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-muted-foreground text-sm">Loading markets...</p>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 mb-6 text-center">
            <p className="text-sm text-destructive mb-3">{error}</p>
            <button
              onClick={() => { setLoading(true); loadMarkets(); }}
              className="h-8 px-4 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Market grid */}
        {!loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((market) => (
              <MarketCard
                key={market.id}
                market={market}
                onClick={() => handleSelectMarket(market)}
              />
            ))}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-lg mb-2">No markets found</p>
            <p className="text-sm">
              {markets.length === 0
                ? "No markets exist yet. Create the first one!"
                : "Try a different category or search term"}
            </p>
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

/* ------------------------------------------------------------------ */
/* Create Market Form                                                  */
/* ------------------------------------------------------------------ */

interface CreateMarketFormProps {
  onCreated: () => void;
  onCancel: () => void;
}

function CreateMarketForm({ onCreated, onCancel }: CreateMarketFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryVal, setCategoryVal] = useState<MarketCategory>("crypto");
  const [resolutionUrl, setResolutionUrl] = useState("");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [minBetSats, setMinBetSats] = useState("100");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim() || !resolutionUrl.trim() || !deadlineDate) return;

    setSubmitting(true);
    setSubmitError(null);

    const params: CreateMarketParams = {
      title: title.trim(),
      description: description.trim(),
      category: categoryVal,
      resolution_url: resolutionUrl.trim(),
      resolution_deadline: Math.floor(new Date(deadlineDate).getTime() / 1000),
      min_bet_sats: parseInt(minBetSats) || 100,
    };

    try {
      await createMarket(params);
      onCreated();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create market");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-card p-6 mb-8">
      <h2 className="text-sm font-medium text-foreground mb-4 uppercase tracking-wider">Create New Market</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Title */}
          <div className="sm:col-span-2">
            <label className="text-xs text-muted-foreground block mb-1.5">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Will BTC exceed $200K by end of 2026?"
              required
              className="w-full h-9 rounded-lg border border-border bg-muted px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>

          {/* Description */}
          <div className="sm:col-span-2">
            <label className="text-xs text-muted-foreground block mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the resolution criteria clearly..."
              required
              rows={3}
              className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 resize-none"
            />
          </div>

          {/* Category */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Category</label>
            <select
              value={categoryVal}
              onChange={(e) => setCategoryVal(e.target.value as MarketCategory)}
              className="w-full h-9 rounded-lg border border-border bg-muted px-3 text-sm text-foreground focus:outline-none focus:border-primary appearance-none cursor-pointer"
            >
              <option value="crypto">Crypto</option>
              <option value="economics">Economics</option>
              <option value="politics">Politics</option>
              <option value="sports">Sports</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          {/* Resolution URL */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Resolution URL</label>
            <input
              type="url"
              value={resolutionUrl}
              onChange={(e) => setResolutionUrl(e.target.value)}
              placeholder="https://api.example.com/data"
              required
              className="w-full h-9 rounded-lg border border-border bg-muted px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>

          {/* Deadline */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Resolution Deadline</label>
            <input
              type="datetime-local"
              value={deadlineDate}
              onChange={(e) => setDeadlineDate(e.target.value)}
              required
              className="w-full h-9 rounded-lg border border-border bg-muted px-3 text-sm text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>

          {/* Min Bet */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Min Bet (sats)</label>
            <input
              type="number"
              value={minBetSats}
              onChange={(e) => setMinBetSats(e.target.value)}
              min={1}
              placeholder="100"
              className="w-full h-9 rounded-lg border border-border bg-muted px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>
        </div>

        {submitError && (
          <p className="text-sm text-destructive">{submitError}</p>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting || !title.trim() || !description.trim() || !resolutionUrl.trim() || !deadlineDate}
            className="h-9 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "Creating..." : "Create Market"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="h-9 px-4 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
