# Design System — Anchr Prediction Market

## 1. Visual Theme & Atmosphere

Anchr is a Bitcoin-native prediction market built on Cashu HTLC + Nostr + TLSNotary. The visual identity is rooted in Nostr culture — dark, sovereign, cypherpunk — but elevated to the polish level of Polymarket and Stripe. The interface should feel like a serious financial instrument that happens to run on Nostr keys and Lightning sats, not a toy or proof of concept.

The atmosphere is **dark-immersive**: deep, near-black surfaces with a subtle purple tint inherited from Nostr's brand identity. Purple is the singular brand accent — every interactive element, glow, and highlight traces back to it. Color is rare and meaningful: only YES (green), NO (red), and brand purple appear against the dark canvas.

**Key Characteristics:**
- Near-black backgrounds with purple undertone (`#0A0910`)
- Single brand accent: Nostr purple (`#8B5CF6`)
- Prediction-market-native color pair: YES emerald / NO red
- Inter Variable for all UI text; Geist Mono for numbers, hashes, pubkeys
- Conservative border-radius (8–12px) — polished but not bubbly
- Purple glow on hover/focus — subtle, never decorative
- Data IS the decoration — no gradients, blobs, or illustrations

**Reference sites:** Polymarket (market card layout, probability bars), Kalshi (clean data density), Damus (Nostr purple identity), mempool.space (crypto data density)

## 2. Color Palette & Roles

### Primary
- **Nostr Purple** (`#8B5CF6` / `hsl(258, 90%, 66%)`): Primary brand accent, CTAs, links, focus rings, active states, glow effects. The singular interactive color.
- **Purple Hover** (`#7C3AED` / `hsl(263, 83%, 58%)`): Darker purple for hover states on primary elements.
- **Purple Glow** (`rgba(139, 92, 246, 0.15)`): Ambient glow for hover cards, focused inputs.
- **Purple Surface** (`rgba(139, 92, 246, 0.10)`): Background tint for selected/active states and badges.

### Prediction Market Pair
- **YES Green** (`#22C55E` / `hsl(142, 71%, 45%)`): YES bets, positive outcomes, success. Used in probability bars, bet buttons, and resolved-YES badges.
- **YES Green Background** (`rgba(34, 197, 94, 0.12)`): Tinted surface for YES-related regions.
- **YES Green Dark** (`#166534`): YES button text (on green background) for contrast.
- **NO Red** (`#EF4444` / `hsl(0, 84%, 60%)`): NO bets, negative outcomes, errors. Used in probability bars, bet buttons, and resolved-NO badges.
- **NO Red Background** (`rgba(239, 68, 68, 0.12)`): Tinted surface for NO-related regions.
- **NO Red Dark** (`#7F1D1D`): NO button text (on red background) for contrast.

### Semantic
- **Warning Amber** (`#F59E0B`): Pending states, escrow locked, expiring soon.
- **Info Blue** (`#60A5FA`): Informational badges, Nostr connection status.

### Neutrals (Purple-Tinted Dark Progression)
| Token | Hex | HSL | Use |
|-------|-----|-----|-----|
| `--background` | `#0A0910` | `260 15% 4%` | Deepest page background |
| `--card` | `#13111C` | `260 12% 8%` | Card/panel surfaces |
| `--muted` | `#1B1826` | `260 12% 11%` | Elevated surface, input backgrounds |
| `--border` | `#231F30` | `260 14% 15%` | Borders, dividers, secondary surfaces |
| `--active` | `#2D2840` | `260 14% 20%` | Hover/active surface states |

### Text Hierarchy (4-Tier)
| Token | Hex | HSL | Use |
|-------|-----|-----|-----|
| `--foreground` | `#ECEAF3` | `255 25% 93%` | Primary text — headings, values |
| `--secondary` | `#A39FB3` | `255 10% 66%` | Secondary text — descriptions, labels |
| `--muted-foreground` | `#6E6980` | `260 10% 46%` | Tertiary — timestamps, metadata |
| `--dim` | `#4A4558` | `260 10% 31%` | Dimmest — disabled, decorative |

### Borders
Subtle purple-tinted borders matching the surface scale. Default `hsl(260, 14%, 15%)` — near-invisible on dark but provides structure. On hover, borders shift toward `hsl(258, 40%, 30%)` with a purple tint. Focus rings use full purple at 50% opacity.

### Dark Mode
Default and only mode. All values above are the canonical palette.

## 3. Typography Rules

### Font Families
- **Primary**: `Inter Variable` (fallback: `Inter`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `system-ui`, `sans-serif`)
- **Mono**: `Geist Mono` (fallback: `ui-monospace`, `SFMono-Regular`, `SF Mono`, `Menlo`, `Consolas`, `monospace`)
- **Loading**: Google Fonts `https://fonts.googleapis.com/css2?family=Inter:wght@300..700&family=Geist+Mono:wght@400;500;600&display=swap`

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Use |
|------|------|------|--------|-------------|----------------|-----|
| Page Title | Inter | 30px (1.875rem) | 700 | 1.2 | -0.03em | "Prediction Markets" |
| Section Heading | Inter | 20px (1.25rem) | 600 | 1.3 | -0.02em | Panel titles, "Market Details" |
| Market Title | Inter | 15px (0.9375rem) | 600 | 1.4 | -0.01em | Market question text in cards |
| Body | Inter | 14px (0.875rem) | 400 | 1.6 | normal | Descriptions, paragraphs |
| Body Small | Inter | 13px (0.8125rem) | 400 | 1.5 | normal | Secondary descriptions |
| Label | Inter | 12px (0.75rem) | 500 | 1.0 | 0.05em, uppercase | Category tags, section labels |
| Caption | Inter | 11px (0.6875rem) | 400 | 1.3 | normal | Footnotes, helper text |
| Probability Large | Geist Mono | 36px (2.25rem) | 700 | 1.0 | -0.02em | YES/NO percentage in detail view |
| Probability Card | Geist Mono | 18px (1.125rem) | 600 | 1.0 | -0.01em | YES/NO percentage on cards |
| Data Value | Geist Mono | 14px (0.875rem) | 500 | 1.0 | normal | Sat amounts, pool sizes |
| Data Label | Geist Mono | 12px (0.75rem) | 400 | 1.0 | normal | Hashes, pubkeys, code snippets |
| Stat Large | Geist Mono | 20px (1.25rem) | 700 | 1.0 | normal | Stats bar numbers |

### Principles
- **Inter for all UI text** — proven at small sizes, tabular-nums support, clean and neutral
- **Geist Mono for all numeric/crypto data** — sat amounts, pool sizes, probabilities, hashes, pubkeys, timestamps
- **Tight tracking at display sizes** — negative letter-spacing on headings creates density and authority
- **Uppercase labels only at 12px or below** — never uppercase body text or headings
- **No bold above 700** — maximum weight is 700 (bold), used sparingly for page titles and large numbers

## 4. Component Stylings

### Market Card
- Background: `var(--card)` (`#13111C`)
- Border: `1px solid var(--border)` (`#231F30`)
- Border-radius: 12px
- Padding: 20px
- Hover: border shifts to `rgba(139, 92, 246, 0.4)`, background to `var(--card)` at 80% opacity, box-shadow `0 0 24px -6px rgba(139, 92, 246, 0.15)`
- Transition: all 200ms ease-out
- Contains: category label, time-remaining badge, market title, probability bar, footer stats

### Probability Bar
- Container: `h-2` (8px), `rounded-full`, background `var(--muted)`
- YES segment: `bg-yes` (`#22C55E`), `rounded-l-full`
- NO segment: `bg-no` (`#EF4444`), `rounded-r-full`
- In detail view: `h-3` (12px) for emphasis
- Transition: width 500ms ease-out (animates when odds change)

### Bet Buttons (YES/NO Side Selector)
**YES Selected:**
- Background: `#22C55E`
- Text: `#166534` (dark green)
- Height: 48px
- Border-radius: 8px
- Font: Inter 14px 600
- Shadow: `0 0 16px -4px rgba(34, 197, 94, 0.4)`

**YES Unselected:**
- Background: transparent
- Border: `1px solid var(--border)`
- Text: `var(--muted-foreground)`
- Hover: border `rgba(34, 197, 94, 0.4)`, text `#22C55E`

**NO Selected:**
- Background: `#EF4444`
- Text: `#7F1D1D` (dark red)
- Height: 48px
- Border-radius: 8px
- Font: Inter 14px 600
- Shadow: `0 0 16px -4px rgba(239, 68, 68, 0.4)`

**NO Unselected:**
- Background: transparent
- Border: `1px solid var(--border)`
- Text: `var(--muted-foreground)`
- Hover: border `rgba(239, 68, 68, 0.4)`, text `#EF4444`

### Primary Button (Connect Wallet, CTA)
- Background: `#8B5CF6`
- Text: `#FFFFFF`
- Height: 32px (compact) / 44px (standard)
- Padding: 0 12px (compact) / 0 20px (standard)
- Border-radius: 8px
- Font: Inter 13px 500 (compact) / 14px 500 (standard)
- Hover: `#7C3AED`
- Disabled: 40% opacity, cursor not-allowed
- Transition: background 150ms ease-out

### Secondary Button (Quick Amount, Filters)
- Background: transparent
- Border: `1px solid var(--border)`
- Text: `var(--muted-foreground)`
- Height: 32px
- Border-radius: 8px
- Font: Geist Mono 12px 400
- Hover: border `rgba(139, 92, 246, 0.4)`, text `var(--foreground)`

### Inputs
- Background: `var(--muted)` (`#1B1826`)
- Border: `1px solid var(--border)`
- Text: `var(--foreground)`, Geist Mono 14px 400
- Height: 44px
- Padding: 0 12px
- Border-radius: 8px
- Placeholder: `var(--muted-foreground)`
- Focus: border `#8B5CF6`, ring `1px rgba(139, 92, 246, 0.3)`
- Transition: border/ring 150ms ease-out

### Badges (Status, Category)
**Market Status — Open:**
- Background: `rgba(139, 92, 246, 0.15)`
- Text: `#8B5CF6`
- Padding: 2px 10px
- Border-radius: 9999px (pill)
- Font: Inter 12px 500

**Resolved YES:**
- Background: `rgba(34, 197, 94, 0.15)`
- Text: `#22C55E`

**Resolved NO:**
- Background: `rgba(239, 68, 68, 0.15)`
- Text: `#EF4444`

**Category Label:**
- No background
- Text: `var(--muted-foreground)`
- Font: Inter 12px 400, uppercase, tracking 0.08em

### Cards (Info Panels)
- Background: `var(--card)`
- Border: `1px solid var(--border)`
- Border-radius: 12px
- Padding: 24px
- Section title: Inter 12px 500, uppercase, tracking 0.05em, `var(--muted-foreground)`, margin-bottom 16px

### Stat Cards
- Background: `var(--card)`
- Border: `1px solid var(--border)`
- Border-radius: 12px
- Padding: 16px
- Label: Inter 12px 400, `var(--muted-foreground)`
- Value: Inter or Geist Mono 18px 700, `var(--foreground)`

### Code/Data Display
- Font: Geist Mono 12px 400
- Background: `rgba(139, 92, 246, 0.10)` (for highlighted data like resolution URL)
- Text: `#8B5CF6` (highlighted) or `var(--muted-foreground)` (secondary data)
- Padding: 4px 8px
- Border-radius: 4px
- Word-break: break-all (for hashes, URLs)

### Navigation Header
- Background: `var(--card)` at 50% opacity + `backdrop-filter: blur(12px)`
- Border-bottom: `1px solid var(--border)`
- Height: 56px
- Sticky top: 0, z-index: 50
- Logo: 28px square, `rounded-lg`, `bg-primary/20`, purple icon
- Brand text: Inter 16px 700, `var(--foreground)`
- Connection indicator: 6px circle, `bg-yes`, `animate-pulse`

## 5. Layout Principles

### Spacing System
- Base unit: 4px
- Scale: 2px / 4px / 6px / 8px / 12px / 16px / 20px / 24px / 32px / 48px / 64px
- Density: comfortable-dense — tighter than typical SaaS, appropriate for financial data

### Grid & Container
- Max content width: 1152px (`max-w-6xl`)
- Market list: 2-column grid, `gap-16px`
- Market detail: 3-column grid (2:1 ratio — content:sidebar)
- Stats bar: 4-column grid (2-column on mobile), `gap-12px`
- Horizontal padding: 20px

### Whitespace Philosophy
- **Data-dense, chrome-generous**: Market data tightly packed within cards; generous spacing between sections and panels
- **Section rhythm**: 32px between major sections, 20px between related panels in detail view
- **Card internal rhythm**: 20px padding, 12–16px between child elements

### Border Radius Scale
| Token | Value | Use |
|-------|-------|-----|
| `--radius-sm` | 4px | Code snippets, micro elements |
| `--radius-md` | 8px | Buttons, inputs, inner cards |
| `--radius-lg` | 12px | Cards, panels, stat boxes |
| `--radius-pill` | 9999px | Badges, status pills |

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat (0) | No shadow | Page background, inline elements |
| Ambient (1) | `0 1px 2px rgba(0, 0, 0, 0.3)` | Subtle card separation |
| Glow Hover (2) | `0 0 24px -6px rgba(139, 92, 246, 0.15)` | Market card hover — purple ambient glow |
| YES Glow | `0 0 16px -4px rgba(34, 197, 94, 0.4)` | YES bet button selected |
| NO Glow | `0 0 16px -4px rgba(239, 68, 68, 0.4)` | NO bet button selected |
| Elevated (3) | `0 8px 24px -8px rgba(0, 0, 0, 0.5)` | Dropdowns, popovers |
| Header | `backdrop-filter: blur(12px)` on semi-transparent bg | Sticky navigation |

**Shadow Philosophy**: Shadows are purple-tinted glows, not neutral gray lifts. Elevation is communicated through ambient color diffusion rather than directional shadow. This reinforces the Nostr-native identity and creates a "floating in void" effect rather than layered-paper metaphor. The darkest surfaces use no shadow at all — depth comes from the purple tint progression in the neutral scale.

## 7. Do's and Don'ts

### Do
- Use `#8B5CF6` (Nostr purple) as the singular brand/interactive color — consistency IS the brand
- Use YES green (`#22C55E`) and NO red (`#EF4444`) only for prediction market outcomes — never decoratively
- Use Geist Mono for all numeric and cryptographic data — sat amounts, probabilities, hashes, pubkeys
- Use purple glow (`rgba(139, 92, 246, 0.15)`) for hover/focus elevation — it's atmospheric, not decorative
- Keep border-radius between 8–12px for cards and buttons — polished but not bubbly
- Show probability as a dual-segment bar (YES left, NO right) — users should see odds instantly
- Show sat amounts in compact format (1K, 2.3M) with `sats` unit label
- Truncate hashes and pubkeys with ellipsis — full value on hover/click
- Use uppercase + tracking only at 12px and below (labels, section headers)
- Maintain the 4-tier text hierarchy — primary / secondary / muted / dim

### Don't
- Don't use purple as a background fill — it's for accents, glows, and interactive elements only
- Don't use green/red for anything except YES/NO outcomes and success/error states
- Don't use Inter for numbers, sat amounts, or probabilities — always Geist Mono
- Don't use decorative gradients, illustrations, or blobs — the data IS the visual interest
- Don't use border-radius above 12px on cards — 9999px only for badge pills
- Don't use neutral gray shadows — all shadows are either purple-tinted or pure black
- Don't use bright colors on the background surface — the UI should feel like a void with floating cards
- Don't add entrance animations or page-load transitions — motion is functional only
- Don't put sat amounts without the `sats` unit label — always explicit
- Don't show full hashes/pubkeys inline — truncate and offer expand on interaction

## 8. Responsive Behavior

### Breakpoints
| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | <640px (`sm`) | Single column, stat grid collapses to 2-col, detail sidebar stacks below |
| Tablet | 640–1024px (`md`) | Market grid stays 2-col, detail becomes single column with sidebar below |
| Desktop | ≥1024px (`lg`) | Full 2-col market grid, 3-col detail layout (2:1) |

### Touch Targets
- Bet buttons: 48px height — comfortable tap target
- Quick amount buttons: 32px height
- Navigation buttons: 32px height
- Market cards: full-width touch targets (entire card is tappable)
- Category filter tabs: 32px height with adequate horizontal padding

### Collapsing Strategy
- **Market grid**: 2-column → 1-column on mobile
- **Stats bar**: 4-column → 2-column on mobile
- **Detail layout**: 3-column (2:1) → stacked (content, then sidebar) on tablet and below
- **Betting panel**: becomes non-sticky when stacked, positioned after market info
- **Search/filter bar**: stacks vertically on mobile (categories on top, search below)
- **Header**: maintains all elements; wallet button shrinks to icon on small screens
- **Probability numbers**: 36px → 28px on mobile
- **Page title**: 30px → 24px on mobile

### Scroll Behavior
- Header: sticky with backdrop blur, always visible
- Betting panel (sidebar): sticky `top-24px` on desktop, normal flow on mobile
- Market cards: normal scroll, no infinite scroll
- Code/hash display: horizontal overflow with `break-all` wrapping

## 9. Agent Prompt Guide

### Quick Color Reference
| Role | Color | Hex |
|------|-------|-----|
| Primary CTA | Nostr Purple | `#8B5CF6` |
| Primary Hover | Purple Dark | `#7C3AED` |
| Background | Deep Black | `#0A0910` |
| Card Surface | Dark Purple | `#13111C` |
| Border | Purple Border | `#231F30` |
| Primary Text | Light Purple-White | `#ECEAF3` |
| Secondary Text | Muted Lavender | `#A39FB3` |
| Muted Text | Dim Purple | `#6E6980` |
| YES Outcome | Emerald Green | `#22C55E` |
| NO Outcome | Red | `#EF4444` |
| Warning | Amber | `#F59E0B` |
| Info / Nostr | Light Blue | `#60A5FA` |

### Example Component Prompts

- "Create a market card on `#13111C` background with `1px solid #231F30` border, 12px radius. On hover: border `rgba(139, 92, 246, 0.4)`, shadow `0 0 24px -6px rgba(139, 92, 246, 0.15)`. Title at 15px Inter weight 600, color `#ECEAF3`. Category label 12px uppercase tracking 0.08em, color `#6E6980`. Probability bar: 8px tall, rounded-full, YES segment `#22C55E` left, NO segment `#EF4444` right. Percentages in Geist Mono 18px 600 — YES green, NO red."

- "Design a betting panel: `#13111C` card, 24px padding, 12px radius, `1px solid #231F30`. Two side-selector buttons 48px tall, 8px radius — YES selected: `#22C55E` bg, `#166534` text, shadow `0 0 16px -4px rgba(34, 197, 94, 0.4)`. Amount input: `#1B1826` bg, `1px solid #231F30` border, 8px radius, 44px height, Geist Mono 14px. Submit button: full-width, 48px, green/red based on side, 8px radius."

- "Build a stats bar: 4-column grid, gap 12px. Each stat: `#13111C` bg, `1px solid #231F30` border, 12px radius, 16px padding. Label 12px Inter 400 `#6E6980`. Value: Geist Mono 18px 700 `#ECEAF3`."

- "Create sticky navigation: 56px height, `#13111C` at 50% opacity + `backdrop-filter: blur(12px)`, border-bottom `1px solid #231F30`. Logo area: 28px purple icon square. Brand: Inter 16px 700 `#ECEAF3`. Right side: connection dot (6px, `#22C55E`, pulse animation) + `Connect Wallet` button (purple `#8B5CF6`, 32px height, 8px radius, white text)."

- "Design a resolution badge for YES outcome: `rgba(34, 197, 94, 0.15)` bg, `#22C55E` text, pill shape (9999px radius), 12px Inter 500, padding 2px 10px."

### Implementation Notes
- CSS variables defined in `globals.css` using HSL values in `:root` and `.dark` selectors
- Tailwind `@theme` block maps CSS vars to utility classes (`bg-primary`, `text-foreground`, etc.)
- Custom colors `--yes` and `--no` extend the theme for prediction-market-specific utilities
- `cn()` utility from `clsx` + `tailwind-merge` for conditional class merging
- Components use React + Tailwind CSS — no CSS-in-JS, no styled-components

### Iteration Guide
1. Purple is the only brand color. YES green and NO red are domain colors, not brand colors.
2. Geist Mono for any number the user might compare (odds, amounts, pool sizes) — monospace alignment matters.
3. Cards float on void: purple-tinted glow on hover, not directional shadow.
4. Status badges use pill shape; everything else uses 8–12px radius.
5. Borders default to invisible (`#231F30` on `#13111C`); hover reveals them with purple tint.
6. `sats` always accompanies numeric amounts — never bare numbers.
7. Probability bars always show both segments — never just one color.
8. Truncate hashes to first 16 chars + `...` in display; full value in tooltip.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-31 | Findexa-inspired blue theme | Initial design for Worker/Requester dashboards. Blue brand accent. |
| 2026-04-06 | Nostr purple theme for Prediction Market | Market page needs distinct identity from dashboard. Nostr culture uses purple (Damus, Primal). Black + purple creates sovereign, cypherpunk feel appropriate for permissionless prediction markets. |
| 2026-04-06 | 9-section structure adopted | Following awesome-design-md convention for AI-agent-readable design systems. Sections: theme, color, typography, components, layout, depth, do's/don'ts, responsive, agent guide. |
| 2026-04-06 | YES/NO as domain colors, not brand | Green/red reserved exclusively for prediction outcomes. Prevents color confusion and keeps the brand identity clean (purple only). |
