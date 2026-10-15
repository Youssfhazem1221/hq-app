// HQ v3 shared contracts (module A). Frozen after wave 1: a change goes through the integrator, never straight in.
// Types first, then the few constants and helpers every module shares. No React runtime here, no app state.
import type { ReactNode } from 'react'
import type { Model } from './hq'
import type { Me, Source } from './source'

// ---------------------------------------------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------------------------------------------

/** The icon enum explainer blocks may use (`icon:` in a ```explainer step, node or card). Anything else → null. */
export const EXPLAINER_ICONS = [
  'flag', 'route', 'chart', 'users', 'arrow', 'spark', 'file', 'folder', 'db', 'bell', 'pc', 'repo', 'globe', 'lock', 'check',
  'clock', 'idea', 'question', 'layers', 'map', 'pin', 'coins', 'briefcase', 'layout', 'user', 'bot', 'zap', 'win', 'learned', 'blocked',
] as const
export type ExplainerIcon = (typeof EXPLAINER_ICONS)[number]
/** App icons (one stroke family). Every name maps to a lucide-react icon in lib/icons.tsx; an unknown name draws a dot. */
export type AppIcon =
  | 'home' | 'projects' | 'tasks' | 'board' | 'settings' | 'search' | 'plus' | 'wand' | 'moon' | 'sun' | 'chevR' | 'chevL'
  | 'chevD' | 'up' | 'down' | 'dots' | 'x' | 'info' | 'inbox' | 'cal' | 'history' | 'eye' | 'eyeOff' | 'sidebar' | 'menu'
  | 'table' | 'focus' | 'leaf' | 'type' | 'contrast' | 'undo' | 'copy' | 'ext' | 'play' | 'pause' | 'done' | 'doing'
  | 'thought' | 'update' | 'keyboard' | 'grid' | 'cols' | 'list' | 'gantt' | 'link' | 'commit' | 'hook' | 'gear' | 'grip'
  | 'plug' | 'cloud' | 'local' | 'refresh' | 'alert' | 'ok' | 'idea' | 'send' | 'logout' | 'loader' | 'star' | 'target'
export type IconName = ExplainerIcon | AppIcon | (string & {})

// ---------------------------------------------------------------------------------------------------------------
// Next: one item, one fixed button per kind (spec §2.3). The resolver is C1's lib/next-core.ts.
// ---------------------------------------------------------------------------------------------------------------

export type NextKind = 'help' | 'join' | 'decision' | 'todo' | 'milestone' | 'status' | 'checkin'
/** `id` is stable across pages (Home, Projects, Tasks and my own Person page show the same `data-next`). `project` = slug,
 *  `path` = the repo file behind it, `from` = login that asked, `since` = ISO date. */
export type NextItem = { kind: NextKind; id: string; text: string; project?: string; path?: string; from?: string; since?: string }
/** The ONLY button each kind ever gets. Icon goes after the label, except `todo` (tick first). */
export const NEXT_BUTTON: Record<NextKind, { label: string; icon: IconName }> = {
  help: { label: 'Open', icon: 'arrow' },
  join: { label: 'Review', icon: 'users' },
  decision: { label: 'Decide', icon: 'arrow' },
  todo: { label: 'Done', icon: 'check' },
  milestone: { label: 'Make it a to-do', icon: 'tasks' },
  status: { label: 'Make it a to-do', icon: 'tasks' },
  checkin: { label: 'Check in', icon: 'plus' },
}
/** Next completion: the bar fills for this long, then moves on. Reduced motion (OS or pref) = 0 (see bp.ts reducedMotion()). */
export const NEXT_FILL_MS = 520
/** Provided by C1 (`NextActionsProvider`) through `NextActionsContext` from lib/hq-context.tsx. `completing` = the id of
 *  the item whose bars are filling right now (every `NextBar` with that id shows the fill). */
export type NextActions = { act: (item: NextItem) => void; completing?: string | null }

// ---------------------------------------------------------------------------------------------------------------
// Page header, blocks
// ---------------------------------------------------------------------------------------------------------------

/** A header tile. `null`/`false`, an empty value or a zero ('0', '0 h', 0) is dropped: tiles never show 0. Max 3 render. */
export type TileSpec = { value: ReactNode; label: string; delta?: { text: string; good: boolean }; sample?: boolean } | null | false
/** Per-document render context for rich blocks (```chart, ```explainer). At most MAX_RICH_BLOCKS rich blocks per ctx:
 *  the next one renders as its code block. `decide` = an open decision that links this doc (compare adds ONE Next). */
export type BlockCtx = { rich: { n: number }; docPath?: string; decide?: NextItem | null }
export const MAX_RICH_BLOCKS = 4
export type BlockRenderer = (src: string, ctx: BlockCtx) => ReactNode
/** D implements `useForYouToasts`; App runs it on every model rebuild (local and GitHub mode). null = nothing loaded yet. */
export type ForYouToastsHook = (model: Model | null, me: Me | null) => void

// ---------------------------------------------------------------------------------------------------------------
// Look prefs (UiPrefs v1, flat keys, enum-only). E's ui-prefs-core.ts owns the normalizer; this is the shape everyone
// reads. E's prefs.ts returns a `PrefsApi` with these exact types.
// ---------------------------------------------------------------------------------------------------------------

export type NavId = 'home' | 'projects' | 'tasks' | 'board' | 'ask' | 'people'
export type HomeWidget = 'ask' | 'foryou' | 'week' | 'projects' | 'activity'
export type ProjectWidget = 'journey' | 'explainers' | 'team' | 'files' | 'activity'
export type PersonWidget = 'checkins' | 'foryou' | 'time' | 'energy' | 'projects' | 'log'
export type UiPrefs = {
  v?: 1
  theme: 'system' | 'light' | 'dark'
  accent: 'violet' | 'blue' | 'green' | 'amber' | 'rose' | 'slate'
  density: 'compact' | 'comfy' | 'spacious'
  size: 's' | 'm' | 'l' | 'xl' | 'xxl'
  font: 'inter' | 'lexend' | 'atkinson' | 'system'
  lh: 'normal' | 'relaxed' | 'loose'
  ls: 'normal' | 'wide'
  motion: 'system' | 'reduced' | 'full'
  contrast: 'normal' | 'high'
  calm: 'off' | 'on'
  focus: 'off' | 'on'
  /** Single-key shortcuts (L, G H, N, X, ?). 'off' = WCAG 2.1.4. Ctrl/⌘ shortcuts always work. */
  keys: 'on' | 'off'
  home_order: HomeWidget[]
  home_hidden: HomeWidget[]
  project_order: ProjectWidget[]
  project_hidden: ProjectWidget[]
  person_order: PersonWidget[]
  person_hidden: PersonWidget[]
  nav_order: NavId[]
  /** 'home' can never be hidden. */
  nav_hidden: NavId[]
  /** `project:<slug>` | `doc:<path>` | `person:<slug>`, ≤8. Existence is checked at render (never at load). */
  pinned: string[]
}
/** E implements (`usePrefs()`); A provides it to the tree through `PrefsContext` (lib/hq-context.tsx). */
export type PrefsApi = {
  prefs: UiPrefs
  preview(p: Partial<UiPrefs>): void
  apply(p: Partial<UiPrefs>, label: string): void
  undo(): void
  reset(): void
}
/** localStorage cache of a person's look: `hq.ui.<login lowercased>`, or `hq.ui.@local` before anyone signs in. The
 *  cache holds UiPrefs keys only (enum values). `hq.ui.@last` holds (JSON) the login whose cache the pre-paint script
 *  in index.html reads first. Whoever writes a cache also writes `@last`. */
export const PREFS_CACHE_PREFIX = 'hq.ui.'
export const PREFS_LAST_KEY = 'hq.ui.@last'
export const PREFS_LOCAL_LOGIN = '@local'
export const prefsCacheKey = (login?: string | null) => PREFS_CACHE_PREFIX + (login ? String(login).toLowerCase() : PREFS_LOCAL_LOGIN)
/** index.html carries the enum lists between these markers as plain JSON (E's prepaint-parity test reads them). */
export const PREPAINT_ENUM_START = '/*HQ_ENUM*/'
export const PREPAINT_ENUM_END = '/*HQ_ENUM_END*/'

// ---------------------------------------------------------------------------------------------------------------
// Routes and pages (lib/router.ts parses, routes.tsx loads)
// ---------------------------------------------------------------------------------------------------------------

export type PageName = 'Home' | 'Projects' | 'Project' | 'Tasks' | 'Board' | 'Ask' | 'People' | 'Person' | 'Docs' | 'Settings'
/** `#/` Home · `#/projects` · `#/projects/<slug>` · `#/tasks` · `#/board` · `#/ask` · `#/people` (`#/people/_team` = the
 *  Together tab) · `#/people/<slug>` · `#/me` (→ my slug) · `#/docs/<path>` · `#/settings`. Old `#/todos` = Tasks. */
export type Route = {
  page: PageName
  nav: NavId | 'docs' | 'settings'
  /** The hash path without '#', e.g. '/projects/demo'. */
  path: string
  slug?: string
  doc?: string
  person?: string
  tab?: string
}
/** Every page gets the route. Page modules also export `export const v3 = true` (routes.test checks it). */
export type PageProps = { route: Route }
export type SettingsPageProps = PageProps & { source: Source | null; onConnect: (s: Source | null) => void }

// ---------------------------------------------------------------------------------------------------------------
// Shell events, palette, toasts
// ---------------------------------------------------------------------------------------------------------------

/** Window CustomEvents the shell fires. A listener that handles one calls `event.preventDefault()` so the shell knows
 *  (otherwise it falls back: check-in → toast, adjust look → Settings). */
export const HQ_EVENTS = {
  /** Open D's check-in sheet. Detail: CheckinDetail. */
  checkin: 'hq:checkin',
  /** Open E's Adjust look drawer (focus in its input). Detail: AdjustLookDetail. */
  adjustLook: 'hq:adjust-look',
  /** `N`: the current page's "new item" (Tasks: focus quick-add, Board: open the composer). Detail: NewItemDetail. */
  newItem: 'hq:new',
} as const
export type CheckinDetail = { text?: string; project?: string }
export type AdjustLookDetail = { query?: string }
export type NewItemDetail = { page: PageName }
/** Fire a shell event. Returns true when a listener handled it (called preventDefault()). */
export function fire(name: (typeof HQ_EVENTS)[keyof typeof HQ_EVENTS], detail: object = {}): boolean {
  if (typeof window === 'undefined') return false
  const e = new CustomEvent(name, { detail, cancelable: true })
  window.dispatchEvent(e)
  return e.defaultPrevented
}

export type PaletteGroup = 'Suggested' | 'Go to' | 'Create' | 'Look' | 'Ask AI'
/** `color` = a project colour slot 1–8 (drawn as a dot, never an inline value). `top` = jump to the very top when it
 *  matches (e.g. "Adjust look: …" when E's local parser finds a change). `hint` = right-hand key or label. */
export type PaletteItem = {
  id: string
  group: PaletteGroup
  label: string
  icon?: IconName
  color?: number
  hint?: string
  keywords?: string
  top?: boolean
  run: () => void
}
/** Registered with `registerPaletteSource(fn)` (components/shell/Palette.tsx). Called on every keystroke with the query
 *  ('' = suggestions). Return few items; the palette ranks, groups and caps them. */
export type PaletteSource = (q: string, ctx: { model: Model | null; me: Me | null; route: Route }) => PaletteItem[]

/** `you` = For-you toasts (D). Max 2 on screen, 6 s, one line, optional Undo. */
export type ToastKind = 'commit' | 'local' | 'bot' | 'info' | 'error' | 'ok' | 'you'
export type ToastOpts = { undo?: () => void; ms?: number }
