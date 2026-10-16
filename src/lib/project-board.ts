// Project board + grouped pages (pure, total: junk in → no board / safe groups out).
// Board: a project opts in with a `board:` key in project.md. Cards are <folder>/<item>/README.md files; each card's
// frontmatter `field` (default `stage`) puts it in a lane, `date` (default `publish`) is its go-live day, and `due:`
// maps a stage to a day offset from that date (e.g. script: -3), so every card shows its next gate and when it's due.
//   board: { title: Shorts, folder: videos, field: stage, date: publish,
//            lanes: [{ name: Idea, stages: [idea] }, …], due: { script: -3, published: 0 } }
// Pages: every note of the project, grouped by top-level folder (the folder's README names the group), one row per
// sub-folder that has a README (its other notes become chips), template pages hidden.
import type { Doc } from './md'
import { setTopKeys } from './people-core'

export type BoardLane = { name: string; stages: string[] }
export type BoardConfig = { title: string; folder: string; field: string; date: string; lanes: BoardLane[]; stages: string[]; due: Record<string, number> }
export type DocLink = { path: string; title: string }
export type BoardCard = { path: string; item: string; title: string; stage: string; date: string | null; next: { stage: string; due: string } | null; late: boolean; links: DocLink[] }
export type Board = { config: BoardConfig; lanes: { lane: BoardLane; cards: BoardCard[] }[]; total: number }

const str = (v: unknown) => (v == null ? '' : String(v)).trim()
const SAFE = /^[a-z0-9][a-z0-9_-]{0,40}$/i
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)

/** 'YYYY-MM-DD' from a YAML date (string or Date), else null. */
export function isoOf(v: unknown): string | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString().slice(0, 10) : null
  const m = str(v).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 ? `${m[1]}-${m[2]}-${m[3]}` : null
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** '2026-10-18' → 'Sun 18 Oct'. */
export function dayName(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00Z')
  return Number.isFinite(d.getTime()) ? `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : iso
}

/** The project's `board:` key → a clean config, or null when it is missing or unusable. */
export function boardConfig(project: Doc | null | undefined, slug: string): BoardConfig | null {
  const b = project?.data?.board
  if (!isObj(b) || !/^[\w-]{1,80}$/.test(slug)) return null
  const folder = str(b.folder).replace(/^\/+|\/+$/g, '')
  if (!folder || folder.split('/').some((s) => !s || s === '.' || s === '..') || !/^[\w./-]{1,80}$/.test(folder)) return null
  const lanes: BoardLane[] = (Array.isArray(b.lanes) ? b.lanes : [])
    .slice(0, 8)
    .map((l: unknown) => ({
      name: str(isObj(l) ? l.name : '').slice(0, 30),
      stages: ((isObj(l) && Array.isArray(l.stages) ? l.stages : isObj(l) ? [l.stages] : []) as unknown[]).map((s) => str(s).toLowerCase()).filter((s) => SAFE.test(s)).slice(0, 8),
    }))
    .filter((l) => l.name && l.stages.length)
  if (!lanes.length) return null
  const stages = [...new Set(lanes.flatMap((l) => l.stages))]
  const due: Record<string, number> = {}
  if (isObj(b.due)) for (const [k, v] of Object.entries(b.due)) if (stages.includes(k.toLowerCase()) && Number.isFinite(Number(v))) due[k.toLowerCase()] = Math.max(-60, Math.min(60, Math.round(Number(v))))
  const key = (v: unknown, fallback: string) => (SAFE.test(str(v)) ? str(v) : fallback)
  return { title: str(b.title).slice(0, 40) || 'Board', folder: `projects/${slug}/${folder}`, field: key(b.field, 'stage'), date: key(b.date, 'publish'), lanes, stages, due }
}

/** The next stage after `stage` that has a due offset, and its due day. null without a date or past the last gate. */
export function nextGate(cfg: BoardConfig, stage: string, date: string | null): { stage: string; due: string } | null {
  if (!date) return null
  for (let j = cfg.stages.indexOf(stage) + 1; j < cfg.stages.length; j++) {
    const s = cfg.stages[j]
    if (s in cfg.due) return { stage: s, due: addDays(date, cfg.due[s]) }
  }
  return null
}

const titleOf = (d: Doc) => str(d.data?.title) || (d.path.split('/').pop() || d.path).replace(/\.md$/i, '')

/** The board: cards by lane, ordered by go-live day. A card with an unknown stage lands in the first lane. */
export function boardOf(cfg: BoardConfig, files: Doc[], today: string): Board {
  const prefix = cfg.folder + '/'
  const items = new Map<string, Doc[]>()
  for (const d of files || []) {
    if (!d || typeof d.path !== 'string' || !d.path.startsWith(prefix)) continue
    const parts = d.path.slice(prefix.length).split('/')
    if (parts.length !== 2 || !parts[0]) continue
    items.set(parts[0], [...(items.get(parts[0]) || []), d])
  }
  const cards: BoardCard[] = []
  for (const [item, docs] of items) {
    const card = docs.find((d) => /\/README\.md$/i.test(d.path))
    if (!card) continue
    const stage = str(card.data?.[cfg.field]).toLowerCase()
    const date = isoOf(card.data?.[cfg.date])
    const next = nextGate(cfg, stage, date)
    cards.push({
      path: card.path, item, title: titleOf(card), stage, date, next, late: !!next && next.due < today,
      links: docs.filter((d) => d !== card).map((d) => ({ path: d.path, title: titleOf(d) })).sort((a, b) => a.path.localeCompare(b.path)),
    })
  }
  cards.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.item.localeCompare(b.item))
  const lanes = cfg.lanes.map((lane) => ({ lane, cards: cards.filter((c) => lane.stages.includes(c.stage)) }))
  lanes[0].cards.push(...cards.filter((c) => !cfg.stages.includes(c.stage)))
  return { config: cfg, lanes, total: cards.length }
}

/** A card file with a new stage and/or go-live day; every other byte stays as it was. */
export function setCard(text: string, cfg: BoardConfig, patch: { stage?: string; date?: string | null }): string {
  const p: Record<string, unknown> = {}
  if (patch.stage !== undefined && SAFE.test(patch.stage)) p[cfg.field] = patch.stage
  if (patch.date !== undefined) p[cfg.date] = patch.date && isoOf(patch.date) ? isoOf(patch.date) : null
  return Object.keys(p).length ? setTopKeys(text, p as never) : text
}

// ---- grouped pages ----

export type PageRow = { path: string; title: string; links: DocLink[] }
export type PageGroup = { key: string; label: string; index: string | null; rows: PageRow[]; count: number; board: boolean }

const hidden = (d: Doc) => /\/template\//i.test(d.path) || /\{\{\s*\w+\s*\}\}/.test(titleOf(d))
const human = (s: string) => s.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

/** The project's notes by top-level folder. Main pages first (the hub on top, plus any hub or `docs:` page kept outside
 *  the folder), then folders A–Z. Inside a group, pages named in `order` (hub, then `docs:`) come first, in that order. */
export function pageGroups(slug: string, docs: Doc[], opts: { hub?: string; boardFolder?: string | null; order?: string[] } = {}): PageGroup[] {
  const base = `projects/${slug}/`
  const seen = new Set<string>()
  const list = (docs || []).filter((d) => d && typeof d.path === 'string' && !/(^|\/)project\.md$/i.test(d.path) && !hidden(d) && !seen.has(d.path) && (seen.add(d.path), true))
  const byTop = new Map<string, Doc[]>()
  for (const d of list) {
    const rel = d.path.startsWith(base) ? d.path.slice(base.length) : ''
    const top = rel.includes('/') ? rel.split('/')[0] : ''
    byTop.set(top, [...(byTop.get(top) || []), d])
  }
  const order = (opts.order || []).filter(Boolean)
  const rank = (path: string) => (order.includes(path) ? order.indexOf(path) : order.length)
  const groups: PageGroup[] = []
  for (const top of [...byTop.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))) {
    const ds = byTop.get(top)!
    const dir = base + (top ? top + '/' : '')
    const index = top ? ds.find((d) => d.path.toLowerCase() === (dir + 'readme.md').toLowerCase()) || null : null
    const rows: PageRow[] = []
    const subs = new Map<string, Doc[]>()
    for (const d of ds) {
      if (d === index) continue
      const rel = top ? d.path.slice(dir.length) : ''
      if (!rel.includes('/')) rows.push({ path: d.path, title: titleOf(d), links: [] })
      else subs.set(rel.split('/')[0], [...(subs.get(rel.split('/')[0]) || []), d])
    }
    for (const [sub, sds] of [...subs].sort((a, b) => a[0].localeCompare(b[0]))) {
      const head = sds.find((d) => d.path.toLowerCase() === (dir + sub + '/readme.md').toLowerCase())
      if (head) rows.push({ path: head.path, title: titleOf(head), links: sds.filter((d) => d !== head).map((d) => ({ path: d.path, title: titleOf(d) })).sort((a, b) => a.path.localeCompare(b.path)) })
      else for (const d of sds) rows.push({ path: d.path, title: titleOf(d), links: [] })
    }
    if (!top) rows.sort((a, b) => (a.path === opts.hub ? -1 : b.path === opts.hub ? 1 : rank(a.path) - rank(b.path) || a.title.localeCompare(b.title)))
    else rows.sort((a, b) => rank(a.path) - rank(b.path))
    groups.push({
      key: top, label: top ? (index ? titleOf(index) : human(top)) : 'Main pages', index: index ? index.path : null, rows,
      count: rows.length + rows.reduce((a, r) => a + r.links.length, 0) + (index ? 1 : 0),
      board: !!opts.boardFolder && dir === opts.boardFolder + '/',
    })
  }
  return groups.filter((g) => g.rows.length || g.index)
}
