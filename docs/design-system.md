# Banhall design system — "Ledger paper"

Canonical tokens: `src/routes/layout.css` (`@theme` + `@utility`). Live render:
`/styleguide`. Established 2026-07-02.

**Concept.** Banhall's material is the CRA form — ruled lines, line numbers,
disciplined prose. The system reads as a calm ledger: a pale-teal working
surface with near-invisible ruled lines, content on solid white cards, one
deep-fir app bar, and a single lagoon accent. Quiet everywhere, loud once.

## Color

| Token | Hex | Role |
|---|---|---|
| `canvas` | `#F5F9F8` | App background — carries the ledger rules; never a content bg |
| `chrome` | `#EAF2F1` | Recessed UI: wells, hover fills, pills |
| `navy` (fir) | `#0A3A38` | App bar, brand emphasis, focus rings |
| `primary` (lagoon) | `#189E98` | The accent: primary actions, links, active states |
| `primary-dark` | `#10807B` | Action hover/pressed |
| `primary-light` | `#3DCCC5` | Accent on dark surfaces only |
| `gap-bg` / `gap-text` | `#FEF3C7` / `#92400E` | Report [GAP:] highlights only |

**Neutral ramp** — Tailwind's `gray-*` is *remapped* to teal-cast values so
every neutral in the app shares the brand hue. Hierarchy:

- `gray-900/800` — ink (headings, primary text)
- `gray-700/600` — secondary text
- `gray-500` — muted (captions, meta)
- `gray-400` — faint (placeholders, inactive icons)
- `gray-300` — disabled
- `gray-200/100` — borders / hairlines
- `gray-50` — wash fills

Semantic aliases for new code: `ink`, `ink-secondary`, `ink-muted`,
`ink-faint`, `line`, `line-soft`.

Status colors (Badge): draft=gray, generating=blue, review=amber,
client_review=purple, final=primary. Errors/destructive=red-500/600.

## Type

Faces: **DM Sans** (UI), **Georgia** (report prose only), **Geist Mono**
(data). Roles — use these before ad-hoc sizes:

| Utility | Spec | Use |
|---|---|---|
| `.text-display` | 24/1.25 · 700 · -0.02em · ink | Page titles |
| `.text-title` | 17/1.35 · 600 · ink | Card/section titles |
| `.text-body` | 14/1.55 · 400 · ink-secondary | Default copy |
| `.text-label` | 11 · 600 · caps · +0.08em · ink-muted | Eyebrows, column headers |
| `.text-data` | 12 · mono · tabular-nums | Numbers, ids, dates, scores |

Supporting sizes stay Tailwind (`text-xs`/`text-sm`); arbitrary `text-[Npx]`
values are legacy — replace on touch.

## Surfaces & structure

- `.card` — white, `border-line`, `rounded-xl`. All content sits on cards.
- Body carries the **ledger rule** texture (1px fir at 3.2% every 2rem).
- **AppNav** (`$lib/components/ui/AppNav.svelte`) is the one nav: full-width
  fir bar, h-12, logo→Dashboard + breadcrumb trail, actions right, and the
  **baseline rule** (`.nav-baseline`, teal fading right) as the signature.
  Only the report workspace (`project/[id]`) keeps a custom dense header.
- Page container: `max-w-7xl` dashboard-class pages, `max-w-3xl/4xl` for
  focused reads; `px-6 py-8`.

## Rules of use

1. One accent per view — lagoon marks the primary action, nothing else.
2. Text steps down the ramp, never up, within a block.
3. Numbers/ids/dates/scores render in `.text-data`.
4. New interactive primitives come from bits-ui (headless) styled with these
   tokens; stock components via `bun x shadcn-svelte add`.
5. Spacing rhythm: 2rem section gaps (matches the ledger rule), 0.75rem card
   radius, gap-3 grids.
6. Prefer semantic aliases (`text-ink-muted`) in new code; gray-* remains
   valid in ported code.
