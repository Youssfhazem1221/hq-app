// Pure shell logic (no React, no DOM at import time): nav table, pins, the Pages tree, breadcrumbs, palette ranking and
// registry, header tiles, and the keyboard map. Tested by app/test/shell.test.ts.
import { title, type Doc } from '../../lib/md'
import type { Model } from '../../lib/hq'
import type { Me } from '../../lib/source'
import { EXPLAINER_ICONS, type IconName, type NavId, type PaletteItem, type PaletteSource, type Route, type TileSpec, type UiPrefs } from '../../lib/contracts'

// ---- nav ----

export const NAV: Record<NavId, { icon: IconName; label: string; path: string; key: string }> = {
  home: { icon: 'home', label: 'Home', path: '/', key: 'H' },
  projects: { icon: 'projects', label: 'Projects', path: '/projects', key: 'P' },
  tasks: { icon: 'tasks', label: 'Tasks', path: '/tasks', key: 'T' },
  board: { icon: 'board', label: 'Board', path: '/board', key: 'B' },
  ask: { icon: 'spark', label: 'Ask AI', path: '/ask', key: 'A' },
  people: { icon: 'users', label: 'People', path: '/people', key: 'E' },
}
const NAV_IDS = Object.keys(NAV) as NavId[]

/** Sidebar order from prefs (unknown ids ignored, missing ones appended); hidden ones dropped; Home always shown. */
export function navList(prefs: Pick<UiPrefs, 'nav_order' | 'nav_hidden'>): NavId[] {
  const order = [...(prefs.nav_order || []).filter((k) => NAV_IDS.includes(k)), ...NAV_IDS]
  const seen = new Set<NavId>()
  return order.filter((k) => !seen.has(k) && (seen.add(k), true) && (k === 'home' || !(prefs.nav_hidden || []).includes(k)))
}

// ---- people ----

/** Initials from the words of a name: "Ada Lovelace" → AL, "bob" → BO. Brackets and symbols are skipped, so
 *  "Ada (ada99)" → AD, never "A(". */
export function initials(name: string) {
  const words = String(name || '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => /\p{L}/u.test(w))
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

// ---- tiles ----

const ZERO = /^\s*0(?:[.,]0+)?\s*(?:[a-z%]{1,5})?\s*$/i
const isZeroish = (v: unknown) => v == null || v === false || v === 0 || (typeof v === 'string' && (!v.trim() || ZERO.test(v)))

/** Header tiles that render: drops null/false, empty values and zeros (0, '0', '0 h', '0%'); at most 3. */
export function shownTiles(tiles: TileSpec[] | undefined | null) {
  return (tiles || []).filter((t): t is Exclude<TileSpec, null | false> => !!t && typeof t === 'object' && !isZeroish(t.value)).slice(0, 3)
}

const tileText = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
/** Header tiles: shownTiles(), minus any tile that repeats the sub line (`subText` = the sub line as plain text). */
export function headerTiles(tiles: TileSpec[] | undefined | null, subText = '') {
  const line = squash(subText)
  return shownTiles(
    (tiles || []).filter((t) => {
      if (!t || !line) return true
      const text = squash(`${tileText(t.value)} ${t.label}`)
      return !text || !(line.includes(text) || (text.length > 3 && text.includes(line)))
    }),
  )
}

// ---- projects, pins ----

const same = (a: unknown, b: unknown) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()
export const projectSlugOf = (d: Doc) => (d.path.match(/^projects\/([^/]+)\//) || d.path.match(/^projects\/([^/]+)\.md$/i))?.[1] || ''
/** Project colour slot from `color:` (an integer 1–8); anything else is slot 1. Never an inline value from data. */
export function colorSlot(v: unknown) {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 8 ? n : 1
}
const listOf = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',').map((s) => s.trim()) : [])
export const isMine = (p: Doc, login?: string | null) =>
  !!login && (same(p.data.owner, login) || listOf(p.data.members).some((m) => same(m, login)))

export type Pin = { id: string; kind: 'project' | 'doc' | 'person'; title: string; href: string; color?: number }

/** Pinned shown now: stored pins that exist; none stored → up to 2 of MY active projects (derived, never hard-coded). */
export function pinnedNow(prefs: Pick<UiPrefs, 'pinned'>, model: Model | null, me: Me | null): Pin[] {
  if (!model) return []
  const resolve = (id: string): Pin | null => {
    const i = id.indexOf(':')
    const kind = id.slice(0, i)
    const key = id.slice(i + 1)
    if (kind === 'project') {
      const p = model.projects.find((d) => projectSlugOf(d) === key)
      return p ? { id, kind, title: String(p.data.title || key), href: '#/projects/' + key, color: colorSlot(p.data.color) } : null
    }
    if (kind === 'doc') {
      const d = model.byPath.get(key)
      return d ? { id, kind, title: title(d), href: '#/docs/' + key } : null
    }
    if (kind === 'person') {
      const p = model.roster.find((x) => same(x.slug, key))
      return p ? { id, kind, title: p.name || p.login, href: '#/people/' + p.slug } : null
    }
    return null
  }
  const stored = prefs.pinned || []
  if (stored.length) return stored.map(resolve).filter((x): x is Pin => !!x)
  return model.projects
    .filter((p) => String(p.data.status || '') === 'active' && isMine(p, me?.login))
    .slice(0, 2)
    .map((p) => resolve('project:' + projectSlugOf(p)))
    .filter((x): x is Pin => !!x)
}

// ---- Pages tree (model.knowledge only; projects/, people/, ai/, board/, todos/ never listed) ----

export type TreeDoc = { path: string; title: string; icon: IconName }
export type TreeDir = { dir: string; label: string; items: TreeDoc[] }
const HIDDEN_TREE = /^(projects|people|ai|board|todos)\//i

const docIcon = (d: Doc, model: Model): IconName => {
  const ic = d.data.icon
  if (typeof ic === 'string' && (EXPLAINER_ICONS as readonly string[]).includes(ic)) return ic
  if (model.status && d.path === model.status.path) return 'flag'
  return 'file'
}
/** "money-ideas" → "Money ideas". */
export const folderLabel = (dir: string) => {
  const s = dir.replace(/[-_]+/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : dir
}

export function pagesTree(model: Model | null): { dirs: TreeDir[]; files: TreeDoc[] } {
  if (!model) return { dirs: [], files: [] }
  const docs = model.knowledge.filter((d) => !HIDDEN_TREE.test(d.path))
  const item = (d: Doc): TreeDoc => ({ path: d.path, title: title(d), icon: docIcon(d, model) })
  const byTitle = (a: TreeDoc, b: TreeDoc) => a.title.localeCompare(b.title)
  const dirs = new Map<string, TreeDoc[]>()
  const files: TreeDoc[] = []
  for (const d of docs) {
    const i = d.path.indexOf('/')
    if (i < 0) files.push(item(d))
    else {
      const dir = d.path.slice(0, i)
      dirs.set(dir, [...(dirs.get(dir) || []), item(d)])
    }
  }
  return {
    dirs: [...dirs].map(([dir, items]) => ({ dir, label: folderLabel(dir), items: items.sort(byTitle) })).sort((a, b) => a.label.localeCompare(b.label)),
    files: files.sort(byTitle),
  }
}

// ---- breadcrumbs ----

export type Crumb = { label: string; href?: string; icon?: IconName }
const PAGE_CRUMB: Record<string, Crumb> = {
  Home: { label: 'Home', href: '#/', icon: 'home' },
  Projects: { label: 'Projects', href: '#/projects', icon: 'projects' },
  Tasks: { label: 'Tasks', href: '#/tasks', icon: 'tasks' },
  Board: { label: 'Board', href: '#/board', icon: 'board' },
  Ask: { label: 'Ask AI', href: '#/ask', icon: 'spark' },
  People: { label: 'People', href: '#/people', icon: 'users' },
  Settings: { label: 'Settings', href: '#/settings', icon: 'settings' },
}

/** Breadcrumbs for the top bar (the last one is the current page; phones show only that one). */
export function crumbsFor(route: Route, model: Model | null): Crumb[] {
  if (route.page === 'Project') {
    const p = model?.projects.find((d) => projectSlugOf(d) === route.slug)
    return [PAGE_CRUMB.Projects, { label: String(p?.data.title || route.slug || 'Project') }]
  }
  if (route.page === 'Person') {
    const who = route.person === 'claude' ? 'Claude' : model?.roster.find((p) => same(p.slug, route.person))?.name || route.person || 'Person'
    return [PAGE_CRUMB.People, { label: who }]
  }
  if (route.page === 'People' && route.tab === 'together') return [PAGE_CRUMB.People, { label: 'Together' }]
  if (route.page === 'Docs') {
    const doc = route.doc ? model?.byPath.get(route.doc) : undefined
    const leaf = { label: doc ? title(doc) : route.doc ? route.doc.split('/').pop()!.replace(/\.md$/i, '') : 'Pages' }
    if (!route.doc) return [{ label: 'Pages', icon: 'file' }]
    const i = route.doc.indexOf('/')
    return i > 0 ? [{ label: folderLabel(route.doc.slice(0, i)), icon: 'folder' }, leaf] : [{ label: 'Pages', icon: 'file' }, leaf]
  }
  return [PAGE_CRUMB[route.page] || PAGE_CRUMB.Home]
}

// ---- palette ----

/** 2 = substring, 1 = letters in order, 0 = no match. */
export function fuzzy(q: string, s: string) {
  const a = q.toLowerCase().trim()
  const b = s.toLowerCase()
  if (!a) return 1
  if (b.includes(a)) return 2
  let i = 0
  for (let k = 0; k < b.length && i < a.length; k++) if (b[k] === a[i]) i++
  return i === a.length ? 1 : 0
}

export const PALETTE_GROUPS = ['Suggested', 'Look', 'Go to', 'Create', 'Ask AI'] as const
const GROUP_ORDER: Record<string, number> = { Suggested: 0, 'Go to': 1, Create: 2, Look: 3, 'Ask AI': 4 }

/** Rank palette items for a query. Empty query: Suggested first, then the rest in group order. With a query: `top`
 *  items first (e.g. "Adjust look: …"), then matches by score, Ask AI last. At most `cap` items, ids deduped. */
export function rankPalette(items: PaletteItem[], q: string, cap = 40): PaletteItem[] {
  const seen = new Set<string>()
  const uniq = items.filter((it) => it && typeof it.run === 'function' && !seen.has(it.id) && (seen.add(it.id), true))
  const query = q.trim()
  if (!query) {
    return uniq
      .filter((it) => it.group !== 'Ask AI' || it.id.startsWith('suggest:'))
      .map((it, i) => ({ it, i }))
      // Spec §2.2: the Next item leads Suggested (it comes from a registered source, so it would otherwise sort last).
      .sort((a, b) => (GROUP_ORDER[a.it.group] ?? 9) - (GROUP_ORDER[b.it.group] ?? 9) || (b.it.id === 'suggest:next' ? 1 : 0) - (a.it.id === 'suggest:next' ? 1 : 0) || a.i - b.i)
      .map((x) => x.it)
      .slice(0, cap)
  }
  const scored = uniq
    .filter((it) => it.group !== 'Suggested')
    .map((it, i) => ({ it, i, s: it.top || it.group === 'Ask AI' ? 1 : Math.max(fuzzy(query, it.label), fuzzy(query, it.keywords || '') ? 1 : 0) }))
    .filter((x) => x.s > 0)
  const top = scored.filter((x) => x.it.top)
  const ask = scored.filter((x) => !x.it.top && x.it.group === 'Ask AI')
  const rest = scored.filter((x) => !x.it.top && x.it.group !== 'Ask AI').sort((a, b) => b.s - a.s || a.i - b.i)
  return [...top, ...rest, ...ask].map((x) => x.it).slice(0, cap)
}

const sources = new Set<PaletteSource>()
/** Add palette items from another module (Next item, presets, "Adjust look: …", people…). Returns the unregister fn. */
export function registerPaletteSource(fn: PaletteSource): () => void {
  sources.add(fn)
  return () => void sources.delete(fn)
}
/** Items from every registered source; a source that throws is skipped. */
export function sourcedItems(q: string, ctx: Parameters<PaletteSource>[1]): PaletteItem[] {
  const out: PaletteItem[] = []
  for (const fn of sources) {
    try {
      const r = fn(q, ctx)
      if (Array.isArray(r)) out.push(...r)
    } catch {
      /* a broken source never breaks the palette */
    }
  }
  return out
}

// ---- keyboard ----

export const GO_KEYS: Record<string, string> = { h: '/', p: '/projects', t: '/tasks', b: '/board', a: '/ask', e: '/people', s: '/settings' }
export type KeyIn = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean }
export type KeyState = { keys: 'on' | 'off'; typing: boolean; gPending: boolean }
export type KeyAction =
  | { type: 'palette' | 'adjust' | 'rail' | 'escape' | 'checkin' | 'g' | 'new' | 'tick' | 'help' }
  | { type: 'go'; to: string }
  | { type: 'gcancel' }
  | null

/** What a keydown does (spec §2.4). Ctrl/⌘ K · . · \ always work; single keys (L, G+x, N, X, ?) only with keys 'on',
 *  never while typing, never with stray modifiers. */
export function keyAction(e: KeyIn, s: KeyState): KeyAction {
  const k = e.key
  const mod = !!(e.ctrlKey || e.metaKey)
  if (mod && !e.altKey && !e.shiftKey && (k === 'k' || k === 'K')) return { type: 'palette' }
  if (mod && !e.altKey && k === '.') return { type: 'adjust' }
  if (mod && !e.altKey && k === '\\') return { type: 'rail' }
  if (k === 'Escape') return { type: 'escape' }
  if (s.typing || mod || e.altKey) return null
  if (s.keys === 'off') return null
  if (e.shiftKey && k !== '?') return null
  if (s.gPending) {
    const to = GO_KEYS[k.toLowerCase()]
    return to ? { type: 'go', to } : { type: 'gcancel' }
  }
  if (k === 'g' || k === 'G') return { type: 'g' }
  if (k === 'l' || k === 'L') return { type: 'checkin' }
  if (k === 'n' || k === 'N') return { type: 'new' }
  if (k === 'x' || k === 'X') return { type: 'tick' }
  if (k === '?') return { type: 'help' }
  return null
}
