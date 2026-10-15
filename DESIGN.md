# HQ design system (v3)

> **Answer first:** one calm "Notion × Obsidian" look. White / near-black canvas, violet ink, hairlines, 12 px radius, Inter.
> Every screen leads with **one Next item with one button**, then pictures. Prefs only ever reach the page as **enum
> `data-*` attributes** on `<html>`. Written from the built tokens in `src/styles/tokens.css` (the source of truth).

| Where | What |
|---|---|
| `src/styles/tokens.css` | every token below, dark mode, accents, project slots, the prefs attributes |
| `src/styles/{base,shell,components}.css` | document + type, app shell, shared components |
| `src/styles/{visuals,work,read,people,look}.css` | one file per area: charts/explainers · Home/Projects/Tasks · Board/Docs/Ask · People · Adjust look + Settings |
| `src/lib/bp.ts` | the same breakpoints in JS (`PHONE = 760`, `NARROW = 1100`) |
| `src/lib/icons.tsx` | the one icon set (lucide-react), explainer icon names mapped to it |

---

## 1. Colour

| Token | Light | Dark | Job |
|---|---|---|---|
| `--bg` · `--side` · `--pane` · `--pane-2` · `--raise` | `#fff` · `#f7f7f7` · `#f6f6f6` · `#ececec` · `#fff` | `#1e1e1e` · `#191919` · `#252525` · `#2e2e2e` · `#262626` | surfaces |
| `--fg` · `--fg-2` · `--muted` | `#222` · `#454545` · `#6a6a6a` | `#dcddde` · `#b8b9ba` · `#9a9a9a` | text (AA on every surface) |
| `--line` · `--line-2` | `#e8e8e8` · `#d4d4d4` | `#323232` · `#454545` | hairlines, input borders |
| `--accent` · `--accent-ink` · `--accent-wash` | `#7c5cec` · `#5b3fd0` · `#efeafe` | fill same · `#ad93fb` · violet 18% | fill (white text ≥ 4.5:1) · text · wash |
| `--ok` · `--warn` · `--bad` (+ `-ink`, `-wash`) | `#1f8a4c` · `#b87400` · `#d1343a` | `#44cf6e` · `#e0ac00` · `#fb464c` | state only, always icon + word |
| `--mark-empty` · `--mark-ctx` | `#8c8c8c` | `#7a7a7a` | "later" beads/nodes, context points, dashed tracks (≥ 3:1) |
| `--viz-1` … `--viz-8` | dataviz slots | re-tuned for dark | chart series = project colours |

- **Accents** (`data-accent`): violet (default) · blue · green · amber · rose · slate. Each has fill, ink, wash for both themes.
- **Project colour** = `color: 1..8` in `project.md` → class **`pc1`…`pc8`** (sets `--pc`). Never an inline value, never
  derived from a slug; anything invalid = slot 1. (`c4`–`c12` are grid spans, so the slots are `pcN`.)
- Visuals use their own `--vc` (accent, or the project slot when the component carries `has-pc pcN`).
- Emphasis charts (scatter, decisions): the pick = `--accent`, everything else = `--mark-ctx`.

## 2. Type

| Token | Size @100% | Use |
|---|---|---|
| `--t-xs` · `--t-sm` · `--t-md` | 12 · 13 · 15 px | meta · secondary · body |
| `--t-lg` · `--t-xl` | 17 · 20 px | lead lines · hero Next sentence, stat values |
| `--t-2xl` · `--t-3xl` | 24 · 32 px | phone page title · page title (750, -0.025em) |

- Fonts: `--font-ui` = **Inter** (the only font loaded up front). Lexend / Atkinson Hyperlegible load only when chosen.
  Code = the system mono stack (`--font-mono`).
- `--fs` scales everything (`data-size` s 90% · m 100% · l 110% · xl 120% · xxl 135%); `--lh` 1.55 / 1.75 / 1.95;
  `--ls` 0 / .02em.

## 3. Space, radius, elevation, motion

| Group | Tokens |
|---|---|
| Space (4-base × density `--d`: compact .82 · comfy 1 · spacious 1.2) | `--s1` 4 · `--s2` 8 · `--s3` 12 · `--s4` 16 · `--s5` 20 · `--s6` 24 · `--s8` 32 · `--s10` 40 · `--s14` 56 |
| Radius | `--r-xs` 6 · `--r-sm` 8 · `--r` 12 · `--r-lg` 16 · `--r-pill` 999 |
| Elevation | `--e1` (cards) · `--e2` (popovers, toasts) · `--e3` (palette, sheets) |
| Motion | `--dur-1` 120 · `--dur-2` 180 · `--dur-3` 260 · `--dur-4` 420 ms · `--ease` cubic-bezier(.2,.8,.2,1) |

- One authored moment: **Next completion** = the bar fills for 520 ms (`NEXT_FILL_MS`), then the next item.
- Reduced motion (OS setting or `data-motion="reduced"`) = every transition instant, no completion fill.

## 4. Layout

| Thing | Rule |
|---|---|
| Breakpoints | phone ≤ 760 px · narrow ≤ 1100 px (CSS and `lib/bp.ts` use the same numbers) |
| Shell | sidebar 252 px (rail 60 px, `data-sb="rail"`) · top bar 48 px · page max 1160 px · readers 820 px (`.read-page`) |
| Phone | sidebar = left sheet (`data-sheet="nav"`), bottom bar Home · Projects · Ask · Tasks · More, 16 px gutters, **no sideways scroll at 360 / 375 / 390** |
| Grid | `.grid` = 12 columns; spans `.c4` `.c5` `.c6` `.c7` `.c8` `.c12`; everything spans 12 at ≤ 1100 px (`.c6` at ≤ 860 px) |

## 5. Prefs → the page (Adjust look)

`lib/ui-prefs-core.ts` (byte copy of the edge function's core) normalizes every source; `lib/prefs.ts` `applyRoot`
writes **only** these attributes, with enum values only. The inline pre-paint script in `index.html` sets the same ones
from the device cache before any CSS loads.

| Attribute | Values (default first) |
|---|---|
| `data-theme` (resolved) · `data-theme-pref` | light/dark · system/light/dark |
| `data-accent` · `data-density` · `data-size` · `data-font` | violet… · comfy/compact/spacious · m/s/l/xl/xxl · inter/lexend/atkinson/system |
| `data-lh` · `data-ls` · `data-motion` | normal/relaxed/loose · normal/wide · system/reduced/full |
| `data-contrast` · `data-calm` · `data-focus` | normal/high · off/on · off/on |

Lists (`home_order/hidden`, `nav_order/hidden`, `pinned`, …) never touch the DOM as values; components read them.
Stored per person in `people/<slug>/ui.md` (flat frontmatter, non-default keys only) and cached in `hq.ui.<login>`.

## 6. Components (one line each)

| Component | File | Rule |
|---|---|---|
| `PageHeader` | `components/shell/PageHeader.tsx` | icon · `h1 tabindex=-1` · sub · 0–3 tiles (a 0 / empty tile is never drawn) · one Next |
| `NextBar` | `components/shell/NextBar.tsx` | exactly one button from `NEXT_BUTTON` (Open · Review · Decide · Done · Make it a to-do · Check in); `data-next=<id>` |
| `Widget` · `Stat` · `StatusPill` · `Chip` · `Empty` · `Avatar` · `Toggle` · `Callout` · `Segmented` · `Switch` | `components/ui.tsx` | status = icon + word; ≤ 6 rows then "+N more"; no controls inside links |
| `Markdown` | `components/ui.tsx` | ```` ```chart ```` / ```` ```explainer ```` through `components/blocks.tsx`: ≤ 4 rich blocks per doc or answer, each in an error boundary whose fallback is its code |
| Popover · palette · toasts | `components/shell/*`, `components/toast.tsx` | Esc closes the newest surface first; toasts: one line + Undo, 6 s, max 2 |
| Journey · Beads · Scatter · GoalMeter · WeekDots · Heatmap · StatusBoard | `components/visuals/*` | beads in cards = one `role=img`; journey nodes 24 px with roving focus; scatter hit circles 36 px; every chart has a Table twin |
| Explainers (flow · map · cards · timeline · compare) | `components/explainers/*` | total parser (12 KB cap, never throws); text only, never HTML from data |

## 7. Accessibility floor

| Area | Rule |
|---|---|
| Focus | visible 2 px accent ring; route change focuses the page `h1` (no ring); overlays return focus to their opener |
| Keyboard | Ctrl/⌘ K palette · Ctrl/⌘ . Adjust look · Ctrl/⌘ \ sidebar always; single keys (L, G+x, N, X, ?) switchable off (`keys: off`, WCAG 2.1.4) and never inside text fields |
| Targets | ≥ 24 px (≥ 44 px for phone bars and check-in) |
| Contrast | text ≥ 4.5:1; meaningful marks ≥ 3:1; colour never alone |
| Zoom / forced colours | text to 135% reflows; beads, meters and the heatmap keep their fills |

## 8. Budgets (checked by `npm run budget` after `vite build`)

| What | Limit (gzip) |
|---|---|
| Entry (index script + its static imports) | ≤ 150 kB |
| Each lazy chunk (pages, sheets, explainers) | ≤ 40 kB |
| All CSS | ≤ 25 kB |

Every page, the palette, the Adjust look drawer, the check-in sheet, the For-you toasts, the markdown renderer and the
explainers are lazy chunks; the Next actions provider loads with the page chunk.
