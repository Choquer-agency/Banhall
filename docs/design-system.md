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
| `canvas` | `#F9FCFB` | App background — carries the ledger rules; never a content bg |
| `chrome` | `#EAF2F1` | Recessed UI: wells, hover fills, pills |
| `navy` (fir) | `#0A3A38` | App bar, brand emphasis, focus rings |
| `primary` (lagoon) | `#0DACA5` | The accent: primary actions, links, active states |
| `primary-dark` | `#0A8A84` | Action hover/pressed |
| `primary-light` | `#45CFC9` | Accent on dark surfaces only |
| `primary-wash` | `#F1FAF9` | Interactive hover fill on light surfaces |
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
- **Report column**: anywhere a report renders (editor, candidate preview,
  history) uses `max-w-report` (`--container-report`, 920px) — one knob.
- **Global rail**: AppNav + PageBar inner containers are ALWAYS `max-w-7xl`
  (never per-page). Page `<main>` may be narrower for reading width
  (`max-w-3xl/4xl`), centered inside the same gutters; `px-6 pt-12`.

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
7. **Expandable rows**: disclosure chevron sits at the row's RIGHT edge,
   points DOWN closed → UP open (rotate-180), and turns `primary` when open.
   Never left of the label.
8. **Motion**: every transition runs ≥300ms (`--default-transition-duration:
   300ms` makes bare `transition-*` utilities 300ms; never use duration-75/
   100/150/200).
9. **Hover fills** on light surfaces use `primary-wash` — never gray washes.
   Destructive hovers stay red; dark-surface hovers stay white/alpha.

## Chat primitives

`$lib/components/chat/primitives` — prompt-kit-shaped chat building blocks,
implemented natively in Svelte 5 runes on these tokens (API-shape inspiration
only; no React). Specimens on `/styleguide`; composed in `AgentChatPanel`.

- `ChatContainer` — message viewport with stick-to-bottom: follows new content
  while pinned, stops when the user scrolls up, resumes at the bottom.
  `bind:this` exposes `scrollToBottom(behavior)`; `bind:isAtBottom` readable.
- `ScrollButton` — floating "jump to latest"; auto-appears via ChatContainer
  context when not at the bottom.
- `Message` / `MessageContent` / `MessageAvatar` — role-based bubbles: user =
  primary-tinted right bubble, assistant = plain left ink; `markdown` renders
  through svelte-streamdown with the `chat-markdown` styles.
- `PromptInput` (+ `PromptInputTextarea`, `PromptInputActions`) — composer
  well: autogrow textarea capped at 140px, Enter = send / Shift+Enter =
  newline, `pill` snippet + `textIndent` for the highlight chip, action slots
  either side.
- `Loader` — bouncing-dot typing indicator (`md`/`sm`).
- `Suggestion` — canned-prompt pill chip (wash hover, one accent rule applies).
