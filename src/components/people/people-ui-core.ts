// People UI (module D): the pure parts, no React, so node tests can reach them. Week dots, the 12-week heatmap, the
// header tiles, For-you rows, the check-in "Reads as" line, the Together pairs layout, the onboarding prompt and the
// profile draft → profile mapping. Everything here is derived from the model; nothing is written.
import type { IconName, TileSpec } from '../../lib/contracts'
import {
  DEFAULT_LOG_CONFIG, KINDS, LIMITS, PRESETS, SENSITIVE_KEYS, TEAM_TZ, ageText, entryMinutes, toIso, validTz, validateConfig, weekStart,
  zonedParts,
  type Entry, type FieldValue, type ForYouItem, type LogConfig, type LogField, type NewEntry, type Pair,
} from '../../lib/people-core'

const DAY_MS = 864e5
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ---------------------------------------------------------------------------------------------------------------
// words
// ---------------------------------------------------------------------------------------------------------------

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
/** "1 person so far" · "3 people so far" (plural-correct). */
export const peopleSoFar = (n: number) => `${plural(n, 'person', 'people')} so far`

/** Minutes → "45 min" · "2 h" · "1.5 h" · "" for 0. */
export function fmtMinutes(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return ''
  if (min < 60) return `${Math.round(min)} min`
  const h = Math.round((min / 60) * 10) / 10
  return `${h} h`
}

/** "15 Oct" from YYYY-MM-DD. */
export function dayMonth(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '')
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] || ''}`.trim() : date
}
/** "Thu 15 Oct" from YYYY-MM-DD. */
export function dayLabel(date: string): string {
  const t = Date.parse(date + 'T00:00:00Z')
  return Number.isFinite(t) ? `${DAYS[new Date(t).getUTCDay()]} ${dayMonth(date)}` : date
}
const addDays = (date: string, n: number) => new Date(Date.parse(date + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10)
const zone = (tz: string | undefined) => (tz && validTz(tz) ? tz : TEAM_TZ)

/** The Person header sub line as separate parts (pronouns · role · place). Empty parts are dropped, so the line never
 *  starts or ends with a stray "·" (the page joins them with CSS gaps, not with dots). */
export function subParts(p: { pronouns?: string; role?: string; timezone?: string } | null | undefined, extra: string[] = []): string[] {
  if (!p) return extra.filter(Boolean)
  const city = p.timezone && p.timezone.includes('/') ? p.timezone.split('/').pop()!.replace(/_/g, ' ') : ''
  return [p.pronouns || '', p.role || '', city, ...extra].map((s) => String(s || '').replace(/^[\s·•|-]+|[\s·•|-]+$/g, '').trim()).filter(Boolean)
}

// ---------------------------------------------------------------------------------------------------------------
// log kinds
// ---------------------------------------------------------------------------------------------------------------

export const KIND_ICON: Record<string, IconName> = {
  done: 'done', doing: 'doing', blocked: 'blocked', unblocked: 'lock', win: 'win', learned: 'learned', idea: 'idea',
}
export const kindIcon = (k: string): IconName => KIND_ICON[k] || 'done'
export const kindLabel = (k: string) => KINDS[k]?.label || String(k || 'done')

// ---------------------------------------------------------------------------------------------------------------
// weeks: dots, heatmap, tiles
// ---------------------------------------------------------------------------------------------------------------

/** Rows per local day (YYYY-MM-DD → count). Unblock rows don't count as check-ins. */
function perDay(entries: Entry[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of entries || []) {
    if (!e || !e.date || e.kind === 'unblocked') continue
    out.set(e.date, (out.get(e.date) || 0) + 1)
  }
  return out
}

/** This week's check-ins per day in the person's week order; days still to come are null. */
export function weekCounts(entries: Entry[], cfg: LogConfig, tz: string, now: string): { counts: (number | null)[]; today: number; start: string } {
  const today = zonedParts(toIso(now), zone(tz)).date
  const start = weekStart(today, cfg.week_starts)
  const days = perDay(entries)
  const counts: (number | null)[] = []
  let t = 0
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i)
    if (d === today) t = i
    counts.push(d > today ? null : days.get(d) || 0)
  }
  return { counts, today: t, start }
}

/** `weeks` weeks of daily counts for the heatmap, oldest first, week by week (7 per week, the person's week order).
 *  Days after today are null. `start` = the date of the first cell. */
export function heatCells(entries: Entry[], cfg: LogConfig, tz: string, now: string, weeks = 12): { cells: (number | null)[]; start: string; total: number } {
  const today = zonedParts(toIso(now), zone(tz)).date
  const start = addDays(weekStart(today, cfg.week_starts), -7 * (weeks - 1))
  const days = perDay(entries)
  const cells: (number | null)[] = []
  let total = 0
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(start, i)
    const c = d > today ? null : days.get(d) || 0
    if (c) total += c
    cells.push(c)
  }
  return { cells, start, total }
}

/** Rows logged on the person's today. */
export function todayCount(entries: Entry[], tz: string, now: string): number {
  const today = zonedParts(toIso(now), zone(tz)).date
  return (entries || []).filter((e) => e && e.date === today && e.kind !== 'unblocked').length
}

/** The scale field shown as the weekly "Energy" line (the `energy` key first, else the first scale field). */
export function scaleField(cfg: LogConfig): LogField | undefined {
  const scales = (cfg?.fields || []).filter((f) => f.type === 'scale')
  return scales.find((f) => f.key === 'energy') || scales[0]
}

/** Weekly average of a scale field over the same weeks as the time chart (null = no row that week). */
export function weeklyAverage(entries: Entry[], cfg: LogConfig, key: string, weeks: string[]): (number | null)[] {
  const sums = weeks.map(() => ({ s: 0, n: 0 }))
  for (const e of entries || []) {
    const v = e?.fields?.[key]
    if (typeof v !== 'number' || !Number.isFinite(v) || !e.date) continue
    const w = weekStart(e.date, cfg.week_starts)
    const i = weeks.indexOf(w)
    if (i < 0) continue
    sums[i].s += v
    sums[i].n++
  }
  return sums.map((x) => (x.n ? Math.round((x.s / x.n) * 10) / 10 : null))
}

/** Minutes logged in [from, to) (ISO instants), read through the person's time field. */
export function minutesBetween(entries: Entry[], cfg: LogConfig, from: string, to: string): number {
  let sum = 0
  for (const e of entries || []) if (e && e.at && e.at >= from && e.at < to) sum += entryMinutes(e.fields, cfg)
  return sum
}

const TILE_LABEL: Record<string, string> = {
  checkins: 'check-ins this week', wins: 'wins this week', learned: 'learned this week', todos_done: 'to-dos done this week',
  posts: 'posts this week', replies: 'replies this week', minutes: 'time this week', hours: 'time this week',
}

/** A person's header tiles from their `log.tiles` (≤3), this week vs last week. Zeros drop out (PageHeader rule).
 *  `minutes`/`hours` show as time with a +/- delta; a number field shows its weekly sum. */
export function personTiles(tiles: string[], week: Record<string, number>, last: Record<string, number>, extra: Record<string, number> = {}): TileSpec[] {
  return (tiles || []).slice(0, LIMITS.tiles).map((m): TileSpec => {
    if (m === 'minutes' || m === 'hours') {
      const now = week.minutes || 0
      if (!now) return null
      const d = Math.round(((now - (last.minutes || 0)) / 60) * 10) / 10
      return { value: fmtMinutes(now), label: TILE_LABEL[m], delta: d ? { text: `${d > 0 ? '+' : ''}${d} h`, good: d > 0 } : undefined }
    }
    const v = m in week ? week[m] : extra[m]
    if (!v) return null
    return { value: v, label: TILE_LABEL[m] || `${m.replace(/_/g, ' ')} this week` }
  })
}

// ---------------------------------------------------------------------------------------------------------------
// For you rows
// ---------------------------------------------------------------------------------------------------------------

/** What a row's one control does. tick = the to-do is done · decide = C1's Decide sheet · review = owner answers a
 *  join/leave request · gotit = acknowledge "you were added" · open = go to the item. */
export type FyControl = 'tick' | 'decide' | 'review' | 'gotit' | 'open'
export type FyView = { icon: IconName; text: string; control: FyControl; href: string; tip: string; age: string }

const POSTS = /^board\//

/** One For-you item as a row: icon, plain words (no emoji), its one control, where it opens and the age tooltip
 *  "from Claude · 22 h ago". `decision` = this to-do is a decision (C1 opens the Decide sheet). */
/** Plain words: leading emoji / pictographs dropped (drawn icons only in the UI; post bodies often start with one). */
export const plainTitle = (s: string) => String(s || '').replace(/^[\p{Extended_Pictographic}\u2600-\u27BF\uFE0F\u200D\s]+/u, '').trim() || String(s || '').trim()

export function forYouView(raw: ForYouItem, nameOf: (login: string) => string, now: string, decision = false, titleOf: (slug: string) => string = (s) => s): FyView {
  const it = { ...raw, title: plainTitle(raw.title) }
  const from = nameOf(it.from) || it.from
  const proj = it.project ? titleOf(it.project) || it.project : ''
  const age = it.since ? ageText(it.since, now) : ''
  const tip = [from ? `from ${from}` : '', age ? (age === 'just now' ? age : `${age} ago`) : ''].filter(Boolean).join(' · ')
  const open = POSTS.test(it.path) ? '#/board' : it.path.startsWith('people/') ? '#/people/' + (it.path.split('/')[1] || '').replace(/\.md$/i, '') : '#/docs/' + it.path
  const project = it.project ? '#/projects/' + it.project : open
  switch (it.kind) {
    case 'help':
      return { icon: 'blocked', text: `${from} is blocked and asked you: ${it.title}`, control: 'tick', href: open, tip, age }
    case 'join':
      return { icon: 'users', text: `${from} asks to join ${proj || 'a project'} as ${it.part || 'a member'}`, control: 'review', href: project, tip, age }
    case 'leave':
      return { icon: 'logout', text: `${from} asks to leave ${proj || 'a project'}`, control: 'review', href: project, tip, age }
    case 'assigned':
      return { icon: decision ? 'route' : 'tasks', text: it.title, control: decision ? 'decide' : 'tick', href: open, tip, age }
    case 'to-me':
      return { icon: 'board', text: `${from}: ${it.title}`, control: 'open', href: open, tip, age }
    case 'added':
      return { icon: 'folder', text: `You were added to ${it.title}${it.part ? ` as ${it.part}` : ''}`, control: 'gotit', href: project, tip, age }
    case 'reply':
      return { icon: 'thought', text: `${from} replied to your post: ${it.title}`, control: 'open', href: open, tip, age }
    case 'mention':
      return { icon: 'user', text: `${from} mentioned you: ${it.title}`, control: 'open', href: open, tip, age }
    case 'digest':
      return { icon: 'cal', text: `${it.title} is ready`, control: 'open', href: open, tip, age }
  }
  return { icon: 'inbox', text: it.title, control: 'open', href: open, tip, age }
}

/** Is this to-do (frontmatter) a decision? `kind: decision`, or a Pick/Choose/Decide title that links a doc with
 *  `options:` (spec §2.3; C1's next-core has the same rule). */
export function isDecisionData(data: Record<string, unknown> | undefined, hasOptions: (path: string) => boolean): boolean {
  if (!data) return false
  if (String(data.kind || '').toLowerCase() === 'decision') return true
  // same link rule as next-core: no #anchor, no leading ./ or /
  const link = String(data.link || '').trim().replace(/#.*$/, '').replace(/^\.?\/+/, '')
  return /^\s*(pick|choose|decide)\b/i.test(String(data.title || '')) && !!link && hasOptions(link)
}

/** For-you toasts: the items in `next` that were not in `before` (by id), oldest first. `before` = null → nothing
 *  (the first load never toasts). To-dos assigned to me also toast. */
export function newForYou(before: Set<string> | null, next: ForYouItem[]): ForYouItem[] {
  if (!before) return []
  return next.filter((x) => !before.has(x.id)).sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0))
}

/** The toast lines for new items: at most 2, then "+N more for you". */
export function toastLines(items: ForYouItem[], nameOf: (login: string) => string): string[] {
  const line = (it: ForYouItem) => {
    const from = nameOf(it.from) || it.from
    switch (it.kind) {
      case 'added': return `${from} added you to ${it.title}${it.part ? ` (${it.part})` : ''}`
      case 'join': return `${from} asks to join ${it.project || 'a project'}`
      case 'leave': return `${from} asks to leave ${it.project || 'a project'}`
      case 'help': return `${from} is blocked and asked you: ${it.title}`
      case 'assigned': return `New to-do from ${from}: ${it.title}`
      case 'to-me': return `${from} wrote to you: ${it.title}`
      case 'reply': return `${from} replied to your post`
      case 'mention': return `${from} mentioned you`
      case 'digest': return `${it.title} is ready`
    }
    return it.title
  }
  const out = items.slice(0, 2).map(line)
  if (items.length > 2) out.push(`+${items.length - 2} more for you`)
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// check-in: "Reads as" and the chips' overrides
// ---------------------------------------------------------------------------------------------------------------

export type CiOverride = { kind?: string; project?: string; minutes?: number | null; scale?: number | null }

/** The parsed entry with the chips the person tapped applied on top. */
export function applyOverrides(e: NewEntry, cfg: LogConfig, o: CiOverride): NewEntry {
  const fields: Record<string, FieldValue> = { ...(e.fields || {}) }
  const min = (cfg.fields || []).find((f) => f.type === 'number' && (f.key === 'minutes' || /^(m|min|mins|minutes)$/i.test(f.unit || '')))
  if (min && o.minutes !== undefined) {
    if (o.minutes === null) delete fields[min.key]
    else fields[min.key] = o.minutes
  }
  const sc = scaleField(cfg)
  if (sc && o.scale !== undefined) {
    if (o.scale === null) delete fields[sc.key]
    else fields[sc.key] = o.scale
  }
  return { ...e, kind: o.kind || e.kind, project: o.project !== undefined ? o.project : e.project, fields }
}

/** "Reads as" parts: kind, project, time, the other fields, @mentions. */
export function readsAs(e: NewEntry, cfg: LogConfig, projectTitle: (slug: string) => string): { kind: string; project: string; bits: string[] } {
  const bits: string[] = []
  const min = entryMinutes(e.fields, cfg)
  if (min) bits.push(fmtMinutes(min))
  for (const f of cfg.fields || []) {
    const v = e.fields?.[f.key]
    if (v === undefined || v === '' || f.type === 'text') continue
    if (f.type === 'number' && (f.key === 'minutes' || f.key === 'hours' || /^(m|min|mins|minutes|h|hr|hrs|hours)$/i.test(f.unit || ''))) continue
    if (f.type === 'scale') bits.push(`${f.label.toLowerCase()} ${v}/${f.max || 5}`)
    else if (f.type === 'bool') bits.push(`${f.label} ${v ? 'yes' : 'no'}`)
    else if (f.type === 'number') bits.push(`${v}${f.unit ? ' ' + f.unit : ' ' + f.label.toLowerCase()}`)
    else bits.push(`${f.label}: ${v}`)
  }
  for (const r of e.ref || []) if (r.startsWith('@')) bits.push(r)
  return { kind: e.kind || cfg.kinds[0] || 'done', project: e.project ? projectTitle(e.project) : '', bits }
}

/** The text the row will carry (the first text field), '' when empty. */
export function entryText(e: NewEntry, cfg: LogConfig): string {
  const f = (cfg.fields || []).find((x) => x.type === 'text')
  const v = f ? e.fields?.[f.key] : undefined
  return typeof v === 'string' ? v.trim() : ''
}

/** A placeholder from the person's own config and projects ("fixed the login bug 45m +<project>"). Never real data. */
export function ciPlaceholder(cfg: LogConfig, firstProject?: string): string {
  const parts = ['fixed the login bug']
  const min = (cfg.fields || []).some((f) => f.type === 'number' && (f.key === 'minutes' || /^(m|min)/i.test(f.unit || '')))
  if (min) parts.push('45m')
  if (firstProject) parts.push('+' + firstProject.split('-')[0])
  const sc = scaleField(cfg)
  if (sc) parts.push(`${sc.key}=4`)
  return parts.join(' ')
}

/** Own rows can be fixed for this long (people.ts EDIT_DAYS). */
export function canEditRow(e: { at: string }, now: string, days = 7): boolean {
  const a = Date.parse(e?.at || '')
  const b = Date.parse(toIso(now))
  return Number.isFinite(a) && Number.isFinite(b) && b - a <= days * DAY_MS && b - a >= -DAY_MS
}

/** Log rows grouped by local day, newest day first, newest row first. */
export function logDays(entries: Entry[], limitDays = 14): { date: string; rows: Entry[] }[] {
  const map = new Map<string, Entry[]>()
  for (const e of entries || []) {
    if (!e || !e.date) continue
    map.set(e.date, [...(map.get(e.date) || []), e])
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .slice(0, limitDays)
    .map(([date, rows]) => ({ date, rows: [...rows].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0)) }))
}

/** The "HH:MM" of a row's When cell ("15 Oct 14:32" → "14:32"). */
export const rowTime = (when: string) => (String(when || '').match(/(\d{1,2}:\d{2})/) || [])[1] || ''

// ---------------------------------------------------------------------------------------------------------------
// Together: pairs as a node diagram (alphabetical, never ranked)
// ---------------------------------------------------------------------------------------------------------------

export type PairNode = { login: string; x: number; y: number }
export type PairEdge = { a: string; b: string; x1: number; y1: number; x2: number; y2: number; width: number; label: string; projects: string[] }

/** People on a circle (alphabetical, from the top, clockwise), one line per pair. Line width = how often they helped
 *  each other (replies + to-dos for each other + unblocks), 2–7 px. Two people sit side by side. */
export function pairLayout(pairs: Pair[], W = 320, H = 200): { nodes: PairNode[]; edges: PairEdge[] } {
  const people = [...new Set((pairs || []).flatMap((p) => [p.a, p.b]))].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase()))
  const cx = W / 2
  const cy = H / 2
  const nodes: PairNode[] =
    people.length === 2
      ? [{ login: people[0], x: 60, y: cy }, { login: people[1], x: W - 60, y: cy }]
      : people.map((login, i) => {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, people.length)
        return { login, x: Math.round(cx + Math.cos(a) * (W / 2 - 40)), y: Math.round(cy + Math.sin(a) * (H / 2 - 30)) }
      })
  const at = (l: string) => nodes.find((n) => n.login === l)!
  const edges = (pairs || []).map((p) => {
    const w = p.replies + p.todos_ab + p.todos_ba + p.unblocks
    const bits = [p.replies ? plural(p.replies, 'reply', 'replies') : '', p.todos_ab + p.todos_ba ? plural(p.todos_ab + p.todos_ba, 'to-do') : '', p.unblocks ? plural(p.unblocks, 'unblock') : '']
    return {
      a: p.a, b: p.b, x1: at(p.a).x, y1: at(p.a).y, x2: at(p.b).x, y2: at(p.b).y,
      width: Math.max(2, Math.min(7, 2 + w)), label: bits.filter(Boolean).join(' · '), projects: p.projects,
    }
  })
  return { nodes, edges }
}

/** Spoken summary of the pairs picture. */
export function pairsSummary(pairs: Pair[], nameOf: (l: string) => string = (l) => l): string {
  if (!pairs?.length) return 'No pairs yet'
  return pairs.map((p) => {
    const bits = [p.replies ? plural(p.replies, 'reply', 'replies') : '', p.todos_ab + p.todos_ba ? plural(p.todos_ab + p.todos_ba, 'to-do') + ' for each other' : '', p.unblocks ? plural(p.unblocks, 'unblock') : '', p.projects.length ? 'together on ' + p.projects.join(', ') : '']
    return `${nameOf(p.a)} and ${nameOf(p.b)}: ${bits.filter(Boolean).join(', ') || 'no activity yet'}`
  }).join('. ')
}

// ---------------------------------------------------------------------------------------------------------------
// Onboarding: the prompt for the person's own Claude, the intake limits and the AI draft → profile
// ---------------------------------------------------------------------------------------------------------------

/** The intake file may be at most this many bytes (the profile-draft action's limit). */
export const INTAKE_MAX = 20_000
export const byteLength = (s: string) => new TextEncoder().encode(String(s || '')).length

/**
 * The prompt the person pastes into their own Claude Code (onboarding-intake.md, exact text; the login is filled in and
 * the host's first name comes from the workspace at runtime, never from the code). When the host runs it for
 * themselves the first line and the "build with" heading drop the friend wording.
 */
export function intakePrompt(login: string, host: string | null): string {
  const who = String(login || '').trim() || '<my GitHub login>'
  const h = String(host || '').trim()
  const first = h ? `I'm joining Pinwheel, a shared workspace with my friend ${h}. Help me write my profile intake for it.` : `I'm setting up my profile in Pinwheel, my shared workspace. Help me write my profile intake for it.`
  const build = h ? `What I'd like to build with ${h}` : `What I'd like to build in Pinwheel`
  return [
    first,
    '',
    '1. Look through these, READ-ONLY:',
    '   - My Claude folder: ~/.claude. Look at CLAUDE.md, memory files (projects/*/memory/*.md), skills/ and agents/.',
    '     Never open .credentials.json, any file holding tokens or keys, or any .env file.',
    '     Only skim chat transcripts if you really need to, and never quote them.',
    '   - My project folders: <ask me which folders, e.g. ~/code or ~/Documents/projects>.',
    '     Look at README files, package.json / pyproject / requirements files, and folder names.',
    '     Use `git log` for counts and dates only.',
    `2. Write ONE file, hq-intake-${who}.md, in my home folder, using this template:`,
    '',
    '   # Who I am',
    '   (1–2 lines)',
    '   # Role & focus',
    '   # Skills',
    '   - skill — level 1-5 — evidence (which project or file shows it)',
    '   # Tools & stack',
    '   # My projects',
    '   - name — one line — status (active/paused/done) — link if public',
    `   # ${build}`,
    '   # Ask me about',
    '   (3–5 topics I can help others with)',
    '   # Work style',
    '   (timezone, best hours, how I like to communicate)',
    '   # What I want to track in my Pinwheel log',
    '   (pick any: done/doing/blocked · time per project · wins & learnings · energy 1-5 · other)',
    '   # How I like my screen',
    '   (e.g. dark mode, bigger text, calm colors, focus mode)',
    '',
    'Rules:',
    '- Facts only, from what you read. Mark guesses with (guess).',
    '- NO secrets, tokens, passwords, emails, phone numbers, addresses, client names, employer-confidential details, or other people\'s private info. Describe confidential work generically.',
    '- Max ~600 words, short bullets.',
    '- When done, show me the file and ask me to check and edit it before I upload it to Pinwheel.',
  ].join('\n')
}

export type DraftSkill = { name: string; level: number; evidence: string }
export type DraftProject = { name: string; line: string; status: 'active' | 'paused' | 'done'; link: string }
/** The profile draft (E2's `profile-draft` action answers this shape; the browser re-cleans it, never trusts it). */
export type ProfileDraft = {
  identity: { name: string; pronouns: string; about: string }
  role: string
  focus: string
  skills: DraftSkill[]
  stack: string[]
  projects: DraftProject[]
  ask_me_about: string[]
  work_style: { timezone: string; hours: string; communication: string }
  log: { preset: '' | 'minimal' | 'dev' | 'designer' | 'learning'; kinds: string[]; fields: string[] }
  ui: Record<string, string>
}

const DRAFT_KINDS = ['done', 'doing', 'blocked', 'win', 'learned', 'idea']
const DRAFT_FIELDS = ['did', 'minutes', 'energy', 'focus', 'learned', 'source']
const DRAFT_PRESETS = ['minimal', 'dev', 'designer', 'learning']
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
// control, zero-width and bidi characters (built from char codes so this file stays plain ASCII)
const cc = (a: number, b: number) => String.fromCharCode(a) + '-' + String.fromCharCode(b)
const INVISIBLE = new RegExp('[' + cc(0, 31) + cc(0x7f, 0x9f) + cc(0x200b, 0x200f) + cc(0x2028, 0x202e) + cc(0x2060, 0x2069) + '\\ufeff]', 'g')
/** One clean line: no control/bidi characters, no tags, ≤ max characters. */
export function line(v: unknown, max: number): string {
  const s = typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
  const t = s.replace(INVISIBLE, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return Array.from(t).slice(0, max).join('').trim()
}
/** Markdown images/links → their text, bare web addresses removed (profile text fields take no links: the only link a
 *  draft may carry is a project's own https link, kept in its `link` field). Mirrors the server's stripLinks. */
export function noLinks(v: unknown): string {
  const s = typeof v === 'string' ? v : ''
  return s
    .replace(/!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
    .replace(/\b(?:https?:\/\/|www\.)[^\s<>"'`)\]]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
/** One clean line of profile text: line() without links. */
const plain = (v: unknown, max: number) => line(noLinks(typeof v === 'number' ? String(v) : v), max)
const lines = (v: unknown, n: number, max: number) => [...new Set((Array.isArray(v) ? v : []).map((x) => plain(x, max)).filter(Boolean))].slice(0, n)
const httpsOnly = (v: unknown) => {
  const s = line(v, 200)
  try {
    const u = new URL(s)
    return u.protocol === 'https:' && !u.username && !u.password && u.hostname.includes('.') ? u.href : ''
  } catch {
    return ''
  }
}
const UI_KEYS: Record<string, string[]> = {
  theme: ['system', 'light', 'dark'], accent: ['violet', 'blue', 'green', 'amber', 'rose', 'slate'], density: ['compact', 'comfy', 'spacious'],
  size: ['s', 'm', 'l', 'xl', 'xxl'], font: ['inter', 'lexend', 'atkinson', 'system'], lh: ['normal', 'relaxed', 'loose'], ls: ['normal', 'wide'],
  motion: ['system', 'reduced', 'full'], contrast: ['normal', 'high'], calm: ['off', 'on'], focus: ['off', 'on'], keys: ['on', 'off'],
}

/** An empty draft (fill it in by hand). */
export function emptyDraft(name = '', tz = ''): ProfileDraft {
  return {
    identity: { name, pronouns: '', about: '' }, role: '', focus: '', skills: [], stack: [], projects: [], ask_me_about: [],
    work_style: { timezone: tz, hours: '', communication: '' }, log: { preset: '', kinds: [], fields: [] }, ui: {},
  }
}

/** Anything → a ProfileDraft (total; clamps lengths and counts, keeps only allowed values). The server validated it
 *  already; the browser still never trusts model output. */
export function cleanDraft(raw: unknown): ProfileDraft {
  const r = isObj(raw) ? raw : {}
  const id = isObj(r.identity) ? r.identity : {}
  const ws = isObj(r.work_style) ? r.work_style : {}
  const lg = isObj(r.log) ? r.log : {}
  const tz = line(ws.timezone, 40)
  const ui: Record<string, string> = {}
  if (isObj(r.ui)) for (const [k, v] of Object.entries(r.ui)) if (UI_KEYS[k] && typeof v === 'string' && UI_KEYS[k].includes(v)) ui[k] = v
  return {
    identity: { name: plain(id.name, 60), pronouns: plain(id.pronouns, 24), about: plain(id.about, 200) },
    role: plain(r.role, 80),
    focus: plain(r.focus, 140),
    skills: (Array.isArray(r.skills) ? r.skills : []).filter(isObj).map((s) => ({
      name: plain(s.name, 40), level: Math.max(1, Math.min(5, Math.round(Number(s.level)) || 1)), evidence: plain(s.evidence, 140),
    })).filter((s) => s.name).slice(0, 12),
    stack: lines(r.stack, 16, 32),
    projects: (Array.isArray(r.projects) ? r.projects : []).filter(isObj).map((p) => ({
      name: plain(p.name, 60), line: plain(p.line, 140), status: (['active', 'paused', 'done'].includes(String(p.status)) ? p.status : 'active') as DraftProject['status'], link: httpsOnly(p.link),
    })).filter((p) => p.name).slice(0, 8),
    ask_me_about: lines(r.ask_me_about, 8, 60),
    work_style: { timezone: tz && validTz(tz) ? tz : '', hours: plain(ws.hours, 80), communication: plain(ws.communication, 140) },
    log: {
      preset: (DRAFT_PRESETS.includes(String(lg.preset)) ? lg.preset : '') as ProfileDraft['log']['preset'],
      kinds: lines(lg.kinds, 6, 12).filter((k) => DRAFT_KINDS.includes(k)),
      fields: lines(lg.fields, 6, 12).filter((k) => DRAFT_FIELDS.includes(k)),
    },
    ui,
  }
}

const FIELD_DEFS: Record<string, LogField> = {
  did: { key: 'did', label: 'Did', type: 'text', required: true },
  minutes: { key: 'minutes', label: 'Time', type: 'number', unit: 'min', chips: [15, 30, 45, 60, 90] },
  energy: { key: 'energy', label: 'Energy', type: 'scale', max: 5 },
  focus: { key: 'focus', label: 'Focus', type: 'choice', options: ['deep', 'review', 'client'] },
  learned: { key: 'learned', label: 'Learned', type: 'text' },
  source: { key: 'source', label: 'Source', type: 'text' },
}

/** The draft's log suggestion → a valid LogConfig (validateConfig is the last word). No suggestion → the preset (or
 *  minimal). A changed preset is saved as `custom`. */
export function draftLogConfig(log: ProfileDraft['log'], weekStarts: 'sat' | 'sun' | 'mon' = 'sun'): LogConfig {
  const base = log.preset ? PRESETS[log.preset] : DEFAULT_LOG_CONFIG
  const kinds = log.kinds.length ? log.kinds.filter((k) => KINDS[k]) : base.kinds
  let fields = log.fields.length ? log.fields.map((k) => FIELD_DEFS[k]).filter(Boolean) : base.fields
  if (!fields.some((f) => f.type === 'text')) fields = [FIELD_DEFS.did, ...fields]
  if (fields[0]?.type === 'text' && !fields[0].required) fields = [{ ...fields[0], required: true }, ...fields.slice(1)]
  const keys = fields.map((f) => f.key)
  const tiles = [keys.includes('minutes') ? 'minutes' : 'checkins', kinds.includes('win') ? 'wins' : 'todos_done', kinds.includes('learned') ? 'learned' : 'replies']
  const same = JSON.stringify(kinds) === JSON.stringify(base.kinds) && JSON.stringify(fields) === JSON.stringify(base.fields)
  const raw = { preset: same ? base.preset : 'custom', week_starts: weekStarts, nudge_days: base.nudge_days, kinds, fields, goals: same ? base.goals : [], tiles: same ? base.tiles : tiles }
  return validateConfig(raw).config
}

/** Field keys/labels that look personal (the person is warned before saving, blueprint P5). */
export const sensitiveFields = (cfg: LogConfig) => (cfg.fields || []).filter((f) => SENSITIVE_KEYS.test(f.key) || SENSITIVE_KEYS.test(f.label)).map((f) => f.label)

/** The reviewed draft → the profile keys (people/<slug>.md) and the profile body. Only the person's own facts; no
 *  project memberships (owners add people, Y3); the raw intake is not part of it. */
export function draftToProfile(d: ProfileDraft, opts: { learning?: string[]; log?: LogConfig; tz?: string } = {}): { patch: Record<string, unknown>; body: string } {
  const patch: Record<string, unknown> = {}
  const set = (k: string, v: unknown) => {
    if (typeof v === 'string' ? v.trim() : Array.isArray(v) ? v.length : v !== undefined && v !== null) patch[k] = v
  }
  set('name', d.identity.name)
  set('pronouns', d.identity.pronouns)
  set('timezone', d.work_style.timezone && validTz(d.work_style.timezone) ? d.work_style.timezone : opts.tz && validTz(opts.tz) ? opts.tz : '')
  patch.status = 'active'
  set('role', d.role)
  set('focus', d.focus)
  set('skills', d.skills.map((s) => s.name).filter(Boolean).slice(0, 12))
  set('ask_me_about', d.ask_me_about.slice(0, 8))
  set('learning', (opts.learning || []).map((x) => line(x, 60)).filter(Boolean).slice(0, 8))
  if (opts.log) patch.log = opts.log
  const out: string[] = []
  if (d.identity.about) out.push(d.identity.about, '')
  if (d.skills.length) {
    out.push('## Skills', '')
    for (const s of d.skills) out.push(`- ${s.name} · ${s.level}/5${s.evidence ? ` · ${s.evidence}` : ''}`)
    out.push('')
  }
  if (d.stack.length) out.push('## Tools & stack', '', d.stack.map((s) => `- ${s}`).join('\n'), '')
  if (d.projects.length) {
    out.push('## My projects', '')
    for (const p of d.projects) out.push(`- ${p.name}${p.line ? ` · ${p.line}` : ''} · ${p.status}${p.link ? ` · ${p.link}` : ''}`)
    out.push('')
  }
  const ws = [d.work_style.hours ? `Best hours: ${d.work_style.hours}` : '', d.work_style.communication ? `Communication: ${d.work_style.communication}` : ''].filter(Boolean)
  if (ws.length) out.push('## Work style', '', ...ws.map((x) => `- ${x}`), '')
  return { patch, body: out.join('\n').trim() }
}

/** The person's own intake as a file (only when they tick "Keep my intake in HQ"). */
export const intakePath = (slug: string) => `people/${slug}/intake.md`
/** The intake is stored as written, inside a code fence (longer than any backtick run in it), so it reads as plain
 *  text everywhere it is shown: no markdown, links, images or HTML from it ever render. */
export function intakeFile(login: string, intake: string, day: string): string {
  const body = String(intake || '').replace(/\r\n?/g, '\n').trim()
  const longest = Math.max(0, ...(body.match(/`+/g) || []).map((r) => r.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return ['---', `title: ${JSON.stringify(`${login} · intake`)}`, 'type: intake', `person: ${login}`, `updated: ${day}`, '---', '', fence + 'text', body, fence, ''].join('\n')
}

// Same patterns as the server's profile-draft check (supabase/functions/_shared/ui-tweak-handler.mjs).
const SECRET_RE = /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{24,}|xox[abprs]-[A-Za-z0-9-]{10,}|sb_secret_[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})/
const EMAIL_RE = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[A-Za-z]{2,}/

/** What must not be kept in HQ from an intake: the first line (1-based) that looks like a key/token or an email, else
 *  null. (Markup is harmless here: intakeFile stores the text inside a code fence.) */
export function intakeProblem(intake: string): { line: number; why: string } | null {
  const rows = String(intake || '').replace(/\r\n?/g, '\n').split('\n')
  for (let i = 0; i < rows.length; i++) {
    if (SECRET_RE.test(rows[i])) return { line: i + 1, why: 'looks like a key or token' }
    if (EMAIL_RE.test(rows[i])) return { line: i + 1, why: 'looks like an email address' }
  }
  return null
}

/** Short names for the 4 log presets (onboarding + log settings). */
export const PRESET_LABEL: Record<string, string> = { minimal: 'Minimal', dev: 'Dev', designer: 'Designer', learning: 'Learning' }

// ---------------------------------------------------------------------------------------------------------------
// Together (team and pairs only; no per-person totals, P13)
// ---------------------------------------------------------------------------------------------------------------

export type MatrixCell = { role?: 'owner' | 'member'; part?: string; dots: 0 | 1 | 2 | 3 }
export type TogetherData = {
  /** Active people with a profile (Claude is never counted). */
  people: number
  tiles: { value: string; label: string }[]
  columns: string[]
  projects: string[]
  cells: Record<string, Record<string, MatrixCell>>
  pairs: Pair[]
  ideas: string[]
}

/** Hours with one decimal, '' when the median is unknown (n < 3). */
const hrs = (h: number | null | undefined) => (typeof h === 'number' && Number.isFinite(h) ? `${Math.round(h * 10) / 10} h` : '')

/** The three team tiles (asks answered · median first reply · blockers resolved) from collabStats().team. */
export function togetherTiles(team: { asks_sent: number; asks_answered: number; median_reply_h: number | null; blockers_raised: number; blockers_resolved: number; median_unblock_h: number | null }): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = []
  if (team.asks_sent) out.push({ value: `${team.asks_answered} of ${team.asks_sent}`, label: 'Asks answered' })
  // an unknown median (fewer than 3 replies) is no tile: empty tiles are never shown (spec rule 4)
  if (team.asks_answered && hrs(team.median_reply_h)) out.push({ value: hrs(team.median_reply_h), label: 'Median first reply' })
  if (team.blockers_raised) out.push({ value: `${team.blockers_resolved} of ${team.blockers_raised}${hrs(team.median_unblock_h) ? ' · ' + hrs(team.median_unblock_h) : ''}`, label: 'Blockers resolved' })
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// Team cards (real and the dev-only sample share one shape)
// ---------------------------------------------------------------------------------------------------------------

export type CardProject = { slug: string; title: string; role: 'owner' | 'member'; part?: string; color: number }
export type PersonCardView = {
  login: string
  slug: string
  name: string
  /** pronouns · city (parts, joined by CSS gaps). */
  sub: string[]
  me?: boolean
  ghost?: boolean
  sample?: boolean
  /** "checked in today" · "last check-in 4 days ago" (amber after nudge_days) · null = no check-ins yet. */
  fresh: { text: string; amber: boolean } | null
  on: CardProject[]
  /** Open blockers of this person and whom they wait on. Never counts of anything else (cards never compare people). */
  blockers: number
  waitsOn: string[]
  askMeAbout: string[]
}
export type WaitView = { who: string; on: string; what: string; since: string }
export type SampleTeam = { cards: PersonCardView[]; waits: WaitView[]; together: TogetherData }

/** The freshness word for a card ("checked in today" · "last check-in 2 days ago"); amber after nudge_days. */
export function freshWord(last: string | null, tz: string, now: string, nudgeDays: number): { text: string; amber: boolean } | null {
  if (!last) return null
  const z = zone(tz)
  const today = zonedParts(toIso(now), z).date
  const day = zonedParts(toIso(last), z).date
  if (day === today) return { text: 'checked in today', amber: false }
  const age = ageText(last, now)
  const amber = nudgeDays > 0 && Date.parse(toIso(now)) - Date.parse(toIso(last)) > nudgeDays * DAY_MS
  return { text: !age || age === 'just now' ? 'checked in just now' : `last check-in ${age} ago`, amber }
}

const WAIT_ICON: Record<string, IconName> = { '🧱': 'blocked', '☑': 'tasks', '🙋': 'users', '🚪': 'logout', '💬': 'board' }
/** A core Wait's `what` ("🧱 Token won't load") → a drawn icon + plain words (no emoji in the UI). */
export function waitWhat(what: string): { icon: IconName; text: string; blocker: boolean } {
  const s = String(what || '').trim()
  const k = Object.keys(WAIT_ICON).find((e) => s.startsWith(e))
  return { icon: k ? WAIT_ICON[k] : 'clock', text: k ? s.slice(k.length).trim() : s, blocker: k === '🧱' }
}

/** My current profile as a draft (for "Update my profile": the same cards, filled in). */
export function draftFromProfile(p: { name: string; pronouns: string; role: string; timezone: string; askMeAbout: string[]; skills: string[] }, data: Record<string, unknown> = {}): ProfileDraft {
  const d = emptyDraft(p.name, p.timezone)
  d.identity.pronouns = p.pronouns || ''
  d.role = p.role || ''
  d.focus = line(data.focus, 140)
  d.skills = (p.skills || []).slice(0, 12).map((name) => ({ name: line(name, 40), level: 3, evidence: '' })).filter((s) => s.name)
  d.ask_me_about = [...(p.askMeAbout || [])].slice(0, 8)
  return d
}

// ---------------------------------------------------------------------------------------------------------------
// Person page widgets (person_order / person_hidden prefs)
// ---------------------------------------------------------------------------------------------------------------

/** Move one widget id up (-1) or down (+1) among the shown ones; returns the new full order. */
export function moveWidget<T extends string>(order: T[], hidden: T[], id: T, d: -1 | 1): T[] {
  const shown = order.filter((x) => !hidden.includes(x))
  const i = shown.indexOf(id)
  const j = i + d
  if (i < 0 || j < 0 || j >= shown.length) return order
  const a = order.indexOf(shown[i])
  const b = order.indexOf(shown[j])
  const out = [...order]
  ;[out[a], out[b]] = [out[b], out[a]]
  return out
}
