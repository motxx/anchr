# Design System — Anchr

## Product Context
- **What this is:** Decentralized marketplace for cryptographically verified data, paid with Bitcoin
- **Who it's for:** AI agents and developers buying verified API responses, price feeds, and real-world photos; workers earning sats by producing TLSNotary and C2PA proofs
- **Space/industry:** Crypto data oracles, decentralized verification, Bitcoin-native tools
- **Project type:** Data-dense web app (three dashboards: Worker, Requester, E2E monitoring)

## Aesthetic Direction
- **Direction:** Industrial/Utilitarian
- **Decoration level:** Minimal — typography and spacing do the work, no gradients, no blobs, no decorative elements. The data IS the decoration.
- **Mood:** Bloomberg Terminal meets cypherpunk. A trading floor for data. Trustworthy, dense, precise. The UI should feel like a serious tool where real money moves, not a marketing page.
- **Reference sites:** mempool.space (data density, dark palette), Cashu (cypherpunk minimalism), DIA (clean structure)

## Typography
- **Display/Hero:** Geist — tight tracking, modern, technical without being cold. Uncommon in crypto, common in dev tools. Says "we're builders."
- **Body:** Geist — same family for consistency across the UI
- **UI/Labels:** Geist 600 weight, 11px, uppercase, tracking 0.08em
- **Data/Tables:** Geist Mono — tabular-nums for sat amounts, hashes, pubkeys, timestamps
- **Code:** Geist Mono
- **Loading:** Google Fonts `https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500;600&display=swap`
- **Scale:**
  - 28px / 700 / -0.02em tracking — page titles
  - 20px / 600 / -0.01em tracking — section headings
  - 15px / 600 — subheadings
  - 13px / 400 / line-height 1.6 — body text
  - 11px / 600 / tracking 0.08em / uppercase — labels, captions
  - 13px mono — data, hashes, amounts

## Color
- **Approach:** Restrained — one accent + neutrals, color is rare and meaningful
- **Primary (emerald):** `#10B981` — verified, earned, success, the loudest signal in the UI
- **Requester (blue):** `#60A5FA` — requester identity, wallet, queries
- **Escrow/Warning (amber):** `#F59E0B` — money locked, action needed, pending states
- **Error (red):** `#EF4444` — verification failed, rejected, destructive actions
- **Info (blue):** `#60A5FA` — informational states, awaiting
- **No purple.** Deliberately excluded. Most overused color in crypto UI. Adds nothing to Anchr's semantics.
- **Neutrals (cool grays):**
  - `#0A0B0F` — deepest background
  - `#12131A` — surface background
  - `#1A1B23` — elevated surface
  - `#22232E` — hover state
  - `#2A2B35` — borders
  - `#1F2029` — subtle borders
  - `#4B5563` — dim text
  - `#6B7280` — muted text
  - `#9CA3AF` — secondary text
  - `#F9FAFB` — primary text (dark mode)
- **Semantic backgrounds:** Each accent has an 8% opacity background variant for badges, alerts, and highlight regions (e.g., `rgba(16, 185, 129, 0.08)`)
- **Dark mode:** Default. Identical to `:root` values.
- **Light mode:** Invert neutral scale — `#FFFFFF` deepest, `#F9FAFB` surface, borders `#E5E7EB`, primary text `#111827`. Accent colors remain the same.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable — tighter than typical SaaS, appropriate for data-dense dashboards
- **Scale:** 2px / 4px / 8px / 12px / 16px / 24px / 32px / 48px / 64px

## Layout
- **Approach:** Grid-disciplined — strict columns, predictable alignment
- **Grid:** 3 columns for dashboard views, 1-2 columns for forms and detail views
- **Max content width:** 1440px
- **Border radius:** Hierarchical — sm: 4px (badges, inputs), md: 8px (cards, panels), lg: 12px (major containers)

## Motion
- **Approach:** Minimal-functional — only transitions that aid comprehension
- **Easing:** enter: ease-out, exit: ease-in, move: ease-in-out
- **Duration:** micro: 150ms (hover, focus), short: 250ms (panel transitions), medium: 400ms (page-level)
- **Rules:** No decorative animation. No entrance animations on page load. Scroll-driven animations only if they clarify data relationships.

## Component Patterns

### Status Badges
Monospace, 10px, 600 weight. Background uses semantic color at 8% opacity, text uses full semantic color.
- `awaiting_quotes` — blue
- `processing` — amber
- `approved` — emerald
- `rejected` — red

### Actor Avatars
20px circle with actor initial (R/W/O/S), colored by role:
- Requester: blue `#60A5FA`
- Worker: emerald `#10B981`
- Oracle: blue `#60A5FA` (was purple, changed to blue for no-purple policy)
- System: amber `#F59E0B`

### Balance Cards
Bordered panel with semantic color border at 20% opacity and background at 8% opacity. Balance amount in Geist Mono, 22px, bold. Unit label ("sats") in 11px muted.

### Data Display
All cryptographic data (hashes, pubkeys, token IDs) in Geist Mono. Truncate with ellipsis for display. Full value on hover/click. Labels in 10px dim uppercase.

### Alerts
Bordered box with semantic background at 8% opacity, semantic border at 20% opacity, text in full semantic color. 12px, 500 weight.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-31 | Initial design system created | Created by /design-consultation. Industrial/utilitarian direction chosen to differentiate from corporate crypto (Chainlink), academic protocol (TLSNotary), and cypherpunk minimal (Cashu) aesthetics. |
| 2026-03-31 | No purple policy | Purple is the most overused color in crypto UI. Removing it entirely gives Anchr a distinctive "serious tool" feel vs "blockchain project" feel. Oracle actor color changed from purple to blue. |
| 2026-03-31 | Geist typeface selected | Geist is built for data-dense interfaces with a native monospace variant. Popular in dev tools (Vercel), almost unused in crypto. Communicates "builders" not "protocol." |
| 2026-03-31 | Ultra-tight type scale (11-28px) | Density play. Workers scanning queries and requesters checking proofs need more information per viewport, not more whitespace. |
