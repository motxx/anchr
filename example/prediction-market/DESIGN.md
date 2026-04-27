# Design System — Kannagi (かんなぎ)

> Scope: this file governs the visual identity of the Prediction Market app at
> `example/prediction-market/`. It supersedes the root `DESIGN.md` for this
> directory only; other Anchr surfaces (Worker / Requester dashboards) keep
> their own systems.

## 1. Visual Theme & Atmosphere

**Kannagi** is named after the 2008 anime *かんなぎ* — the story of a shrine
spirit (Nagi) bound to a sacred tree at a small Japanese 神社. The visual
identity borrows directly from that world: a sunlit shrine on a quiet
afternoon, vermillion torii (朱) gates against shoji-paper walls, sakaki
greenery in the courtyard, the mint-aqua of Nagi's hair, the soft pink of
sakura and her ribbon.

Where the previous (Anchr / Nostr-purple) skin was a dark cypherpunk void,
Kannagi is **bright, warm, and traditional**. The page reads like washi paper
held up to morning light. Color is rare and ceremonial: vermillion for
anything sacred (CTAs, focus, the brand wordmark), mint for accents that
recall Nagi, sakaki green and crimson reserved exclusively for YES/NO
prediction outcomes.

**Key Characteristics**
- Warm shoji / washi-paper background (`#FBF6EC`) — never pure white
- Pure-white card surfaces float on the cream like shrine walls
- Single brand accent: shrine vermillion / 朱 (`#E63946`)
- Secondary accent: Nagi mint (`#5FCAB6`) — Nagi's hair color
- Prediction pair: sakaki green YES / deep crimson NO
- Inter for UI text, Geist Mono for numbers, **Shippori Mincho** for the
  "Kannagi" wordmark only — calligraphic mincho recalls shrine signage
- Conservative border-radius (8–12px) — polished but not bubbly
- Vermillion glow on hover/focus — subtle, never decorative

**Reference works**
- Anime *かんなぎ* (Kannagi: Crazy Shrine Maidens, 2008) — color story,
  shrine motifs, Nagi's mint hair + pink ribbon
- Polymarket — market card layout, probability bar mechanics
- Kalshi — light-theme data density, range-selector chart
- Real-world 神社 (Fushimi Inari, Yasaka) — torii vermillion, washi wall

## 2. Color Palette & Roles

### Primary — Shrine Vermillion (朱 / 鳥居の朱)
- **Vermillion** `#E63946` / `hsl(354, 78%, 56%)` — primary brand accent,
  CTAs, links, focus rings, brand wordmark. The singular interactive color.
- **Vermillion Hover** `#C8313A` / `hsl(355, 60%, 49%)` — darker for hover.
- **Vermillion Surface** `rgba(230, 57, 70, 0.10)` — tint for selected/active
  states and badges.

### Accent — Nagi Mint (ナギの髪)
- **Nagi Mint** `#5FCAB6` / `hsl(170, 49%, 58%)` — secondary indicator,
  decorative dots, "open / live" status, Nostr-channel chips.
- **Nagi Mint Surface** `rgba(95, 202, 182, 0.12)` — tinted background.

### Sakura (桜) — Reserved
- **Sakura Pink** `#FFA9C2` — soft accent for highlights, optional info
  badges. Used sparingly so vermillion stays the singular brand.

### Prediction Outcomes
- **YES — Sakaki Green** `#3FAB6E` / `hsl(145, 47%, 46%)` — the green of the
  sakaki (神道) branch placed at the shrine altar. Slightly more muted than
  generic emerald so it sits comfortably on cream.
- **YES Surface** `rgba(63, 171, 110, 0.12)`
- **YES Foreground (on green)** `#1A4D31` — dark forest text on YES bg.
- **NO — Deep Crimson** `#B8302E` / `hsl(1, 60%, 45%)` — distinctly deeper
  than brand vermillion so YES/NO chrome doesn't collide with the brand.
- **NO Surface** `rgba(184, 48, 46, 0.10)`
- **NO Foreground (on red)** `#FFFFFF` — white on crimson.

### Semantic
- **Warning Amber** `#F59E0B` — pending escrow, expiring soon.
- **Info — Nagi Mint** (`#5FCAB6`) — informational chips, Nostr connectivity.

### Neutrals (Warm Washi Progression)
| Token | Hex | HSL | Use |
|-------|-----|-----|-----|
| `--background` | `#FBF6EC` | `42 50% 96%` | Page background — shoji paper |
| `--card` | `#FFFFFF` | `0 0% 100%` | Card / panel surface — shrine wall |
| `--muted` | `#F1ECDF` | `42 38% 91%` | Elevated muted surface, input bg |
| `--border` | `#E5DCC4` | `42 32% 84%` | Borders, dividers, parchment |
| `--secondary` | `#E5DCC4` | `42 32% 84%` | Secondary surface |

### Text Hierarchy (4-tier — sumi ink)
| Token | Hex | HSL | Use |
|-------|-----|-----|-----|
| `--foreground` | `#1F1814` | `25 20% 10%` | Primary — sumi ink |
| `--secondary-foreground` | `#5C5040` | `30 18% 31%` | Secondary text |
| `--muted-foreground` | `#8C8270` | `36 12% 49%` | Tertiary — timestamps, metadata |
| Dim | `#B8B099` | `42 17% 66%` | Disabled, decorative |

### Borders
Default `hsl(42, 32%, 84%)` — soft parchment, near-invisible on washi but
provides structure. On hover, borders shift toward
`rgba(230, 57, 70, 0.40)` (vermillion at 40%). Focus rings use vermillion
at 30% opacity.

### Mode
**Light is the default and only mode.** Kannagi's atmosphere is
explicitly daylight-at-the-shrine; a dark mode would betray the source
material. The `.dark` selector is intentionally absent.

## 3. Typography Rules

### Font Families
- **Primary**: `Inter Variable` with `Zen Kaku Gothic New` as the JP fallback
  (proven for data density, supports both Latin and Kana with consistent
  optical sizing).
- **Mono**: `Geist Mono` (numbers, hashes, pubkeys).
- **Brand wordmark only**: `Shippori Mincho` — applied via the `.font-shrine`
  utility. Used for "Kannagi" itself; never for body or button text.
- **Loading**: Google Fonts —
  `https://fonts.googleapis.com/css2?family=Inter:wght@300..700&family=Geist+Mono:wght@400;500;600&family=Shippori+Mincho:wght@500;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap`

### Hierarchy
| Role | Font | Size | Weight | Letter-spacing | Use |
|------|------|------|--------|----------------|-----|
| Brand wordmark | Shippori Mincho | 20px | 700 | -0.01em | "Kannagi" header |
| Page Title | Inter | 30px | 700 | -0.03em | "Prediction Markets" |
| Section Heading | Inter | 20px | 600 | -0.02em | Panel titles |
| Market Title | Inter | 15px | 600 | -0.01em | Market question text |
| Body | Inter | 14px | 400 | normal | Descriptions |
| Body Small | Inter | 13px | 400 | normal | Secondary descriptions |
| Label | Inter | 12px | 500 | 0.05em, uppercase | Category, section labels |
| Caption | Inter | 11px | 400 | normal | Footnotes, helper text |
| Probability Large | Geist Mono | 36px | 700 | -0.02em | Detail YES/NO % |
| Probability Card | Geist Mono | 18px | 600 | -0.01em | Card YES/NO % |
| Data Value | Geist Mono | 14px | 500 | normal | Sat amounts, pool sizes |
| Data Label | Geist Mono | 12px | 400 | normal | Hashes, pubkeys |
| Stat Large | Geist Mono | 20px | 700 | normal | Stats bar numbers |

### Principles
- **Inter for UI text, Mincho only for the brand mark** — the contrast
  between modern sans and shrine mincho calligraphy is the visual hook.
- **Geist Mono for all numeric / cryptographic data** — sat amounts,
  probabilities, hashes, pubkeys, timestamps.
- **Tight tracking at display sizes** — negative letter-spacing on
  headings creates density and authority.
- **Uppercase labels only at 12px or below** — never uppercase body text.

## 4. Component Stylings

(See implementations in `ui/components/`. Notable Kannagi-specific
overrides relative to a generic light theme:)

- **Header brand block**: torii icon (鳥居 — two pillars + kasagi + nuki
  beams) on a `bg-primary/10` (vermillion-tinted) square; `font-shrine`
  wordmark beside it.
- **Bet buttons**: YES filled with sakaki `#3FAB6E`, dark-forest text;
  NO filled with crimson `#B8302E`, white text. Both sit on white card
  surfaces, so the saturated outcomes pop without needing glow.
- **Probability bar**: same dual-segment construction as before — sakaki
  left, crimson right — but on the new cream/white surface.
- **PriceChart**: vermillion hover-crosshair, line color flips between
  sakaki (trending up) and crimson (trending down).
- **Sparkline**: same trend-coloring logic; renders cleanly on white card.

## 5. Layout / 6. Depth / 7. Do's & Don'ts / 8. Responsive

Identical to the root system except:
- **Shadows**: warm tinted, not purple. Hover glow is
  `0 0 24px -6px rgba(230, 57, 70, 0.15)` (vermillion).
- **Don't** use vermillion as a large background fill — it's for accents,
  glows, and the brand mark only; large vermillion fills overwhelm the
  shrine atmosphere.
- **Don't** use dark mode overrides — Kannagi is a daylight system.

## 9. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-27 | Rebrand prediction-market app from Anchr → Kannagi | The user wanted a distinct identity for the prediction-market surface, separate from the underlying Anchr protocol. Kannagi (the anime) gives a clear, evocative palette + name. |
| 2026-04-27 | Adopt anime かんなぎ as design-token reference | Color story (vermillion / Nagi mint / sakura / sakaki) is iconic and well-suited to "shrine = oracle = TLSNotary verifier" metaphor. |
| 2026-04-27 | Light theme as default and only mode | The anime's atmosphere is explicitly daylight; a dark mode would betray the source material. Kalshi precedent shows light theme works for prediction markets. |
| 2026-04-27 | Shippori Mincho restricted to brand wordmark | Mincho is too heavy for body UI, but invokes shrine signage when used sparingly on the logo. Inter remains the workhorse. |
