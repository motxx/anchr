# Design System — Anchr

## Product Context
- **What this is:** Decentralized marketplace for cryptographically verified data, paid with Bitcoin
- **Who it's for:** AI agents and developers buying verified API responses, price feeds, and real-world photos; workers earning sats by producing TLSNotary and C2PA proofs
- **Space/industry:** Crypto data oracles, decentralized verification, Bitcoin-native tools
- **Project type:** Data-dense web app (three dashboards: Worker, Requester, E2E monitoring)

## Aesthetic Direction
- **Direction:** Findexa-inspired — premium dark finance dashboard
- **Decoration level:** Minimal — typography, spacing, and subtle depth do the work. No gradients, no blobs, no decorative elements. The data IS the decoration.
- **Mood:** A polished finance dashboard where real money moves. Trustworthy, data-dense, premium. Blue-tinted darks create depth without decoration. The UI should feel like a high-end financial instrument — serious enough for Bitcoin transactions, refined enough to use for hours.
- **Reference sites:** Findexa Finance Dashboard on layers.to (dark finance UI, blue accent, data density), mempool.space (crypto data density), Cashu (cypherpunk minimalism)

## Typography
- **Primary:** Inter Variable — proven for data-dense UIs, tabular nums support, clean at small sizes. The reliable choice for developer tools handling financial data.
- **Mono:** Geist Mono — excellent for hashes, pubkeys, sat amounts. Pairs well with Inter.
- **UI/Labels:** Inter 600 weight, 11px, uppercase, tracking 0.08em
- **Data/Tables:** Geist Mono — tabular-nums for sat amounts, hashes, pubkeys, timestamps
- **Code:** Geist Mono
- **Loading:** Google Fonts `https://fonts.googleapis.com/css2?family=Inter:wght@300..700&family=Geist+Mono:wght@400;500;600&display=swap`
- **Font stack:** `"Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`
- **Scale:**
  - 32px / 700 / -0.03em tracking — page titles, balance amounts
  - 22px / 600 / -0.02em tracking — section headings
  - 16px / 500 — subheadings
  - 14px / 400 / line-height 1.6 — body text
  - 11px / 600 / tracking 0.08em / uppercase — labels, captions
  - 13px mono — data, hashes, amounts

## Color
- **Approach:** Restrained — one brand accent + semantic status colors, color is rare and meaningful
- **Brand accent (blue):** `#3B82F6` / `hsl(217, 91%, 60%)` — primary interactive elements, focus rings, CTAs, charts. A vibrant, trustworthy blue that reads well on dark backgrounds.
- **Accent background:** `rgba(59, 130, 246, 0.12)` — subtle highlight for selected/active states
- **Semantic status colors** (unchanged from domain semantics):
  - **Verified/Success (emerald):** `#22C55E` — verified, earned, success, the loudest positive signal
  - **Requester (blue):** `#60A5FA` — requester identity, wallet, queries
  - **Escrow/Warning (amber):** `#F59E0B` — money locked, action needed, pending states
  - **Error (red):** `#EF4444` — verification failed, rejected, destructive actions
- **Neutrals (blue-tinted dark progression):**
  - `#0B0D12` — deepest background (`hsl(223, 25%, 6%)`)
  - `#141620` — surface / cards (`hsl(230, 23%, 10%)`)
  - `#1A1D28` — elevated surface / muted (`hsl(227, 21%, 13%)`)
  - `#1F2230` — hover state, borders, secondary (`hsl(229, 22%, 15%)`)
  - `#282C3A` — active/selected (`hsl(228, 20%, 19%)`)
- **Text hierarchy (4-tier):**
  - `#F1F5F9` — primary text (`hsl(210, 40%, 96%)`) — cool white
  - `#94A3B8` — secondary text (`hsl(215, 20%, 65%)`)
  - `#64748B` — tertiary / muted text (`hsl(215, 16%, 47%)`)
  - `#475569` — dim text (`hsl(215, 19%, 35%)`)
- **Borders:** Subtle blue-tinted borders matching surface scale. CSS var uses `hsl(229, 22%, 15%)` — near-invisible on dark but provides structure.
- **Semantic backgrounds:** Each status color has a 10% opacity background variant for badges, alerts, and highlight regions (e.g., `rgba(34, 197, 94, 0.10)`)
- **Dark mode:** Default and primary. All values above are dark mode.
- **Light mode:** Invert neutral scale — `#FFFFFF` deepest, `#F8FAFC` surface, borders `#E2E8F0`, primary text `#0F172A`. Accent and semantic colors remain the same.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable — tighter than typical SaaS, appropriate for data-dense dashboards
- **Scale:** 2px / 4px / 8px / 12px / 16px / 24px / 32px / 48px / 64px

## Layout
- **Approach:** Grid-disciplined — strict columns, predictable alignment
- **Grid:** 3 columns for dashboard views, 1-2 columns for forms and detail views
- **Max content width:** 1440px
- **Border radius:** SaaS-polished — `12px` for cards/panels, `8px` for buttons/inputs, `6px` for badges, `4px` for micro elements.
  - CSS: `--radius: 0.75rem` (12px base), with `sm: 8px`, `md: 10px`, `lg: 12px`, `xl: 16px`

## Motion
- **Approach:** Minimal-functional — only transitions that aid comprehension
- **Easing:** enter: ease-out, exit: ease-in, move: ease-in-out
- **Duration:** micro: 120ms (hover, focus), short: 200ms (panel transitions), medium: 350ms (page-level)
- **Hover transitions:** Smooth background-color transitions on interactive elements
- **Rules:** No decorative animation. No entrance animations on page load. Scroll-driven animations only if they clarify data relationships.

## Component Patterns

### Status Badges
Mono, 10px, 600 weight. Background uses semantic color at 10% opacity, text uses full semantic color. Border radius 6px.
- `awaiting_quotes` — blue
- `processing` — amber
- `approved` — emerald
- `rejected` — red

### Actor Avatars
20px circle with actor initial (R/W/O/S), colored by role:
- Requester: blue `#60A5FA`
- Worker: emerald `#22C55E`
- Oracle: blue `#60A5FA`
- System: amber `#F59E0B`

### Balance Cards
Bordered panel with semantic color border at 20% opacity and background at 10% opacity. Balance amount in Geist Mono, 32px, bold. Unit label ("sats") in 11px muted. Border radius 12px.

### Data Display
All cryptographic data (hashes, pubkeys, token IDs) in Geist Mono. Truncate with ellipsis for display. Full value on hover/click. Labels in 10px dim uppercase.

### Interactive Elements
- **Buttons:** Brand blue `#3B82F6` for primary actions, secondary uses `hsl(229, 22%, 15%)` surface
- **Focus rings:** Brand blue at 50% opacity, 2px offset
- **Hover states:** Smooth 120ms transition to elevated surface color

### Alerts
Bordered box with semantic background at 10% opacity, semantic border at 20% opacity, text in full semantic color. 12px, 500 weight. Border radius 8px.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-31 | Initial design system created | Industrial/utilitarian direction chosen to differentiate from corporate crypto, academic protocol, and cypherpunk minimal aesthetics. |
| 2026-03-31 | No purple policy | Purple is the most overused color in crypto UI. Oracle actor color changed from purple to blue. |
| 2026-03-31 | Geist typeface selected | Originally chosen for data-dense interfaces with native monospace variant. |
| 2026-03-31 | Ultra-tight type scale (11-28px) | Density play for workers scanning queries and requesters checking proofs. |
| 2026-03-31 | Linear-inspired redesign | Switched to Linear-inspired direction. Inter Variable replaced Geist for body. Brand accent changed from emerald to indigo. Neutral scale updated to near-black. Border radius tightened to 6px. |
| 2026-03-31 | **Findexa-inspired redesign** | Switched from Linear-inspired to Findexa Finance Dashboard direction (layers.to). Findexa is the best fit: dark finance dashboard, data-dense, blue accent on blue-tinted darks, SaaS-polished radius. Brand accent changed from indigo `#5E6AD2` to bright blue `#3B82F6`. Neutral scale updated from pure neutral to blue-tinted dark (`#0B0D12` → `#141620` → `#1A1D28`). Border radius restored to 12px for premium SaaS feel. Success color updated to `#22C55E`. Inter Variable and Geist Mono retained. |
