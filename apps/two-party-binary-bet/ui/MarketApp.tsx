import React, { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CATEGORIES, type Market, type MarketCategory } from "./mock-data.ts";
import {
  type ConditionType,
  createMarket,
  type CreateMarketParams,
  fetchMarkets,
} from "./api.ts";
import { Header } from "./components/Header.tsx";
import { StatsBar } from "./components/StatsBar.tsx";
import { MarketCard } from "./components/MarketCard.tsx";
import { MarketDetail } from "./components/MarketDetail.tsx";
import { FeaturedMarket } from "./components/FeaturedMarket.tsx";
import { SakuraBurst } from "./components/SakuraBurst.tsx";
import { trendingScore } from "./lib/market-history.ts";
import { cn } from "./lib/utils.ts";

type SortMode = "trending" | "popular" | "newest" | "ending_soon" | "volume";

const SORT_TABS: { key: SortMode; label: string }[] = [
  { key: "trending", label: "Trending" },
  { key: "popular", label: "Popular" },
  { key: "newest", label: "New" },
  { key: "ending_soon", label: "Ending Soon" },
  { key: "volume", label: "Volume" },
];

function filterAndSort(
  markets: Market[],
  category: MarketCategory | "all",
  search: string,
  sort: SortMode,
): Market[] {
  const q = search.trim().toLowerCase();
  const matched = markets
    .filter((m) => category === "all" || m.category === category)
    .filter((m) => q === "" || m.title.toLowerCase().includes(q));
  return matched.sort((a, b) => {
    switch (sort) {
      case "trending":
        return trendingScore(b) - trendingScore(a);
      case "popular":
        return b.num_bettors - a.num_bettors;
      case "newest":
        return b.created_at - a.created_at;
      case "ending_soon":
        return a.resolution_deadline - b.resolution_deadline;
      case "volume":
        return b.volume_sats - a.volume_sats;
      default:
        return 0;
    }
  });
}

function pickFeatured(markets: Market[]): Market | null {
  const open = markets.filter((m) => m.status === "open");
  if (open.length === 0) return null;
  return [...open].sort((a, b) => trendingScore(b) - trendingScore(a))[0];
}

/** Read the market id from the current URL (`/m/<id>`), or null for list. */
function readMarketIdFromPath(): string | null {
  if (typeof window === "undefined") return null;
  const m = globalThis.location.pathname.match(/^\/m\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function pushList() {
  if (globalThis.location.pathname !== "/") {
    globalThis.history.pushState(null, "", "/");
  }
}

function pushMarket(id: string) {
  const target = `/m/${encodeURIComponent(id)}`;
  if (globalThis.location.pathname !== target) {
    globalThis.history.pushState(null, "", target);
  }
}

export function MarketApp() {
  const queryClient = useQueryClient();
  // Initialize from URL so deep links (and reloads) land in the right view.
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(
    () => readMarketIdFromPath(),
  );
  const [category, setCategory] = useState<MarketCategory | "all">("all");
  const [sort, setSort] = useState<SortMode>("trending");
  const [search, setSearch] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  // Bumped each time a bet is placed or a market resolves — fires SakuraBurst.
  const [sakuraTrigger, setSakuraTrigger] = useState(0);

  // Sync with the browser URL — back/forward buttons + swipe-back on
  // mobile both fire popstate. This is a genuine external-system sync,
  // so useEffect is the right tool.
  useEffect(() => {
    const onPopState = () => setSelectedMarketId(readMarketIdFromPath());
    globalThis.addEventListener("popstate", onPopState);
    return () => globalThis.removeEventListener("popstate", onPopState);
  }, []);

  const openMarket = (id: string) => {
    pushMarket(id);
    setSelectedMarketId(id);
  };
  const closeMarket = () => {
    pushList();
    setSelectedMarketId(null);
  };

  // Markets are an external resource — React Query owns the cache, retries,
  // refetch-on-focus, and re-renders. No useEffect needed.
  const marketsQuery = useQuery({
    queryKey: ["markets"],
    queryFn: () => fetchMarkets(),
  });
  const markets = marketsQuery.data ?? [];

  const invalidateMarkets = () =>
    queryClient.invalidateQueries({ queryKey: ["markets"] });

  // Derived during render — no state, no effect.
  const filtered = filterAndSort(markets, category, search, sort);
  const featured = pickFeatured(markets);
  const selectedMarket = selectedMarketId
    ? markets.find((m) => m.id === selectedMarketId) ?? null
    : null;

  if (selectedMarketId) {
    return (
      <div className="min-h-screen overflow-x-clip">
        <SakuraBurst trigger={sakuraTrigger} />
        <Header onLogoClick={closeMarket} />
        <main className="max-w-6xl mx-auto px-4 sm:px-5 py-6 sm:py-8">
          {selectedMarket
            ? (
              <MarketDetail
                market={selectedMarket}
                onBack={() => {
                  closeMarket();
                  invalidateMarkets();
                }}
                onBetPlaced={() => {
                  invalidateMarkets();
                  setSakuraTrigger((v) => v + 1);
                }}
              />
            )
            : marketsQuery.isPending
            ? (
              <div className="text-center py-16">
                <div className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-muted-foreground text-sm">Loading…</p>
              </div>
            )
            : (
              <div className="text-center py-16">
                <p className="text-lg text-foreground mb-2">Market not found</p>
                <p className="text-sm text-muted-foreground mb-4">
                  <span className="font-mono">{selectedMarketId}</span>{" "}
                  doesn't match any open market.
                </p>
                <button
                  onClick={closeMarket}
                  className="h-9 px-4 rounded-md border border-border text-sm font-semibold text-foreground hover:bg-muted transition-colors"
                >
                  ← All markets
                </button>
              </div>
            )}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-clip">
      <SakuraBurst trigger={sakuraTrigger} />
      <Header />

      <main className="max-w-6xl mx-auto px-4 sm:px-5 py-6 sm:py-8">
        {
          /* Hero — the page lands directly on the create CTA. No redundant
         * tagline or stats above the featured market. */
        }
        <div className="flex items-center justify-end mb-5">
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="h-10 px-5 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            {showCreateForm ? "Cancel" : "Create market"}
          </button>
        </div>

        {showCreateForm && (
          <CreateMarketForm
            onCreated={() => {
              setShowCreateForm(false);
              invalidateMarkets();
            }}
            onCancel={() => setShowCreateForm(false)}
          />
        )}

        {/* Featured */}
        {featured && !showCreateForm && (
          <FeaturedMarket
            market={featured}
            onClick={() => openMarket(featured.id)}
          />
        )}

        {/* Sort tabs (Polymarket-style) */}
        <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-1 -mb-1">
          {SORT_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setSort(t.key)}
              className={cn(
                "shrink-0 px-4 h-9 rounded-full text-sm font-semibold transition-colors",
                sort === t.key
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Category + search */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-6">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mb-1 min-w-0 max-w-full">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setCategory(cat.value)}
                className={cn(
                  "shrink-0 px-3 h-8 rounded-full text-xs font-semibold transition-colors",
                  category === cat.value
                    ? "bg-foreground text-background"
                    : "text-muted-foreground bg-card border border-border hover:text-foreground hover:border-foreground/30",
                )}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="relative flex-1 sm:flex-initial sm:ml-auto w-full sm:w-auto">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search markets…"
              className="h-9 w-full sm:w-64 rounded-full border border-border bg-card pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
            />
          </div>
        </div>

        {/* Loading state */}
        {marketsQuery.isPending && (
          <div className="text-center py-16">
            <div className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-muted-foreground text-sm">Loading markets…</p>
          </div>
        )}

        {/* Error state */}
        {marketsQuery.isError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 mb-6 text-center">
            <p className="text-sm text-destructive mb-3">
              {marketsQuery.error instanceof Error
                ? marketsQuery.error.message
                : "Failed to load markets"}
            </p>
            <button
              onClick={() => marketsQuery.refetch()}
              className="h-8 px-4 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Market grid — 1-up mobile, 2-up tablet, 3-up xl */}
        {marketsQuery.isSuccess && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((market) => (
              <MarketCard
                key={market.id}
                market={market}
                onClick={() => openMarket(market.id)}
              />
            ))}
          </div>
        )}

        {/* StatsBar — moved below the fold; aggregates aren't the headline */}
        {marketsQuery.isSuccess && markets.length > 0 && (
          <div className="mt-10">
            <StatsBar markets={markets} />
          </div>
        )}

        {marketsQuery.isSuccess && filtered.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-lg mb-2">No markets found</p>
            <p className="text-sm">
              {markets.length === 0
                ? "No markets exist yet. Create the first one!"
                : "Try a different category or search term"}
            </p>
          </div>
        )}

        {/* Footer — neutral, no decorative chrome */}
        <footer className="mt-16 pt-6 border-t border-border text-center text-xs text-muted-foreground">
          <p>
            <span className="font-shrine text-foreground/80">
              Two-party binary bet
            </span>
            <span className="text-muted-foreground/70 ml-2">
              testnet reference
            </span>
          </p>
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
  const [conditionType, setConditionType] = useState<ConditionType>(
    "jsonpath_gt",
  );
  const [jsonpath, setJsonpath] = useState("");
  const [threshold, setThreshold] = useState("");
  const [expectedText, setExpectedText] = useState("");
  const [minBetSats, setMinBetSats] = useState("100");

  const needsJsonpath = [
    "jsonpath_gt",
    "jsonpath_lt",
    "jsonpath_equals",
    "price_above",
    "price_below",
  ].includes(conditionType);
  const needsThreshold = [
    "jsonpath_gt",
    "jsonpath_lt",
    "price_above",
    "price_below",
  ].includes(conditionType);
  const needsExpectedText = ["jsonpath_equals", "contains_text"].includes(
    conditionType,
  );

  const createMutation = useMutation({
    mutationFn: createMarket,
    onSuccess: () => onCreated(),
  });
  const submitting = createMutation.isPending;
  const submitError = createMutation.error instanceof Error
    ? createMutation.error.message
    : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !title.trim() || !description.trim() || !resolutionUrl.trim() ||
      !deadlineDate
    ) return;
    const params: CreateMarketParams = {
      title: title.trim(),
      description: description.trim(),
      category: categoryVal,
      resolution_url: resolutionUrl.trim(),
      resolution_condition: {
        type: conditionType,
        ...(needsJsonpath && jsonpath.trim()
          ? { jsonpath: jsonpath.trim() }
          : {}),
        ...(needsThreshold && threshold
          ? { threshold: parseFloat(threshold) }
          : {}),
        ...(needsExpectedText && expectedText.trim()
          ? { expected_text: expectedText.trim() }
          : {}),
        description: title.trim(),
      },
      resolution_deadline: Math.floor(new Date(deadlineDate).getTime() / 1000),
      min_bet_sats: parseInt(minBetSats) || 100,
    };
    createMutation.mutate(params);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5 sm:p-6 mb-6">
      <h2 className="text-sm font-medium text-foreground mb-4 uppercase tracking-wider">
        Create New Market
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Title */}
          <div className="sm:col-span-2">
            <label className="text-xs text-muted-foreground block mb-1.5">
              Title
            </label>
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
            <label className="text-xs text-muted-foreground block mb-1.5">
              Description
            </label>
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
            <label className="text-xs text-muted-foreground block mb-1.5">
              Category
            </label>
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
            <label className="text-xs text-muted-foreground block mb-1.5">
              Resolution URL
            </label>
            <input
              type="url"
              value={resolutionUrl}
              onChange={(e) => setResolutionUrl(e.target.value)}
              placeholder="https://api.example.com/data"
              required
              className="w-full h-9 rounded-lg border border-border bg-muted px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </div>

          {/* Resolution Condition */}
          <div className="sm:col-span-2 rounded-lg border border-border bg-muted/50 p-4 space-y-3">
            <label className="text-xs text-muted-foreground block font-medium uppercase tracking-wider">
              Resolution Condition (YES if...)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1">
                  Type
                </label>
                <select
                  value={conditionType}
                  onChange={(e) =>
                    setConditionType(e.target.value as ConditionType)}
                  className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus:border-primary appearance-none cursor-pointer"
                >
                  <option value="jsonpath_gt">JSON value &gt; threshold</option>
                  <option value="jsonpath_lt">JSON value &lt; threshold</option>
                  <option value="jsonpath_equals">JSON value = expected</option>
                  <option value="contains_text">Body contains text</option>
                  <option value="price_above">Price above</option>
                  <option value="price_below">Price below</option>
                </select>
              </div>
              {needsJsonpath && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">
                    JSON Path
                  </label>
                  <input
                    type="text"
                    value={jsonpath}
                    onChange={(e) => setJsonpath(e.target.value)}
                    placeholder="best_bid, data.price, etc."
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              )}
              {needsThreshold && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">
                    Threshold
                  </label>
                  <input
                    type="number"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                    placeholder="15000000"
                    step="any"
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              )}
              {needsExpectedText && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">
                    Expected Text
                  </label>
                  <input
                    type="text"
                    value={expectedText}
                    onChange={(e) => setExpectedText(e.target.value)}
                    placeholder="Expected string or value"
                    className="w-full h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Oracle fetches the Resolution URL via TLSNotary, then evaluates
              this condition against the response.
            </p>
          </div>

          {/* Deadline */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">
              Resolution Deadline
            </label>
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
            <label className="text-xs text-muted-foreground block mb-1.5">
              Min Bet (sats)
            </label>
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
            disabled={submitting || !title.trim() || !description.trim() ||
              !resolutionUrl.trim() || !deadlineDate}
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
