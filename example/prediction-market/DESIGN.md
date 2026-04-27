# Design System — Kannagi (かんなぎ)

> Scope: this file governs the visual identity of the Prediction Market app
> at `example/prediction-market/`. It supersedes the root `DESIGN.md` for
> this directory only.

## 1. Atmosphere

**Kannagi** is a Bitcoin-native prediction market. The product is a
financial-decision tool — users compare percentages, sat amounts, and
volumes vertically all day — so the chrome stays out of the way. The brand
expresses itself in three places only:

1. The **wordmark** in the header (Klee One mincho + the kana subline).
2. The **torii** glyph next to it.
3. The **resolve / bet-fill moment** — sakura petals fall briefly when the
   user commits a bet or a market resolves. 神和ぎ (kannagi) means
   "spirit-pacifying"; the petals fall when the outcome is decided.

Outside those three moments, the canvas is silent: warm shoji-paper cream,
sumi-ink type, single coral primary on CTAs and focus rings. No background
patterns, no decorative motifs, no constant petals.

**Key characteristics**
- Light, warm, calm — Polymarket-style restraint with a Japanese accent
- Sumi ink (`#251F18`) on shoji-paper cream (`#FBF6EC`)
- Single brand accent: sakura coral `#FF6B85`, ONLY on primary actions and
  focus rings
- Outcome pair: pastel sakaki green YES / vermillion NO (domain colors,
  never decorative)
- Inter for all UI text; Klee One restricted to the brand wordmark; Geist
  Mono for every numeric value (sats, %, hashes)
- Card radius 15px (the designer's sweet spot — Polymarket 8 feels cheap,
  Kalshi 6 feels banky, our 15 keeps "Kannagi" without infantilizing)

**Reference works**
- The 2008 anime *かんなぎ* — naming + the resolve-moment sakura motif
- Polymarket — featured hero, sort tabs, market-card information density
- Kalshi — light-theme calm, restrained shadows, mobile-first sticky bet bar

## 2. Color Palette & Roles

### Primary — Sakura Coral (桜珊瑚)
- **Coral** `#FF6B85` / `hsl(350, 100%, 71%)` — primary CTA, focus ring,
  brand wordmark color when needed. The singular interactive accent.
- **Coral hover** `~#FF4F6E` — slight darken on hover via `hover:bg-primary/90`.

**Discipline rule (binding):** Coral appears on a pixel only if that pixel
is (a) a primary action button, (b) a focus ring, or (c) the Kannagi
wordmark / footer mention. Nowhere else. No decorative pills, no coral
shadows, no coral hover lifts on cards. If you reach for coral elsewhere,
use `text-foreground` or `bg-foreground` instead.

### Outcomes — Domain Colors
- **YES — Sakaki Green** `#5FBFA0` / `hsl(165, 45%, 56%)` — pastel sakaki
  pine. Distinctive vs. every emerald-green competitor.
- **YES Foreground** `#1A4D31` — dark forest text on green bg.
- **NO — Vermillion** `#E63946` / `hsl(354, 78%, 56%)` — torii red, deeper
  than the coral primary so it's clearly a different signal.
- **NO Foreground** `#FFFFFF` — white on vermillion bg.

### Neutrals — Warm Washi Progression
| Token | Hex | HSL | Use |
|-------|-----|-----|-----|
| `--background` | `#FBF6EC` | `42 50% 96%` | Page background — shoji paper |
| `--card` | `#FFFFFF` | `0 0% 100%` | Cards, panels — shrine wall |
| `--muted` | `#F1ECDF` | `42 38% 92%` | Inputs, muted surfaces |
| `--border` | `#E5DCC4` | `42 28% 86%` | Borders, dividers |

A single 240px-tall top-vignette (`rgba(255, 200, 210, 0.06)`) keeps the
canvas from reading as "unfinished Polymarket clone." No radial washes,
no scattered ambient gradients.

### Text Hierarchy (Sumi Ink)
| Token | Hex | HSL | Use |
|-------|-----|-----|-----|
| `--foreground` | `#251F18` | `25 22% 12%` | Primary — sumi ink |
| `--muted-foreground` | `#837A6F` | `30 12% 46%` | Secondary text, labels |

## 3. Typography

### Families
- **UI text**: Inter (with `Zen Kaku Gothic New` JP fallback). Proven for
  data density and tabular numerics.
- **Brand wordmark only**: Klee One (`.font-shrine`). Used for "Kannagi"
  in the header and footer. Never on body text or buttons.
- **Numeric data**: Geist Mono. Sat amounts, percentages, hashes, pubkeys,
  durations — everything the user might compare vertically.

### Loading
```
https://fonts.googleapis.com/css2?family=Inter:wght@300..700&family=Geist+Mono:wght@400;500;600&family=Klee+One:wght@400;600&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap
```

### Scale
| Role | Font | Size | Weight | Use |
|------|------|------|--------|-----|
| Brand wordmark | Klee One | 20px | 600 | Header "Kannagi" |
| Page Title (rare) | Inter | 24-30px | 700 | Detail-page title only |
| Section heading | Inter | 14px | 600 | Card headers |
| Body | Inter | 14px | 400 | Descriptions |
| Label | Inter | 11–12px | 500 | Uppercase, tracking-wider |
| Probability Large | Geist Mono | 36–48px | 700 | Featured % |
| Probability Card | Geist Mono | 18px | 600 | Card YES/NO % |
| Data | Geist Mono | 12–14px | 500 | Sats, volumes, percentages |

## 4. Radius Scale

| Token | Px | Use |
|-------|----|-----|
| `--radius-sm` | 6px | Pills, small badges, inline tags |
| `--radius-md` | 10px | Buttons, inputs, side selectors |
| `--radius-lg` | 15px | Cards, panels (default `--radius`) |
| `--radius-xl` | 18px | Featured / hero cards (rare) |
| `--radius-pill` | 9999px | Sort tabs, search, wallet pill |

Polymarket lives at 8px and feels generic; Kalshi at 6px and feels banky;
Kannagi sits at 15px — recognizable without being toy.

## 5. Layout

### Grid
- Max content width 1152px (`max-w-6xl`)
- Markets grid: 1-up mobile → 2-up tablet → 3-up xl
- Detail page: 3-col grid on `lg`. Chart top-left (cols 1–2), bet panel
  rows 1–2 col 3 (sticky), rest of left column rows 2 cols 1–2
- **Mobile reorder**: bet panel comes after the Chart in DOM order, before
  Activity / TopHolders / About. This puts the buy CTA above the fold even
  without sticky chrome.

### Spacing
- Base unit 4px
- Card padding 20px desktop, 16px mobile
- Card gap 16-20px
- Above-the-fold: Header → Create-market button → Featured market →
  Sort tabs → Category + search → Grid. **No StatsBar above the fold;**
  it lives below the grid as quick context.

## 6. Motion

Default: nothing animates. Specifically excluded:
- No constant background drift (no falling petals as wallpaper)
- No hover lifts on cards
- No glow shadows
- No entrance animations

Allowed:
- Probability bar width transition on data change (500ms)
- PriceChart line width / range-selector pill state change
- **Sakura burst** — fired once when (a) `placeBetMutation.isSuccess` or
  (b) market `status` transitions to `resolved_*`. 36 petals fall over
  ~9s, then unmount. This is the brand's only ambient motion, and it earns
  its presence by mapping to a meaningful event.
- `prefers-reduced-motion` disables the sakura burst entirely

## 7. Do's and Don'ts

### Do
- Render every numeric value in `font-mono`
- Use `bg-foreground text-background` for active sort/category pills
- Use `bg-yes` / `bg-no` only for prediction outcomes (buttons, badges,
  resolved states, sparkline trend color)
- Truncate hashes / pubkeys with `…` and surface full value in `title`
- Land the user on the Featured market — let it carry the hero

### Don't
- Don't add a coral hover glow, coral pill background, or coral underline
- Don't render numbers in Inter (use Geist Mono)
- Don't run sakura petals on the page background
- Don't use `rounded-2xl` / `rounded-3xl` on cards (15px is the cap)
- Don't add "Verified by TLSNotary" or other technical chrome to user-facing
  copy unless the user is acting on it
- Don't put a Page Title above the Featured market — Kannagi *is* the
  prediction-market platform; the header already says that

## 8. Mobile

Phones are the primary surface (60%+ of prediction-market traffic).
- Header height 56px, pubkey pill hidden under `md`
- Cards 1-up at all mobile widths
- Bet panel reorder on detail (described in §5) is the most important
  conversion fix — it puts the CTA in the user's first scroll
- All tap targets ≥ 36px (sort tabs h-9, buttons h-10/h-11, side
  selectors h-11)
- Category pill row scrolls horizontally; bleed past page padding via
  `-mx-4 px-4` so the first/last pill don't get clipped

## 9. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-27 | Rebrand from Anchr → Kannagi | Distinct identity for the prediction-market surface, separate from the underlying protocol. |
| 2026-04-27 | Light theme as the only mode | The anime's atmosphere is daylight; dark mode would betray the source. Kalshi precedent shows light works for prediction markets. |
| 2026-04-27 | Klee One restricted to the brand wordmark | Mincho is too heavy for body UI; Inter does the dense work. Klee earns its presence by appearing twice (header + footer). |
| 2026-04-27 | Sakura coral `#FF6B85` as the only brand color | Replaces the earlier vermillion. Softer, less ceremonial; pairs with the kawaii-but-not-noisy direction. |
| 2026-04-27 | Sakura on background → resolve / bet-fill moment | Designer review: the field was visual noise. Resolving the brand to an event-triggered burst maps the petal motif to its meaning (神和ぎ = ritual completion). |
| 2026-04-27 | Card radius 15px | Designer review: Polymarket 8 felt cheap, Kalshi 6 felt banky. 15 keeps Kannagi's softness without infantilizing. |
| 2026-04-27 | Mobile bet-panel reorder | Designer flagged "audit at 390px before touching anything else." Bet panel was at the bottom of the mobile detail page, killing conversion. Reordered grid placement so it sits right after the chart on mobile, sticky right-column on desktop. |
| 2026-04-27 | Drop hero "Prediction Markets / 予想市場" subtitle | Kannagi *is* the platform; the header already names it. Page lands on the create-market CTA, then Featured. |
