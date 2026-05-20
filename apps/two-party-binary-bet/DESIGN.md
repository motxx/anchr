# Design System — Two-party Binary Bet

> Scope: this file governs the visual identity of the two-party binary
> bet reference app at `apps/two-party-binary-bet/`. It supersedes the
> root `DESIGN.md` for this directory only.

## 1. Atmosphere

This is a market-style financial tool. Users compare percentages, sat
amounts, deadlines, and volumes, so the UI should stay quiet, dense, and
legible. The example should feel like a reference implementation first,
not a standalone consumer brand.

**Key characteristics**
- Light, calm, and work-focused
- Warm neutral background with high-contrast text
- Single coral accent for primary actions and focus rings
- Clear YES / NO outcome colors
- Inter for UI text and Geist Mono for numeric values
- Cards use a 15px radius, matching the existing UI

## 2. Color Palette & Roles

### Primary
- **Coral** `#FF6B85` / `hsl(350, 100%, 71%)` — primary CTA and focus
  ring only.
- **Coral hover** `~#FF4F6E` — slight darken on hover via
  `hover:bg-primary/90`.

**Discipline rule:** Coral appears only on primary actions, focus rings,
and selected interactive states. Do not use it for decorative pills,
card hover effects, or background ornament.

### Outcomes
- **YES** `#5FBFA0` / `hsl(165, 45%, 56%)`
- **YES foreground** `#1A4D31`
- **NO** `#E63946` / `hsl(354, 78%, 56%)`
- **NO foreground** `#FFFFFF`

### Neutrals
| Token | Hex | HSL | Use |
|-------|-----|-----|-----|
| `--background` | `#FBF6EC` | `42 50% 96%` | Page background |
| `--card` | `#FFFFFF` | `0 0% 100%` | Cards and panels |
| `--muted` | `#F1ECDF` | `42 38% 92%` | Inputs and muted surfaces |
| `--border` | `#E5DCC4` | `42 28% 86%` | Borders and dividers |

## 3. Typography

- **UI text**: Inter, with `Zen Kaku Gothic New` fallback.
- **Numeric data**: Geist Mono. Use it for sats, percentages, hashes,
  pubkeys, and durations.
- **Display label**: Klee One remains available through `.font-shrine`
  for the compact app label only. Do not use it for body text or buttons.

| Role | Font | Size | Weight | Use |
|------|------|------|--------|-----|
| App label | Klee One | 20px | 600 | Header label |
| Page title | Inter | 24-30px | 700 | Detail-page title only |
| Section heading | Inter | 14px | 600 | Card headers |
| Body | Inter | 14px | 400 | Descriptions |
| Label | Inter | 11-12px | 500 | Uppercase labels |
| Probability large | Geist Mono | 36-48px | 700 | Featured percentage |
| Probability card | Geist Mono | 18px | 600 | Card YES/NO percentage |
| Data | Geist Mono | 12-14px | 500 | Sats, volumes, percentages |

## 4. Radius Scale

| Token | Px | Use |
|-------|----|-----|
| `--radius-sm` | 6px | Pills, small badges, inline tags |
| `--radius-md` | 10px | Buttons, inputs, side selectors |
| `--radius-lg` | 15px | Cards and panels |
| `--radius-xl` | 18px | Featured cards |
| `--radius-pill` | 9999px | Sort tabs, search, wallet pill |

## 5. Layout

- Max content width: 1152px (`max-w-6xl`)
- Markets grid: 1-up mobile, 2-up tablet, 3-up xl
- Detail page: chart and evidence on the left, bet panel sticky on the
  right at desktop widths
- Mobile detail order: chart, bet panel, activity, holders, about
- Header first, then create-market CTA, featured market, filters, grid

## 6. Motion

Default: nothing animates.

Allowed:
- Probability bar width transition on data change
- Chart range-selector state change
- One-shot petal burst when a bet succeeds or a market resolves
- `prefers-reduced-motion` disables the petal burst

Excluded:
- Constant background animation
- Hover lifts on cards
- Glow shadows
- Entrance animations

## 7. Do's And Don'ts

### Do
- Render numeric values in `font-mono`
- Use `bg-foreground text-background` for active sort/category pills
- Use `bg-yes` / `bg-no` only for bet outcomes
- Truncate hashes and pubkeys with `...` and surface the full value in
  `title`
- Land the user on the featured market

### Don't
- Don't add decorative coral backgrounds
- Don't render numbers in Inter
- Don't run petals on the page background
- Don't use `rounded-2xl` / `rounded-3xl` on cards
- Don't add technical proof labels unless the user is acting on them

## 8. Mobile

Phones are a primary surface.

- Header height: 56px
- Pubkey pill hidden below `md`
- Cards are 1-up at all mobile widths
- Bet panel appears immediately after the chart on detail pages
- Tap targets are at least 36px
- Category pill row scrolls horizontally
