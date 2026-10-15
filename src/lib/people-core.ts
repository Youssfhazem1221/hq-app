// HQ people core: profiles, personal logs, project members, derived events,
// "For you" and collaboration metrics. One file, shared by everything:
//   - app (Vite/TS):      app/src/lib/people-core.ts (byte-identical copy, parity test)
//   - edge AI (Deno):     supabase/functions/_shared/answer.mjs
//   - scripts (Node 24):  scripts/hq.mjs, scripts/digest.mjs, scripts/lib.mjs (type stripping)
//
// Rules: zero imports · erasable TypeScript only (no enum, namespace or parameter
// properties) · every time-dependent function takes `now` · reading never throws on
// bad data (bad rows are skipped; parseLogDetailed() counts them).
// Edit THIS file (supabase/functions/_shared/people-core.ts), then copy it to the app.

export const CORE_VERSION = 2

// ===========================================================================
// Types
// ===========================================================================

export type FieldType = 'text' | 'number' | 'scale' | 'choice' | 'bool'
/** `aliases` = this field's earlier labels: old month tables whose header says an old label still map to `key`
 *  (saveLogConfig adds them on a relabel, so relabelling never splits stats). */
export type LogField = { key: string; label: string; type: FieldType; required?: boolean; unit?: string; max?: number; options?: string[]; chips?: number[]; kinds?: string[]; aliases?: string[] }
export type Goal = { metric: string; per: 'week' | 'month'; target: number; project?: string }
export type WeekStart = 'sat' | 'sun' | 'mon'
export type LogConfig = { preset: string; week_starts: WeekStart; nudge_days: number; kinds: string[]; fields: LogField[]; goals: Goal[]; tiles: string[] }
export type Person = { login: string; slug: string; name: string; pronouns: string; role: string; timezone: string; status: 'active' | 'alumni'; askMeAbout: string[]; learning: string[]; skills: string[]; hoursPerWeek?: number; log: LogConfig; path: string }
export type CoreDoc = { path: string; data: Record<string, unknown>; body?: string }
export type FieldValue = string | number | boolean
export type NewEntry = { at: string /* UTC ISO */; kind: string; project: string; fields: Record<string, FieldValue>; ref: string[] }
/** A parsed row. `fileMonth` = the month file it was read from (YYYY-MM; parseLog always sets it). */
export type Entry = NewEntry & { date: string /* local YYYY-MM-DD */; when: string; line: string; fileMonth?: string }
export type EvKind = 'log' | 'todo.created' | 'todo.started' | 'todo.done' | 'post' | 'reply' | 'post.closed' | 'claude.run' | 'claude.log' | 'ai.question' | 'project.started'
/** A derived event. `at` '' = date unknown (excluded from every time window).
 *  Log rows also carry `when` (the row's When cell) and `ref` (its Ref tokens). */
export type Ev = { id: string; kind: EvKind; at: string; actor: string; for?: string; project?: string; title: string; path: string; logKind?: string; fields?: Record<string, unknown>; ref?: string[]; when?: string }
export type Member = { login: string; role: 'owner' | 'member'; part?: string }
export type Seen = { at: string; ack: string[] /* short hashes */ }
export type ForYouKind = 'help' | 'join' | 'leave' | 'assigned' | 'to-me' | 'added' | 'reply' | 'mention' | 'digest'
export type ForYouItem = { id: string; hash: string; kind: ForYouKind; from: string; title: string; path: string; since: string; project?: string; part?: string; isNew: boolean }
export type Pair = { a: string; b: string; replies: number; todos_ab: number; todos_ba: number; unblocks: number; projects: string[] }
export type Wait = { waiter: string; on: string; what: string; since: string; path: string }
export type CollabStats = {
  from: string
  to: string
  team: {
    asks_sent: number
    asks_answered: number
    median_reply_h: number | null
    blockers_raised: number
    blockers_resolved: number
    median_unblock_h: number | null
    handoffs_done: number
    handoffs_open: number
    shared_projects: string[]
    solo_projects: { slug: string; owner: string }[]
    team_minutes_by_project: Record<string, number>
  }
  pairs: Pair[]
  waits: Wait[]
  claude: { for: string; tasks: number }[]
}
export type Helper = { login: string; name: string; pronouns: string; score: number; reasons: string[]; growth: boolean; openLoad: number; lastCheckin: string | null; memberOf: string[]; evidence: string[] }
export type ProjectRef = { slug: string; title: string; status: string; role: 'owner' | 'member'; part?: string }
export type NextLine = { text: string; action?: 'checkin' | 'open' | 'add' | 'unblock' | 'help'; path?: string }

// ===========================================================================
// Constants
// ===========================================================================

/** The team clock: digests and team windows use Sun–Sat in this zone. */
export const TEAM_TZ = 'Africa/Cairo'

export const LIMITS = { fields: 8, kinds: 6, goals: 5, tiles: 3, cell: 280, members: 12, helpWanted: 5, part: 40 }

export const KINDS: Record<string, { emoji: string; label: string }> = freeze({
  done: { emoji: '✅', label: 'done' },
  doing: { emoji: '🔨', label: 'doing' },
  blocked: { emoji: '🧱', label: 'blocked' },
  unblocked: { emoji: '🔓', label: 'unblocked' },
  win: { emoji: '🏆', label: 'win' },
  learned: { emoji: '📚', label: 'learned' },
  idea: { emoji: '💡', label: 'idea' },
})
export const KIND_ALIASES: Record<string, string> = freeze({ checkin: 'done', blocker: 'blocked', learn: 'learned' })
/** Field keys/labels that look personal (shown with a warning before saving). */
export const SENSITIVE_KEYS = /energy|mood|sleep|health|stress|anxi|weight|medic|therap|feeling|pain|period/i

/** Metrics usable in goals and tiles (plus the key of any number field). */
export const METRICS = ['checkins', 'wins', 'learned', 'todos_done', 'posts', 'replies', 'minutes', 'hours']

export const PROFILE_RE = /^people\/([^/_][^/]*)\.md$/
export const LOG_RE = /^people\/([^/]+)\/log\/(\d{4}-\d{2})\.md$/
export const DIGEST_RE = /^people\/([^/]+)\/digest\/(\d{4}-\d{2})\.md$/

const DID: LogField = { key: 'did', label: 'Did', type: 'text', required: true }
const base = (preset: string, kinds: string[], fields: LogField[], goals: Goal[], tiles: string[]): LogConfig =>
  ({ preset, week_starts: 'sun', nudge_days: 3, kinds, fields, goals, tiles })

/** Generic presets: code constants, no personal data and no energy/mood/health field. */
export const PRESETS: Record<'minimal' | 'dev' | 'designer' | 'learning', LogConfig> = freeze({
  minimal: base('minimal', ['done', 'blocked', 'win'], [DID], [], ['checkins', 'todos_done', 'replies']),
  dev: base('dev', ['done', 'doing', 'blocked', 'idea'],
    [DID, { key: 'minutes', label: 'Time', type: 'number', unit: 'min', chips: [15, 30, 60, 120] }],
    [{ metric: 'checkins', per: 'week', target: 4 }], ['checkins', 'todos_done', 'minutes']),
  designer: base('designer', ['done', 'doing', 'blocked', 'idea'],
    [DID, { key: 'minutes', label: 'Time', type: 'number', unit: 'min', chips: [15, 30, 60, 120] },
      { key: 'focus', label: 'Focus', type: 'choice', options: ['deep', 'review', 'client'] }],
    [{ metric: 'checkins', per: 'week', target: 3 }], ['checkins', 'minutes', 'wins']),
  learning: base('learning', ['done', 'learned', 'blocked'],
    [{ key: 'learned', label: 'Learned', type: 'text', required: true },
      { key: 'minutes', label: 'Time', type: 'number', unit: 'min', chips: [15, 30, 60] },
      { key: 'source', label: 'Source', type: 'text' }],
    [{ metric: 'minutes', per: 'week', target: 300 }], ['checkins', 'minutes', 'learned']),
})
export const DEFAULT_LOG_CONFIG: LogConfig = PRESETS.minimal
export const CLAUDE_LOG_CONFIG: LogConfig = freeze({ preset: 'claude', week_starts: 'sun', nudge_days: 0, kinds: ['done', 'doing', 'blocked', 'learned', 'idea'], fields: [DID], goals: [], tiles: ['checkins'] })
/** Claude has no profile; its page and digest use this person. */
export const CLAUDE_PERSON: Person = freeze({
  login: 'claude', slug: 'claude', name: 'Claude', pronouns: '', role: 'AI assistant', timezone: TEAM_TZ, status: 'active',
  askMeAbout: [], learning: [], skills: [], log: CLAUDE_LOG_CONFIG, path: 'people/claude/log',
})

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const BOTS = ['claude', 'hq-ai', 'hq-digest', 'github-actions']
const PROJECT_FILE = /^projects\/([^/]+)\/project\.md$/i
const LEGACY_PROJECT = /^projects\/([^/]+)\.md$/i
const TODO_RE = /^todos\/[^/]+\.md$/
const POST_RE = /^board\/[^/]+\.md$/
const REPLY_RE = /^board\/replies\/[^/]+\.md$/
const REQUEST_RE = /^ai\/requests\/[^/]+\.md$/
const STATUS_ORDER = ['active', 'waiting', 'parked', 'done']
const DAY_MS = 864e5

// ===========================================================================
// Small helpers (not exported unless useful elsewhere)
// ===========================================================================

function freeze<T>(x: T): T {
  if (x && typeof x === 'object') {
    for (const v of Object.values(x as Record<string, unknown>)) freeze(v)
    Object.freeze(x)
  }
  return x
}
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T
const isoOf = (t: number): string => (Number.isFinite(t) ? new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z') : '')
const str = (v: unknown): string =>
  v === undefined || v === null ? '' : typeof v === 'string' ? v : v instanceof Date ? isoOf(v.getTime()) : typeof v === 'object' ? '' : String(v)
const lower = (v: unknown): string => str(v).trim().toLowerCase()
const same = (a: unknown, b: unknown): boolean => lower(a) !== '' && lower(a) === lower(b)
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const cmpI = (a: string, b: string): number => cmp(a.toLowerCase(), b.toLowerCase()) || cmp(a, b)
const uniq = <T>(xs: T[]): T[] => [...new Set(xs)]
const round1 = (n: number): number => Math.round(n * 10) / 10
const cut = (s: string, n: number): string => {
  const cp = Array.from(s)
  return cp.length > n ? cp.slice(0, n).join('').trim() : s
}
const dataOf = (d: CoreDoc | undefined): Record<string, unknown> =>
  d && d.data && typeof d.data === 'object' && !Array.isArray(d.data) ? d.data : {}
const baseName = (p: string): string => (p.split('/').pop() || '').replace(/\.md$/i, '')
const idOf = (d: CoreDoc): string => str(dataOf(d).id).trim() || baseName(d.path)
const isOpen = (d: CoreDoc): boolean => lower(dataOf(d).status) !== 'done'
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const hoursBetween = (a: string, b: string): number => (Date.parse(b) - Date.parse(a)) / 36e5
const inWin = (at: string, from: string, to: string): boolean => !!at && at >= from && at < to

/** A list value from YAML (array, or a comma-separated string). Objects are skipped. */
function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? '' : str(x).trim())).filter(Boolean)
  if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean)
  return []
}

/** Normalize a time value to `YYYY-MM-DDTHH:MM:SSZ` ('' when unknown). A bare date = 00:00 UTC. */
export function toIso(v: unknown): string {
  if (v instanceof Date) return isoOf(v.getTime())
  const s = str(v).trim()
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s)) return s
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s + 'T00:00:00Z'
  return isoOf(Date.parse(s))
}

/** Bots and Claude never count as people. */
export function isBot(login: unknown): boolean {
  const l = lower(login)
  return !l || BOTS.includes(l) || l.endsWith('[bot]')
}
const isHuman = (l: unknown): boolean => !isBot(l)

/** First readable line of a markdown body (no #, >, list markers or bold). */
function firstLine(s: unknown, n = 80): string {
  for (const raw of str(s).split(/\r?\n/)) {
    const l = raw.replace(/^[\s#>*-]+/, '').replace(/\*\*|__|`/g, '').trim()
    if (l) return cut(l, n)
  }
  return ''
}

/** Same quoting rule as md.mjs yamlValue, plus YAML 1.1/1.2 lookalikes (null, yes, 1.5, 1e3…). A plain value
 *  never starts with `@` or a backtick (reserved YAML indicators: the app's parser would reject the whole block). */
function yamlValue(v: unknown): string {
  if (typeof v === 'boolean') return String(v)
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : JSON.stringify(String(v))
  const s = str(v)
  const plain = /^[\w./+-][\w ./@+:-]*$/.test(s) && !/:\s/.test(s) && !/:$/.test(s) && !/\s$/.test(s) && !/^-(\s|$)/.test(s) &&
    !s.includes(',') && !/^(true|false|null|yes|no|on|off|y|n|~)$/i.test(s) &&
    !/^[-+]?(\.\d+|\d+(\.\d*)?)([eE][-+]?\d+)?$/.test(s) && !/^0[xo]/i.test(s) && !/^[-+]?\.(inf|nan)$/i.test(s)
  return plain ? s : JSON.stringify(s)
}
const inlineList = (xs: unknown[]): string => '[' + xs.map((x) => yamlValue(x)).join(', ') + ']'

const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

/** Top-level scalar keys of a frontmatter block (strings; quotes removed). */
function topScalars(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const m = stripBom(str(text)).match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/)
  if (!m) return out
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_][\w.-]*)[ \t]*:[ \t]*(.*)$/)
    if (!kv) continue
    let v = kv[2].trim()
    if (/^".*"$/.test(v)) {
      try { v = String(JSON.parse(v)) } catch { v = v.slice(1, -1) }
    } else if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'")
    out[kv[1]] = v
  }
  return out
}

// ===========================================================================
// Profiles, config, people
// ===========================================================================

export function isProfilePath(p: string): boolean {
  return PROFILE_RE.test(str(p))
}

/** Same rule as the app's util.slug. */
export function slugOf(login: string): string {
  return str(login).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x'
}

/** Header label → field key ("Build target" → "build_target"). */
export function keyOf(label: string): string {
  return str(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

export function validTz(tz: string): boolean {
  return !!fmtFor(str(tz))
}

function zoneOr(tz: unknown, fallback = TEAM_TZ): string {
  const z = str(tz).trim()
  return z && validTz(z) ? z : fallback
}

const LOGIN_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/

/** One line of plain text: control characters and line breaks become spaces, ≤max characters. */
export function oneLineText(v: unknown, max = 200): string {
  return cut(str(v).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim(), max).trim()
}

const PRONOUNS_RE = /^\p{L}[\p{L}'’ .-]{0,15}(?:\/\p{L}[\p{L}'’ .-]{0,15}){0,3}$/u
/** Pronouns as written ("they/them", "she/they", "any pronouns"), or '' when the value is not pronoun-shaped
 *  (then the UI and the AI use the name only). Keeps profile text from turning into instructions in the prompt. */
export function cleanPronouns(v: unknown): string {
  if (/[^\S ]|[\x00-\x1f\x7f-\x9f]/.test(str(v))) return '' // line breaks, tabs, control characters: not pronouns
  const s = oneLineText(v, 40)
  return s.length <= 32 && PRONOUNS_RE.test(s) ? s : ''
}

/** People = depth-1 profile files (people/<slug>.md, no `_`), sorted by name. Identity comes from the PATH:
 *  people/<slug>.md is the profile of the login whose slug is <slug>; `github` only gives that login's exact
 *  case (a `github` naming anyone else is ignored), so no file can stand in for another person. When two files
 *  share a slug (people/Alice.md, people/alice.md), the canonical lower-case name wins.
 *  Alumni are included with status 'alumni': views and AI blocks show `status === 'active'` only. */
export function rosterOf(docs: CoreDoc[]): Person[] {
  const out: Person[] = []
  const seen = new Set<string>()
  const fileSlugOf = (d: CoreDoc): string => (d.path.match(PROFILE_RE) || [])[1] || ''
  const canonical = (d: CoreDoc): number => (slugOf(fileSlugOf(d)) === fileSlugOf(d) ? 0 : 1)
  const profiles = (docs || []).filter((d) => d && isProfilePath(d.path)).sort((a, b) => canonical(a) - canonical(b) || cmp(a.path, b.path))
  for (const d of profiles) {
    const data = dataOf(d)
    const fileSlug = fileSlugOf(d)
    const slug = slugOf(fileSlug)
    const gh = str(data.github).trim()
    const login = gh && LOGIN_RE.test(gh) && slugOf(gh) === slug ? gh : slug
    if (!fileSlug || !LOGIN_RE.test(login) || isBot(login) || seen.has(slug)) continue
    seen.add(slug)
    const hours = Number(data.hours_per_week)
    const items = (v: unknown, n: number): string[] => strList(v).map((x) => oneLineText(x, 60)).filter(Boolean).slice(0, n)
    const p: Person = {
      login,
      slug,
      name: oneLineText(data.name, 60) || login,
      pronouns: cleanPronouns(data.pronouns),
      role: oneLineText(data.role, 120),
      timezone: zoneOr(data.timezone),
      status: lower(data.status) === 'alumni' ? 'alumni' : 'active',
      askMeAbout: items(data.ask_me_about, 8),
      learning: items(data.learning, 8),
      skills: items(data.skills, 40),
      log: validateConfig(data.log).config,
      path: d.path,
    }
    if (Number.isFinite(hours) && hours > 0) p.hoursPerWeek = hours
    out.push(p)
  }
  return out.sort((a, b) => cmpI(a.name, b.name) || cmpI(a.login, b.login))
}

/** Every human login HQ knows about: profiles ∪ project owners/members ∪ to-do owner/by ∪
 *  post author/to, minus Claude and bots. Exact case from the profile when there is one. */
export function knownLogins(docs: CoreDoc[], roster: Person[]): string[] {
  const map = new Map<string, string>()
  const add = (v: unknown) => {
    const s = str(v).trim()
    if (!s || isBot(s) || !LOGIN_RE.test(s) || map.has(s.toLowerCase())) return
    map.set(s.toLowerCase(), s)
  }
  for (const p of roster || []) add(p.login)
  const sorted = [...(docs || [])].filter(Boolean).sort((a, b) => cmp(a.path, b.path))
  for (const [, d] of projectDocs(sorted)) {
    add(dataOf(d).owner)
    for (const m of strList(dataOf(d).members)) add(m)
  }
  for (const d of sorted) {
    if (TODO_RE.test(d.path)) {
      add(dataOf(d).owner)
      add(dataOf(d).by)
    } else if (POST_RE.test(d.path)) {
      add(dataOf(d).author)
      add(dataOf(d).to)
    }
  }
  return [...map.values()].sort(cmpI)
}

/** Lower-case login → canonical spelling (profiles first, then other known logins). */
function canonFn(docs: CoreDoc[], roster: Person[]): (l: unknown) => string {
  const map = new Map<string, string>()
  for (const l of knownLogins(docs, roster)) map.set(l.toLowerCase(), l)
  return (l: unknown) => {
    const s = str(l).trim()
    return map.get(s.toLowerCase()) || (isBot(s) ? s.toLowerCase() : s)
  }
}

const KIND_RE = /^[a-z][a-z0-9-]{0,15}$/
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,23}$/
const RESERVED_KEYS = ['when', 'kind', 'project', 'ref']
const FIELD_TYPES = ['text', 'number', 'scale', 'choice', 'bool']
const PRESET_NAMES = ['minimal', 'dev', 'designer', 'learning', 'custom']
const labelOf = (key: string): string => cut((key.charAt(0).toUpperCase() + key.slice(1)).replace(/_/g, ' '), 24)
const normKind = (k: unknown): string => {
  const w = lower(k).replace(/^#/, '')
  return KIND_ALIASES[w] || w
}

function fieldOf(r: Record<string, unknown>, errors: string[]): LogField | null {
  const key = lower(r.key)
  if (!FIELD_KEY_RE.test(key)) {
    errors.push(`fields: bad key "${cut(str(r.key), 30)}" (a-z, 0-9 and _, max 24, starts with a letter)`)
    return null
  }
  if (RESERVED_KEYS.includes(key)) {
    errors.push(`fields: "${key}" is a built-in column`)
    return null
  }
  const type = lower(r.type) || 'text'
  if (!FIELD_TYPES.includes(type)) {
    errors.push(`fields: ${key}: unknown type "${cut(str(r.type), 20)}"`)
    return null
  }
  let label = str(r.label).trim()
  if (label && (Array.from(label).length > 24 || /[|\r\n]/.test(label))) {
    errors.push(`fields: ${key}: the label must be ≤24 characters, without | or line breaks`)
    label = ''
  }
  const f: LogField = { key, label: label || labelOf(key), type: type as FieldType }
  if (r.required === true || lower(r.required) === 'true') f.required = true
  if (type === 'number') {
    const unit = str(r.unit).trim()
    if (unit && unit.length <= 12 && !/[|\r\n]/.test(unit)) f.unit = unit
    else if (unit) errors.push(`fields: ${key}: the unit must be ≤12 characters`)
    if (r.chips !== undefined) {
      const chips = (Array.isArray(r.chips) ? r.chips : strList(r.chips)).map(Number).filter((n) => Number.isFinite(n) && n > 0)
      if (chips.length > 5) errors.push(`fields: ${key}: max 5 chips`)
      if (chips.length) f.chips = uniq(chips).slice(0, 5)
    }
  }
  if (type === 'scale') {
    const max = r.max === undefined || r.max === null || r.max === '' ? 5 : Number(r.max)
    if (Number.isInteger(max) && max >= 3 && max <= 10) f.max = max
    else {
      errors.push(`fields: ${key}: max must be a whole number from 3 to 10`)
      f.max = 5
    }
  }
  if (type === 'choice') {
    const opts = uniq(strList(r.options).map((o) => cleanItem(o, 24)).filter(Boolean))
    if (!opts.length) {
      errors.push(`fields: ${key}: a choice needs options`)
      return null
    }
    if (opts.length > 8) errors.push(`fields: ${key}: max 8 options`)
    f.options = opts.slice(0, 8)
  }
  if (r.kinds !== undefined) {
    const ks = uniq(strList(r.kinds).map(normKind).filter((k) => !!KINDS[k] || KIND_RE.test(k)))
    if (ks.length) f.kinds = ks
  }
  if (r.aliases !== undefined) {
    const al: string[] = []
    for (const a of strList(r.aliases)) {
      const t = a.trim()
      if (!t || Array.from(t).length > 24 || /[|\r\n]/.test(t)) {
        errors.push(`fields: ${key}: an old label must be ≤24 characters, without | or line breaks`)
        continue
      }
      if (t.toLowerCase() !== f.label.toLowerCase() && !al.some((x) => x.toLowerCase() === t.toLowerCase())) al.push(t)
    }
    if (al.length) f.aliases = al.slice(0, 8)
  }
  return f
}

/** A field's labels, current first, then the old ones (aliases). */
const labelsOf = (f: LogField): string[] => [f.label, ...(f.aliases || [])]

/** The new config's fields with the old labels of relabelled fields kept as aliases (same key, other label), so
 *  month tables written under an old label still map to the field. Use it when saving a changed config. */
export function keepOldLabels(next: LogConfig, prev: LogConfig | null | undefined): LogConfig {
  const before = prev && Array.isArray(prev.fields) ? prev.fields : []
  const fields = (next.fields || []).map((f) => {
    const old = before.find((o) => o.key === f.key)
    if (!old) return f
    const al: string[] = []
    for (const l of [...labelsOf(old), ...(f.aliases || [])]) { // newest old label first
      if (l.toLowerCase() !== f.label.toLowerCase() && !al.some((x) => x.toLowerCase() === l.toLowerCase())) al.push(l)
    }
    const out: LogField = { ...f }
    if (al.length) out.aliases = al.slice(0, 8)
    else delete out.aliases
    return out
  })
  return { ...next, fields }
}

const metricOk = (m: string, fields: LogField[]): boolean => METRICS.includes(m) || fields.some((f) => f.key === m && f.type === 'number')

/** Validate a profile's `log:` block. Drops invalid parts and explains why; never throws.
 *  A missing block = the minimal preset. A field written as a string (flow style read by a
 *  block-only parser) → error "write fields in block style". */
export function validateConfig(raw: unknown): { config: LogConfig; errors: string[] } {
  const errors: string[] = []
  try {
    if (raw === undefined || raw === null || raw === '') return { config: clone(DEFAULT_LOG_CONFIG), errors }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push('log: not a map (write the log settings in block style)')
      return { config: clone(DEFAULT_LOG_CONFIG), errors }
    }
    const r = raw as Record<string, unknown>
    let preset = 'minimal'
    if (r.preset !== undefined && r.preset !== null && r.preset !== '') {
      const p = lower(r.preset)
      if (PRESET_NAMES.includes(p)) preset = p
      else {
        errors.push(`preset: unknown "${cut(str(r.preset), 20)}" (minimal, dev, designer, learning or custom)`)
        preset = 'custom'
      }
    }
    const from = clone(preset in PRESETS ? PRESETS[preset as keyof typeof PRESETS] : DEFAULT_LOG_CONFIG)

    let week_starts: WeekStart = from.week_starts
    if (r.week_starts !== undefined) {
      const w = lower(r.week_starts)
      if (w === 'sat' || w === 'sun' || w === 'mon') week_starts = w
      else errors.push('week_starts: use sat, sun or mon')
    }

    let nudge_days = from.nudge_days
    if (r.nudge_days !== undefined) {
      const n = Number(r.nudge_days)
      if (Number.isInteger(n) && n >= 0 && n <= 14) nudge_days = n
      else errors.push('nudge_days: a whole number from 0 to 14 (0 = off)')
    }

    let kinds = from.kinds
    if (r.kinds !== undefined) {
      if (!Array.isArray(r.kinds) && typeof r.kinds !== 'string') errors.push('kinds: not a list')
      else {
        const out: string[] = []
        for (const k of Array.isArray(r.kinds) ? r.kinds : strList(r.kinds)) {
          if (k && typeof k === 'object') {
            errors.push('kinds: write kinds in block style (one word per line)')
            continue
          }
          const w = normKind(k)
          if (!w || w === 'unblocked' || out.includes(w)) continue
          if (!KINDS[w] && !KIND_RE.test(w)) {
            errors.push(`kinds: "${cut(str(k), 20)}" is not a valid word`)
            continue
          }
          if (out.length >= LIMITS.kinds) {
            errors.push(`kinds: max ${LIMITS.kinds} (dropped "${w}")`)
            continue
          }
          out.push(w)
        }
        if (out.length) kinds = out
        else errors.push('kinds: none valid, using the preset')
      }
    }

    let fields = from.fields
    if (r.fields !== undefined) {
      if (!Array.isArray(r.fields)) errors.push('fields: not a list (write fields in block style)')
      else {
        const out: LogField[] = []
        for (const item of r.fields) {
          if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
            errors.push(`fields: write fields in block style (got "${cut(String(item), 40)}")`)
            continue
          }
          if (!item || typeof item !== 'object' || Array.isArray(item)) {
            errors.push('fields: each field must be a map (key, label, type)')
            continue
          }
          const f = fieldOf(item as Record<string, unknown>, errors)
          if (!f) continue
          if (out.some((x) => x.key === f.key)) {
            errors.push(`fields: duplicate key "${f.key}"`)
            continue
          }
          if (out.length >= LIMITS.fields) {
            errors.push(`fields: max ${LIMITS.fields} (dropped "${f.key}")`)
            continue
          }
          out.push(f)
        }
        if (out.length) fields = out
        else errors.push('fields: none valid, using the preset')
      }
    }
    if (!fields.some((f) => f.type === 'text')) {
      const key = fields.some((f) => f.key === 'did') ? 'note' : 'did'
      errors.push(`fields: needs one text field ("${key}" added)`)
      fields = [{ ...DID, key, label: labelOf(key) }, ...fields].slice(0, LIMITS.fields)
    }

    let goals = from.goals
    if (r.goals !== undefined) {
      if (!Array.isArray(r.goals)) errors.push('goals: not a list')
      else {
        const out: Goal[] = []
        for (const g of r.goals) {
          if (!g || typeof g !== 'object' || Array.isArray(g)) {
            errors.push('goals: write goals in block style (metric, per, target)')
            continue
          }
          const gr = g as Record<string, unknown>
          const metric = lower(gr.metric)
          const per = lower(gr.per) || 'week'
          const target = Number(gr.target)
          if (!metricOk(metric, fields)) {
            errors.push(`goals: unknown metric "${cut(metric, 24)}"`)
            continue
          }
          if (per !== 'week' && per !== 'month') {
            errors.push(`goals: ${metric}: per must be week or month`)
            continue
          }
          if (!(Number.isFinite(target) && target > 0)) {
            errors.push(`goals: ${metric}: target must be more than 0`)
            continue
          }
          if (out.length >= LIMITS.goals) {
            errors.push(`goals: max ${LIMITS.goals}`)
            continue
          }
          const goal: Goal = { metric, per, target }
          const project = lower(gr.project)
          if (project && /^[a-z0-9][a-z0-9-]*$/.test(project)) goal.project = project
          out.push(goal)
        }
        goals = out
      }
    }

    let tiles = from.tiles
    if (r.tiles !== undefined) {
      if (!Array.isArray(r.tiles) && typeof r.tiles !== 'string') errors.push('tiles: not a list')
      else {
        const out: string[] = []
        for (const t of Array.isArray(r.tiles) ? r.tiles : strList(r.tiles)) {
          const m = lower(t)
          if (!metricOk(m, fields)) {
            errors.push(`tiles: unknown metric "${cut(m, 24)}"`)
            continue
          }
          if (out.includes(m)) continue
          if (out.length >= LIMITS.tiles) {
            errors.push(`tiles: max ${LIMITS.tiles} (dropped "${m}")`)
            continue
          }
          out.push(m)
        }
        tiles = out
      }
    }
    return { config: { preset, week_starts, nudge_days, kinds, fields, goals, tiles }, errors }
  } catch {
    return { config: clone(DEFAULT_LOG_CONFIG), errors: [...errors, 'log: could not read the settings'] }
  }
}

function cfgOk(cfg: LogConfig | undefined | null): LogConfig {
  return cfg && Array.isArray(cfg.fields) && Array.isArray(cfg.kinds) ? cfg : DEFAULT_LOG_CONFIG
}

/** FNV-1a 32-bit over UTF-8 bytes → 8 hex chars. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5
  const step = (b: number) => {
    h ^= b
    h = Math.imul(h, 0x01000193) >>> 0
  }
  for (const ch of str(s)) {
    const c = ch.codePointAt(0) || 0
    if (c < 0x80) step(c)
    else if (c < 0x800) {
      step(0xc0 | (c >> 6))
      step(0x80 | (c & 63))
    } else if (c < 0x10000) {
      step(0xe0 | (c >> 12))
      step(0x80 | ((c >> 6) & 63))
      step(0x80 | (c & 63))
    } else {
      step(0xf0 | (c >> 18))
      step(0x80 | ((c >> 12) & 63))
      step(0x80 | ((c >> 6) & 63))
      step(0x80 | (c & 63))
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// ===========================================================================
// Frontmatter text edits
// ===========================================================================

/** ',' → ' · ', '|' → '·', no line breaks, ≤max characters. Safe as an inline or block list item. */
export function cleanItem(s: string, max = 80): string {
  const t = str(s).replace(/\r\n|\r|\n/g, ' ').replace(/\s*,\s*/g, ' · ').replace(/\|/g, '·').replace(/\s+/g, ' ').trim()
  return cut(t, max).trim()
}

type TopPatch = Record<string, string | number | boolean | string[] | null | undefined>

/** Rewrite only the named top-level frontmatter keys (with their indented continuation lines).
 *  null/undefined removes a key. Scalars use md.mjs quoting; arrays become block lists of
 *  cleanItem'ed strings ([] → `key: []`). New keys go just before the closing `---`.
 *  Every other byte stays as it was (CRLF kept). Same patch twice → same text. */
export function setTopKeys(text: string, patch: TopPatch): string {
  const src = str(text)
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  const keys = Object.keys(patch || {}).filter((k) => /^[A-Za-z0-9_][\w.-]*$/.test(k))
  const render = (k: string, v: unknown): string[] => {
    if (Array.isArray(v)) {
      const items = v.map((x) => cleanItem(str(x), 200)).filter(Boolean)
      return items.length ? [`${k}:`, ...items.map((x) => `  - ${yamlValue(x)}`)] : [`${k}: []`]
    }
    return [`${k}: ${yamlValue(v)}`]
  }
  // lines with their own terminators, so untouched lines keep their exact bytes
  const lines: string[] = [...(src.match(/[^\n]*\n|[^\n]+$/g) || [])]
  const content = (l: string) => l.replace(/\r?\n$/, '')
  const fence = (l: string) => /^---[ \t]*$/.test(stripBom(content(l)))
  let close = -1
  if (lines.length && fence(lines[0])) {
    for (let i = 1; i < lines.length; i++) if (/^---[ \t]*$/.test(content(lines[i]))) { close = i; break }
  }
  if (close < 0) {
    const add = keys.filter((k) => patch[k] !== null && patch[k] !== undefined).flatMap((k) => render(k, patch[k]))
    return add.length ? ['---', ...add, '---'].join(eol) + eol + src : src
  }
  const keyAt = (i: number): string | null => {
    const m = content(lines[i]).match(/^([A-Za-z0-9_][\w.-]*)[ \t]*:(?:[ \t]|$)/)
    return m ? m[1] : null
  }
  const isCont = (i: number, emptyValue: boolean): boolean => {
    const c = content(lines[i])
    return /^[ \t]+\S/.test(c) || (emptyValue && /^-( |$)/.test(c))
  }
  // block end (exclusive) of the key at line i
  const blockEnd = (i: number): number => {
    const emptyValue = /:[ \t]*(#.*)?$/.test(content(lines[i]))
    let e = i + 1
    while (e < close) {
      if (isCont(e, emptyValue)) e++
      else if (content(lines[e]).trim() === '') {
        let k = e
        while (k < close && content(lines[k]).trim() === '') k++
        if (k < close && isCont(k, emptyValue)) e = k + 1
        else break
      } else break
    }
    return e
  }
  const head = lines.slice(0, 1)
  const tail = lines.slice(close)
  // segment the frontmatter into blocks: {key|null, lines}
  type Block = { key: string | null; lines: string[] }
  const blocks: Block[] = []
  for (let i = 1; i < close;) {
    const k = keyAt(i)
    if (k) {
      const e = blockEnd(i)
      blocks.push({ key: k, lines: lines.slice(i, e) })
      i = e
    } else {
      blocks.push({ key: null, lines: [lines[i]] })
      i++
    }
  }
  const done = new Set<string>()
  const out: string[] = []
  for (const b of blocks) {
    if (b.key === null || !keys.includes(b.key)) {
      out.push(...b.lines)
      continue
    }
    if (done.has(b.key)) continue // duplicate key: drop the later copies
    done.add(b.key)
    const v = patch[b.key]
    if (v === null || v === undefined) continue
    const last = b.lines[b.lines.length - 1]
    const lineEol = /\r\n$/.test(last) ? '\r\n' : /\n$/.test(last) ? '\n' : eol
    out.push(...render(b.key, v).map((l) => l + lineEol))
  }
  for (const k of keys) {
    if (done.has(k) || patch[k] === null || patch[k] === undefined) continue
    out.push(...render(k, patch[k]).map((l) => l + eol))
  }
  return [...head, ...out, ...tail].join('')
}

// ===========================================================================
// Projects
// ===========================================================================

/** slug → project doc (folder project.md wins over a legacy flat file), in path order. */
function projectDocs(docs: CoreDoc[]): Map<string, CoreDoc> {
  const out = new Map<string, CoreDoc>()
  for (const d of [...(docs || [])].filter(Boolean).sort((a, b) => cmp(a.path, b.path))) {
    const f = d.path.match(PROJECT_FILE)
    const l = !f && d.path.match(LEGACY_PROJECT)
    const slug = (f && f[1]) || (l && l[1])
    if (!slug) continue
    if (!out.has(slug) || f) out.set(slug, d)
  }
  return out
}
const projectTitle = (slug: string, d: CoreDoc | undefined): string => str(dataOf(d).title).trim() || slug

/** "login=part" lines → { loginLower: part }. Also accepts a YAML map or one comma list. */
export function parseRoles(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, p] of Object.entries(v as Record<string, unknown>)) {
      const login = lower(k)
      const part = str(p).trim()
      if (login && part) out[login] = part
    }
    return out
  }
  for (const item of strList(v)) {
    const i = item.indexOf('=')
    if (i < 1) continue
    const login = item.slice(0, i).trim().toLowerCase()
    const part = item.slice(i + 1).trim()
    if (login && part) out[login] = part
  }
  return out
}

/** The `roles` block list for project.md: owner first, then members; only people with a part. */
export function formatRoles(map: Record<string, string>, members: string[], owner: string): string[] {
  const parts: Record<string, string> = {}
  for (const [k, v] of Object.entries(map || {})) parts[k.toLowerCase()] = v
  const out: string[] = []
  const seen = new Set<string>()
  for (const login of [owner, ...(members || [])].map((x) => str(x).trim()).filter(Boolean)) {
    const k = login.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    const part = cleanItem(parts[k] || '', LIMITS.part)
    if (part) out.push(`${login}=${part}`)
  }
  return out
}

/** owner ∪ members of a project (owner first), with parts from `roles`. */
export function membersOf(slug: string, docs: CoreDoc[]): Member[] {
  const d = projectDocs(docs).get(str(slug))
  if (!d) return []
  const data = dataOf(d)
  const roles = parseRoles(data.roles)
  const owner = str(data.owner).trim()
  const out: Member[] = []
  const seen = new Set<string>()
  const add = (login: string, role: 'owner' | 'member') => {
    const k = login.toLowerCase()
    if (!login || seen.has(k)) return
    seen.add(k)
    const m: Member = { login, role }
    if (roles[k]) m.part = roles[k]
    out.push(m)
  }
  if (owner) add(owner, 'owner')
  for (const m of strList(data.members).slice(0, LIMITS.members)) add(m, 'member')
  return out
}

const statusRank = (s: string): number => {
  const i = STATUS_ORDER.indexOf(s)
  return i < 0 ? STATUS_ORDER.length : i
}

/** Projects where `login` is the owner or a member (by status, then slug). */
export function projectsOf(login: string, docs: CoreDoc[]): ProjectRef[] {
  const out: ProjectRef[] = []
  for (const [slug, d] of projectDocs(docs)) {
    const m = membersOf(slug, docs).find((x) => same(x.login, login))
    if (!m) continue
    const p: ProjectRef = { slug, title: projectTitle(slug, d), status: lower(dataOf(d).status) || 'active', role: m.role }
    if (m.part) p.part = m.part
    out.push(p)
  }
  return out.sort((a, b) => statusRank(a.status) - statusRank(b.status) || cmp(a.slug, b.slug))
}

/** Project colour slots: `color: 1..8` in project.md → var(--viz-N) in the app. */
export const COLOR_SLOTS = 8

/** A project's colour slot from its `color:` value: an integer 1–8 (number or digits); anything else = slot 1. */
export function projectColor(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d{1,2}\s*$/.test(v) ? Number(v) : NaN
  return Number.isInteger(n) && n >= 1 && n <= COLOR_SLOTS ? n : 1
}

/** The colour of a new project: the lowest slot no existing project shows yet (a missing or bad `color:` shows
 *  as slot 1); when all 8 are in use, the least-used slot (lowest on a tie). `used` = the existing `color:` values. */
export function nextProjectColor(used: unknown[]): number {
  const count: number[] = new Array(COLOR_SLOTS + 1).fill(0)
  for (const v of Array.isArray(used) ? used : []) count[projectColor(v)]++
  let best = 1
  for (let n = 2; n <= COLOR_SLOTS; n++) if (count[n] < count[best]) best = n
  return best
}

// ===========================================================================
// Time (Intl only)
// ===========================================================================

const fmtCache: Record<string, Intl.DateTimeFormat> = {}
function fmtFor(tz: string): Intl.DateTimeFormat | null {
  if (!tz) return null
  if (fmtCache[tz]) return fmtCache[tz]
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })
    fmtCache[tz] = f
    return f
  } catch {
    return null
  }
}
type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number }
function wall(t: number, tz: string): Wall {
  const f = fmtFor(tz) || (fmtFor('UTC') as Intl.DateTimeFormat)
  const p: Record<string, number> = {}
  for (const x of f.formatToParts(new Date(t))) if (x.type !== 'literal') p[x.type] = Number(x.value)
  return { y: p.year, mo: p.month, d: p.day, h: p.hour === 24 ? 0 : p.hour, mi: p.minute, s: p.second }
}
const pad2 = (n: number): string => String(n).padStart(2, '0')
const dateOfWall = (w: Wall): string => `${w.y}-${pad2(w.mo)}-${pad2(w.d)}`
const dowOf = (date: string): number => new Date(date + 'T00:00:00Z').getUTCDay()
const addDays = (date: string, n: number): string => isoOf(Date.parse(date + 'T00:00:00Z') + n * DAY_MS).slice(0, 10)
const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'))

/** Local wall-clock parts of a UTC instant. Empty strings (dow -1) for a bad time. */
export function zonedParts(iso: string, tz: string): { date: string; hm: string; dow: number; month: string } {
  const t = Date.parse(toIso(iso))
  if (!Number.isFinite(t)) return { date: '', hm: '', dow: -1, month: '' }
  const w = wall(t, zoneOr(tz, 'UTC'))
  const date = dateOfWall(w)
  return { date, hm: `${pad2(w.h)}:${pad2(w.mi)}`, dow: dowOf(date), month: date.slice(0, 7) }
}

/** UTC instant (ISO, no ms) of a local wall time. Ambiguous times (clocks going back) take the
 *  first occurrence; times inside a spring-forward gap move forward (00:30 → 01:30). '' if bad. */
export function zonedToUtc(date: string, hm: string, tz: string): string {
  const dm = str(date).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const hmm = str(hm).match(/^(\d{1,2}):(\d{2})$/)
  if (!dm || !hmm || Number(hmm[1]) > 23 || Number(hmm[2]) > 59 || !isDate(dm[0]) || addDays(dm[0], 0) !== dm[0]) return ''
  const want = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(hmm[1]), Number(hmm[2]))
  if (!Number.isFinite(want)) return ''
  const zone = zoneOr(tz, 'UTC')
  const offset = (t: number) => {
    const w = wall(t, zone)
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000
  }
  const before = want - offset(want - DAY_MS)
  const after = want - offset(want + DAY_MS)
  const hits = [before, after].filter((t) => {
    const w = wall(t, zone)
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) === want
  })
  return isoOf(hits.length ? Math.min(...hits) : before)
}

/** First day of the week containing `date` (sat · sun · mon). */
export function weekStart(date: string, starts: 'sat' | 'sun' | 'mon'): string {
  if (!isDate(str(date))) return ''
  const target = starts === 'sat' ? 6 : starts === 'mon' ? 1 : 0
  return addDays(date, -((dowOf(date) - target + 7) % 7))
}

/** The digest week (Sun–Sat) of a local date. It belongs to the month of its Sunday. */
export function weekOf(date: string): { start: string; end: string; month: string } {
  const start = weekStart(date, 'sun')
  if (!start) return { start: '', end: '', month: '' }
  return { start, end: addDays(start, 6), month: start.slice(0, 7) }
}

/** UTC bounds [from, to) of the Sun–Sat week that starts on `sunday`, in `tz` (default Cairo). */
export function weekWindow(sunday: string, tz: string = TEAM_TZ): { from: string; to: string } {
  return { from: zonedToUtc(sunday, '00:00', tz), to: zonedToUtc(addDays(sunday, 7), '00:00', tz) }
}

/** "13 Oct" for a local date. */
const dayMon = (date: string): string => (isDate(date) ? `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}` : date)
const dayLabel = (date: string): string => `${DAYS[dowOf(date)]} ${dayMon(date)}`

/** "5 min" · "3 h" · "1 day" · "4 days" between two instants. */
export function ageText(since: string, now: string): string {
  const a = Date.parse(toIso(since))
  const b = Date.parse(toIso(now))
  if (!Number.isFinite(a) || !Number.isFinite(b)) return ''
  const min = Math.max(0, Math.floor((b - a) / 6e4))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min`
  if (min < 1440) return `${Math.floor(min / 60)} h`
  const d = Math.floor(min / 1440)
  return d === 1 ? '1 day' : `${d} days`
}
const shortAge = (since: string, now: string): string => {
  const h = (Date.parse(toIso(now)) - Date.parse(toIso(since))) / 36e5
  if (!Number.isFinite(h)) return ''
  return h < 24 ? `${Math.max(0, Math.round(h))} h` : `${Math.floor(h / 24)} d`
}

// ===========================================================================
// Log files
// ===========================================================================

export function logPathFor(login: string, month: string): string {
  return `people/${slugOf(login)}/log/${month}.md`
}

/** A new month file. Fully deterministic from (login, month, tz), so two devices that create
 *  the same month write identical bytes and a union merge never duplicates keys. */
export function newLogFile(login: string, month: string, tz: string): string {
  const name = str(login).trim() || 'unknown'
  const zone = zoneOr(tz)
  const m = str(month).match(/^(\d{4})-(\d{2})$/)
  const label = m && MONTH_NAMES[Number(m[2]) - 1] ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : str(month)
  const who = slugOf(name) === 'claude' ? 'Claude adds one row per task.' : 'The HQ app adds one row per entry.'
  return [
    '---',
    `title: ${JSON.stringify(`${name} · log · ${month}`)}`,
    'type: log',
    `person: ${yamlValue(name)}`,
    `month: ${yamlValue(month)}`,
    `tz: ${yamlValue(zone)}`,
    '---',
    '',
    `# ${name} · log · ${label}`,
    '',
    `> 👀 Visible to the whole team and HQ's AI. ${who}`,
    '',
  ].join('\n')
}

const MIN_UNIT = /^(m|min|mins|minute|minutes)$/i
const HOUR_UNIT = /^(h|hr|hrs|hour|hours)$/i

/** The config's time fields: `min` = the `minutes` field, else the first number field whose unit is minutes;
 *  `hour` = the `hours` field, else the first number field whose unit is hours. ONE rule for every consumer (the
 *  check-in line, the weekly chart, summaries, goals, digests, team time), so a field keyed "time" with unit
 *  "min" counts everywhere. */
export function timeFieldsOf(cfg: LogConfig | null | undefined): { min?: LogField; hour?: LogField } {
  const nums = cfgOk(cfg as LogConfig).fields.filter((f) => f.type === 'number')
  const out: { min?: LogField; hour?: LogField } = {}
  const min = nums.find((f) => f.key === 'minutes') || nums.find((f) => f.key !== 'hours' && MIN_UNIT.test(f.unit || ''))
  const hour = nums.find((f) => f.key === 'hours') || nums.find((f) => f.key !== 'minutes' && HOUR_UNIT.test(f.unit || ''))
  if (min) out.min = min
  if (hour) out.hour = hour
  return out
}

/** Minutes in one row's fields, read through the config's time field (0 when none). */
export function entryMinutes(fields: Record<string, unknown> | undefined, cfg: LogConfig | null | undefined): number {
  if (!fields) return 0
  const t = timeFieldsOf(cfg)
  const m = t.min ? fields[t.min.key] : undefined
  if (typeof m === 'number' && Number.isFinite(m) && m) return m
  const h = t.hour ? fields[t.hour.key] : undefined
  if (typeof h === 'number' && Number.isFinite(h) && h) return Math.round(h * 60)
  return minutesOf(fields)
}

/** The custom columns for a row of this kind (fields with `kinds` show only for those kinds). */
export function columnsFor(cfg: LogConfig, kind: string): LogField[] {
  return cfgOk(cfg).fields.filter((f) => !f.kinds || !f.kinds.length || f.kinds.includes(kind))
}

/** `|` → `·`, line breaks → ` / `, ≤280 characters, empty → `—`. Booleans → ✓ / —. */
export function sanitizeCell(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? '✓' : '—'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '—'
  const s = str(v).replace(/\r\n|\r|\n/g, ' / ').replace(/\|/g, '·').replace(/[ \t]+/g, ' ').trim()
  return cut(s, LIMITS.cell).trim() || '—'
}

export function kindCell(kind: string): string {
  const k = normKind(kind)
  return KINDS[k] ? `${KINDS[k].emoji} ${KINDS[k].label}` : `📌 ${k || 'note'}`
}

function fieldCell(f: LogField, v: unknown): string {
  if (v === undefined || v === null || v === '') return '—'
  if (f.type === 'scale') {
    const n = Number(v)
    return Number.isFinite(n) ? `${n}/${f.max || 5}` : '—'
  }
  if (f.type === 'bool') return v === true || v === 1 || ['true', 'yes', '1', '✓'].includes(lower(v)) ? '✓' : '—'
  if (f.type === 'number') {
    const n = Number(v)
    return Number.isFinite(n) ? String(n) : '—'
  }
  return sanitizeCell(v)
}

const headerLine = (cols: LogField[]): string => `| When | Kind | Project | ${cols.map((c) => c.label + ' | ').join('')}Ref |`
const sepLine = (n: number): string => '|' + '---|'.repeat(n)
const isTableLine = (l: string): boolean => /^\s*\|.*\|\s*$/.test(l)
const isSepLine = (l: string): boolean => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(l)
const dayHeading = (date: string): string => `## ${dayLabel(date)}`

/** UTC offset of `tz` at the instant `t` (ms), as "+02:00". */
function offsetText(t: number, tz: string): string {
  const w = wall(t, tz)
  const min = Math.round((Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(t / 1000) * 1000) / 6e4)
  const a = Math.abs(min)
  return `${min < 0 ? '-' : '+'}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}`
}

/** The `When` cell of a row logged at `at`, in a month file's time zone: "15 Oct 14:32". In the hour that happens
 *  twice when clocks go back (Egypt: Thu 29 Oct 2026, 23:00–23:59), the second pass carries its UTC offset
 *  ("29 Oct 23:10 +02:00"): it reads back as the right instant and never looks like a row from the first pass.
 *  '' for a bad time. */
export function whenFor(at: string, tz: string): string {
  const zone = zoneOr(tz, 'UTC')
  const p = zonedParts(at, zone)
  if (!p.date) return ''
  const base = `${dayMon(p.date)} ${p.hm}`
  const minute = Math.floor(Date.parse(toIso(at)) / 6e4) * 6e4
  return Date.parse(zonedToUtc(p.date, p.hm, zone)) === minute ? base : `${base} ${offsetText(minute, zone)}`
}

// ---- tombstones: a removed or replaced row leaves a hidden comment naming the row's hash ----
// Logs merge with `merge=union`: if a row is removed (✏️ fix or remove) while another clone appends next to it,
// the union brings the old line back. The tombstone travels with the removal, so every reader still skips the
// old line (parseLog, liveLogText), and the next append cleans it out of the text. Comments are invisible on
// GitHub and sit just before the first day heading, so tables stay whole.
const TOMB_RE = /^<!-- removed: ([0-9a-f]{8}) -->$/
const rowHash = (line: string): string => shortHash(line.trim())
const tombLine = (hash: string): string => `<!-- removed: ${hash} -->`
const isTomb = (l: string): boolean => TOMB_RE.test(l.trim())
function tombsOf(lines: string[]): Set<string> {
  const out = new Set<string>()
  for (const l of lines) {
    const m = l.trim().match(TOMB_RE)
    if (m) out.add(m[1])
  }
  return out
}
/** A table row that a tombstone names (headers and separators never are). */
const deadRow = (l: string, dead: Set<string>): boolean => dead.size > 0 && isTableLine(l) && !isSepLine(l) && dead.has(rowHash(l))

/** Add a tombstone for a row line (once): just before the first day heading, else at the end. */
function addTomb(lines: string[], line: string): string[] {
  const t = tombLine(rowHash(line))
  if (lines.some((l) => l.trim() === t)) return lines
  const h = lines.findIndex((l) => /^## /.test(l))
  if (h >= 0) return [...lines.slice(0, h), t, '', ...lines.slice(h)]
  const out = [...lines]
  while (out.length && out[out.length - 1].trim() === '') out.pop()
  return [...out, '', t, '']
}

/** Lift a tombstone (the same row is logged again), with the blank line it brought. */
function dropTomb(lines: string[], hash: string): string[] {
  const i = lines.findIndex((l) => l.trim() === tombLine(hash))
  if (i < 0) return lines
  const blankAfter = i + 1 < lines.length && lines[i + 1].trim() === ''
  return [...lines.slice(0, i), ...lines.slice(i + (blankAfter ? 2 : 1))]
}

/** A log month's text without the rows its tombstones removed (the comments stay). For the index and raw views;
 *  parseLog already skips those rows. */
export function liveLogText(text: string): string {
  const src = str(text)
  const lines = src.split(/\r?\n/)
  const dead = tombsOf(lines)
  if (!dead.size) return src
  return lines.filter((l) => !deadRow(l, dead)).join(src.includes('\r\n') ? '\r\n' : '\n')
}

function rowLine(e: NewEntry, cols: LogField[], when: string): string {
  const refs = (e.ref || []).map((r) => sanitizeCell(r).replace(/ · /g, ' ')).filter((r) => r !== '—')
  const cells = [when, kindCell(e.kind), sanitizeCell(e.project), ...cols.map((c) => fieldCell(c, (e.fields || {})[c.key])), refs.length ? refs.join(' · ') : '—']
  return `| ${cells.join(' | ')} |`
}

/** Append one entry (pure). null text → a new month file. Idempotent: if the exact row is
 *  already there, the text comes back unchanged. A new day or a column change starts a new
 *  table. The file's own `tz` (frontmatter) wins over `tz`. Rows a tombstone removed (a union
 *  merge can bring them back) are dropped on the way. Throws only on a bad `e.at`. */
export function appendEntry(text: string | null, e: NewEntry, cfg: LogConfig, login: string, tz: string): string {
  const c = cfgOk(cfg)
  const zone = zoneOr(text != null ? topScalars(text).tz || tz : tz)
  const p = zonedParts(e.at, zone)
  if (!p.date) throw new Error(`appendEntry: bad time "${str(e.at)}"`)
  let file = text != null ? str(text) : newLogFile(login, p.month, zone)
  const eol = file.includes('\r\n') ? '\r\n' : '\n'
  const kind = normKind(e.kind) || c.kinds[0] || 'done'
  const cols = columnsFor(c, kind)
  const header = headerLine(cols)
  const row = rowLine({ ...e, kind }, cols, whenFor(e.at, zone))
  let lines = file.split(/\r?\n/)
  const dead = tombsOf(lines)
  const again = dead.has(rowHash(row)) // this exact row was removed before and is logged again
  if (!again && lines.some((l) => l.trimEnd() === row)) return file
  if (dead.size) {
    const kept = lines.filter((l) => !deadRow(l, dead))
    const healed = again ? dropTomb(kept, rowHash(row)) : kept
    if (healed.length !== lines.length) {
      lines = healed
      file = healed.join(eol)
    }
  }
  let lastHeading = ''
  let lastHeader = ''
  let lastNonEmpty = ''
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^## /.test(l)) {
      lastHeading = l.trim()
      lastHeader = ''
    } else if (isTableLine(l) && !isSepLine(l) && i + 1 < lines.length && isSepLine(lines[i + 1])) lastHeader = l.trim()
    if (l.trim()) lastNonEmpty = l
  }
  const heading = dayHeading(p.date)
  const body = file.replace(/\s+$/, '')
  let add: string[]
  if (lastHeading === heading && lastHeader === header && isTableLine(lastNonEmpty)) add = [row]
  else if (lastHeading === heading) add = ['', header, sepLine(cols.length + 4), row]
  else add = ['', heading, '', header, sepLine(cols.length + 4), row]
  return body + eol + add.join(eol) + eol
}

/** Replace (or with null, remove) the first live row whose When cell equals `when`. A table or day
 *  left empty is removed too. If the new row needs other columns, it is re-appended instead. The old
 *  line leaves a tombstone, so a union merge can't bring it back. */
export function replaceRow(text: string, when: string, next: NewEntry | null, cfg: LogConfig): string {
  const src = str(text)
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  let lines = src.split(/\r?\n/)
  const dead = tombsOf(lines)
  let row = -1
  let sep = -1
  for (let i = 0; i < lines.length; i++) {
    if (isSepLine(lines[i])) {
      sep = i
      continue
    }
    if (sep >= 0 && i > sep && isTableLine(lines[i]) && !deadRow(lines[i], dead) && cellsOf(lines[i])[0] === when) {
      row = i
      break
    }
    if (!isTableLine(lines[i])) sep = -1
  }
  if (row < 0) return src
  const old = lines[row]
  const fm = topScalars(src)
  const zone = zoneOr(fm.tz)
  if (next) {
    const c = cfgOk(cfg)
    const p = zonedParts(next.at, zone)
    if (!p.date) throw new Error(`replaceRow: bad time "${str(next.at)}"`)
    const kind = normKind(next.kind) || c.kinds[0] || 'done'
    const cols = columnsFor(c, kind)
    if (lines[sep - 1] !== undefined && lines[sep - 1].trim() === headerLine(cols)) {
      const line = rowLine({ ...next, kind }, cols, whenFor(next.at, zone))
      if (line === old.trimEnd()) return src
      lines[row] = line
      return addTomb(lines, old).join(eol)
    }
  }
  // remove the row; drop an emptied table (header + separator) and an emptied day heading
  lines.splice(row, 1)
  const rowsLeft = row < lines.length && isTableLine(lines[row]) && !isSepLine(lines[row])
  if (!rowsLeft && row - 1 === sep && sep >= 1) {
    let start = sep - 1 // the header line
    if (start > 0 && lines[start - 1].trim() === '') start--
    lines.splice(start, sep + 1 - start)
    let h = start - 1
    while (h >= 0 && lines[h].trim() === '') h--
    if (h >= 0 && /^## /.test(lines[h])) {
      let n = h + 1
      while (n < lines.length && lines[n].trim() === '') n++
      if (n >= lines.length || /^## /.test(lines[n])) {
        const s = h > 0 && lines[h - 1].trim() === '' ? h - 1 : h
        lines.splice(s, h + 1 - s) // (blank +) heading; the blank after it stays as the separator
      }
    }
  }
  lines = addTomb(lines, old)
  let out = lines.join(eol).replace(/\s+$/, '') + eol
  if (next) out = appendEntry(out, next, cfg, fm.person || 'unknown', zone)
  return out
}

function cellsOf(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return t.split('|').map((c) => c.trim())
}

/** Every preset's label → key, so old files still map "Time" → minutes without a config. */
const PRESET_LABELS: Record<string, string> = (() => {
  const m: Record<string, string> = {}
  for (const p of Object.values(PRESETS)) for (const f of p.fields) m[f.label.toLowerCase()] = f.key
  return m
})()

function kindFromCell(cell: string): string {
  const c = cell.trim()
  for (const [k, v] of Object.entries(KINDS)) if (c === `${v.emoji} ${v.label}`) return k
  const pin = c.match(/^📌\s*(.+)$/u)
  if (pin) return normKind(pin[1])
  return normKind(c.replace(/^[^A-Za-z0-9]+/, '')) || 'done'
}

function cellValue(cell: string, f: LogField | undefined): FieldValue | undefined {
  if (cell === '—' || cell === '') return undefined
  const type = f ? f.type : ''
  if (type === 'bool' || (!type && cell === '✓')) return cell === '✓'
  if (type === 'scale' || (!type && /^-?\d+(\.\d+)?\/\d+$/.test(cell))) {
    const n = parseFloat(cell)
    return Number.isFinite(n) ? n : cell
  }
  if (type === 'number' || (!type && /^-?\d+(\.\d+)?$/.test(cell))) {
    const n = Number(cell)
    return Number.isFinite(n) ? n : cell
  }
  return cell
}

const WHEN_RE = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{2}):(\d{2})(?: ([+-])(\d{2}):(\d{2}))?$/

/** Parse a month file. Rows are self-dated (When + the file's month and tz), so headings and
 *  row order don't matter; exact duplicate rows (union merge) count once, and rows a tombstone
 *  removed are skipped. Blank lines and tombstones don't end a table. Bad rows are skipped and
 *  counted. Header labels map to keys through `cfg` (labels, then old labels), then the presets,
 *  then keyOf. Each entry carries `fileMonth`, the month file it was read from. */
export function parseLogDetailed(text: string, cfg?: LogConfig): { entries: Entry[]; skipped: number } {
  const src = str(text)
  const fm = topScalars(src)
  const zone = zoneOr(fm.tz)
  const fileMonth = /^\d{4}-\d{2}$/.test(fm.month || '') ? fm.month : ''
  const fields = cfg && Array.isArray(cfg.fields) ? cfg.fields : []
  const byLabel: Record<string, LogField> = {}
  for (const f of fields) for (const l of (f.aliases || []).slice().reverse()) byLabel[l.toLowerCase()] = f
  for (const f of fields) byLabel[f.label.toLowerCase()] = f // current labels win over old ones
  const entries: Entry[] = []
  const seen = new Set<string>()
  let skipped = 0
  let cols: string[] | null = null
  const lines = src.split(/\r?\n/)
  const dead = tombsOf(lines)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!isTableLine(l)) {
      // a row that a union merge put after a blank line or a tombstone still reads with the header above it
      if (!l.trim() || isTomb(l)) continue
      cols = null
      continue
    }
    if (isSepLine(l)) continue
    if (i + 1 < lines.length && isSepLine(lines[i + 1])) {
      cols = cellsOf(l).map((label) => {
        const k = label.toLowerCase()
        if (k === 'when' || k === 'kind' || k === 'project' || k === 'ref') return k
        return byLabel[k] ? byLabel[k].key : fields.some((f) => f.key === keyOf(label)) ? keyOf(label) : PRESET_LABELS[k] || keyOf(label)
      })
      continue
    }
    if (!cols) continue
    const line = l.trimEnd()
    if (seen.has(line)) continue
    if (deadRow(l, dead)) continue // removed or replaced (its tombstone is in the file)
    const cells = cellsOf(l)
    const w = cells[cols.indexOf('when')] || ''
    const wm = w.match(WHEN_RE)
    const mi = wm ? MONTHS.indexOf(wm[2]) : -1
    if (cells.length !== cols.length || !wm || mi < 0 || !fileMonth) {
      skipped++
      continue
    }
    let year = Number(fileMonth.slice(0, 4))
    const fileMo = Number(fileMonth.slice(5, 7)) - 1
    if (mi - fileMo > 6) year--
    else if (fileMo - mi > 6) year++
    const date = `${year}-${pad2(mi + 1)}-${pad2(Number(wm[1]))}`
    const hm = `${wm[3]}:${wm[4]}`
    let at = ''
    if (isDate(date) && Number(wm[3]) <= 23 && Number(wm[4]) <= 59) {
      if (wm[5]) {
        // an explicit offset (the repeated hour when clocks go back): exact
        const off = (wm[5] === '-' ? -1 : 1) * (Number(wm[6]) * 60 + Number(wm[7]))
        const t = Date.UTC(year, mi, Number(wm[1]), Number(wm[3]), Number(wm[4])) - off * 6e4
        const z = zonedParts(isoOf(t), zone) // the offset must be the file zone's own offset at that time
        at = Math.abs(off) <= 14 * 60 && z.date === date && z.hm === hm ? isoOf(t) : ''
      } else at = zonedToUtc(date, hm, zone)
    }
    if (!at) {
      skipped++
      continue
    }
    seen.add(line)
    const e: Entry = { at, kind: 'done', project: '', fields: {}, ref: [], date, when: w, line, fileMonth }
    cols.forEach((k, j) => {
      const cell = cells[j]
      if (k === 'when') return
      if (k === 'kind') e.kind = kindFromCell(cell)
      else if (k === 'project') e.project = cell === '—' ? '' : cell
      else if (k === 'ref') e.ref = cell === '—' || !cell ? [] : cell.split(' · ').map((x) => x.trim()).filter(Boolean)
      else {
        const v = cellValue(cell, fields.find((f) => f.key === k))
        if (v !== undefined) e.fields[k] = v
      }
    })
    entries.push(e)
  }
  return { entries, skipped }
}

export function parseLog(text: string, cfg?: LogConfig): Entry[] {
  return parseLogDetailed(text, cfg).entries
}

/** The month file a parsed row came from: people/<slug>/log/<fileMonth>.md. A row's own date can fall in the next
 *  month (logged near midnight after a time-zone change); blocker keys, mentions and events use the real file. */
export function entryLogPath(slug: string, e: { date: string; fileMonth?: string }): string {
  return `people/${slugOf(slug)}/log/${e.fileMonth || str(e.date).slice(0, 7)}.md`
}

/** Local date of the newest row, or null (the indexer's `updated` for a log file). */
export function lastLogDate(text: string): string | null {
  let best: string | null = null
  for (const e of parseLog(text)) if (!best || e.date > best) best = e.date
  return best
}

/** The project slug a `+word` token means: my projects first (exact, prefix, word prefix), then all. */
function matchProject(word: string, mine: string[], all: string[]): string {
  const w = word.toLowerCase()
  for (const list of [mine, all]) {
    const xs = [...(list || [])].map(str).filter(Boolean).sort()
    const hit = xs.find((p) => p.toLowerCase() === w) || xs.find((p) => p.toLowerCase().startsWith(w)) ||
      xs.find((p) => p.toLowerCase().split('-').some((s) => s.startsWith(w)))
    if (hit) return hit
  }
  return w
}

function resolveLogin(word: string, roster: Person[]): string | null {
  const w = word.toLowerCase()
  const people = (roster || []).filter((p) => p.status !== 'alumni')
  const byLogin = [...people].sort((a, b) => cmpI(a.login, b.login))
  const hit = byLogin.find((p) => p.login.toLowerCase() === w) || byLogin.find((p) => p.login.toLowerCase().startsWith(w)) ||
    byLogin.find((p) => p.name.toLowerCase().split(/\s+/).some((t) => t.startsWith(w)))
  return hit ? hit.login : null
}

function coerceField(f: LogField, raw: string): FieldValue | undefined {
  const v = raw.trim()
  if (f.type === 'number') {
    const n = Number(v)
    return v !== '' && Number.isFinite(n) ? n : undefined
  }
  if (f.type === 'scale') {
    const n = Number(v)
    return Number.isInteger(n) && n >= 1 && n <= (f.max || 5) ? n : undefined
  }
  if (f.type === 'bool') {
    const b = lower(v)
    return ['true', 'yes', 'y', '1', '✓'].includes(b) ? true : ['false', 'no', 'n', '0'].includes(b) ? false : undefined
  }
  if (f.type === 'choice') return (f.options || []).find((o) => o.toLowerCase() === v.toLowerCase())
  return v || undefined
}

/** One-line check-in → entry parts. Tokens: #kind, +project (prefix), 45m / 2h / 1.5h / 1h30m,
 *  key=value (custom field), @login (prefix of a login or name). The rest → the first text field.
 *  `allProjects` (optional) is searched after `myProjects`. */
export function parseQuickLine(
  line: string,
  ctx: { cfg: LogConfig; myProjects: string[]; roster: Person[]; allProjects?: string[] },
): { kind: string; project?: string; fields: Record<string, FieldValue>; ref: string[]; chips: string[] } {
  const cfg = cfgOk(ctx && ctx.cfg)
  const fields: Record<string, FieldValue> = {}
  const ref: string[] = []
  let kind = ''
  let project: string | undefined
  const rest: string[] = []
  const { min: minutesField, hour: hoursField } = timeFieldsOf(cfg)
  for (const tok of str(line).split(/\s+/).filter(Boolean)) {
    let m: RegExpMatchArray | null
    if (!kind && (m = tok.match(/^#([A-Za-z][A-Za-z0-9-]{0,15})$/))) {
      kind = normKind(m[1])
      continue
    }
    if (project === undefined && (m = tok.match(/^\+([A-Za-z0-9][A-Za-z0-9-]*)$/))) {
      project = matchProject(m[1], ctx.myProjects || [], ctx.allProjects || [])
      continue
    }
    const dur = tok.match(/^(\d+(?:\.\d+)?)(m|min|mins|h|hr|hrs)$/i) || tok.match(/^(\d+)h(\d+)m?$/i)
    if (dur && (minutesField || hoursField) && !('__dur' in fields)) {
      const min = /^\d+h\d+/i.test(tok)
        ? Number(dur[1]) * 60 + Number(dur[2])
        : /^h/i.test(dur[2]) ? Math.round(Number(dur[1]) * 60) : Math.round(Number(dur[1]))
      if (minutesField && fields[minutesField.key] === undefined) {
        fields[minutesField.key] = min
        continue
      }
      if (!minutesField && hoursField && fields[hoursField.key] === undefined) {
        fields[hoursField.key] = Math.round((min / 60) * 100) / 100
        continue
      }
    }
    if ((m = tok.match(/^([A-Za-z][A-Za-z0-9_]{0,23})=(.+)$/))) {
      const f = cfg.fields.find((x) => x.key === m![1].toLowerCase())
      const v = f ? coerceField(f, m[2]) : undefined
      if (f && v !== undefined) {
        fields[f.key] = v
        continue
      }
    }
    if ((m = tok.match(/^@([A-Za-z0-9][A-Za-z0-9-]*)$/))) {
      const login = resolveLogin(m[1], ctx.roster || [])
      if (login) {
        if (!ref.includes('@' + login)) ref.push('@' + login)
        continue
      }
    }
    rest.push(tok)
  }
  const k = kind || cfg.kinds[0] || 'done'
  const text = cfg.fields.find((f) => f.type === 'text')
  if (rest.length) fields[text ? text.key : 'did'] = rest.join(' ')
  const chips = [kindCell(k)]
  if (project) chips.push(project)
  for (const f of cfg.fields) {
    const v = fields[f.key]
    if (v === undefined || f.type === 'text') continue
    if (f.type === 'number') chips.push(f.unit ? `${v} ${f.unit}` : `${f.label} ${v}`)
    else if (f.type === 'scale') chips.push(f.key === 'energy' ? `⚡${v}` : `${f.label} ${v}/${f.max || 5}`)
    else if (f.type === 'bool') chips.push(`${f.label} ${v ? '✓' : '✗'}`)
    else chips.push(`${f.label}: ${v}`)
  }
  chips.push(...ref)
  const out: { kind: string; project?: string; fields: Record<string, FieldValue>; ref: string[]; chips: string[] } = { kind: k, fields, ref, chips }
  if (project) out.project = project
  return out
}

// ===========================================================================
// Derivation: events
// ===========================================================================

const clean = <T extends Record<string, unknown>>(o: T): T => {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]
  return o
}

function entryTitle(e: Entry): string {
  for (const v of Object.values(e.fields || {})) if (typeof v === 'string' && v.trim()) return v
  return KINDS[e.kind] ? KINDS[e.kind].label : e.kind
}

/** Log rows → events. `logs` keys may be slugs or logins; 'claude' = Claude's own log. A row's time goes under
 *  `fields.minutes` too when the person's time field has another key (one rule for every summary: timeFieldsOf). */
function logEvents(docs: CoreDoc[], logs: Map<string, Entry[]> | undefined): Ev[] {
  const bySlug = new Map<string, Person>()
  for (const p of rosterOf(docs)) bySlug.set(p.slug, p)
  const out: Ev[] = []
  const keys = [...(logs ? logs.keys() : [])].sort(cmp)
  for (const key of keys) {
    const slug = slugOf(key)
    const claude = slug === 'claude'
    const person = bySlug.get(slug)
    const login = claude ? 'claude' : person ? person.login : key
    const cfg = claude ? CLAUDE_LOG_CONFIG : person ? person.log : DEFAULT_LOG_CONFIG
    for (const e of (logs as Map<string, Entry[]>).get(key) || []) {
      if (!e || !e.at || !e.date) continue
      const path = entryLogPath(slug, e)
      const forTok = claude ? (e.ref || []).map((r) => r.match(/^for @(\S+)$/)).find(Boolean) : null
      const fields: Record<string, unknown> = { ...(e.fields || {}) }
      const min = entryMinutes(fields, cfg)
      if (min && minutesOf(fields) !== min) fields.minutes = min
      out.push(clean({
        id: `${claude ? 'claude.log' : 'log'}:${path}#${e.when}`,
        kind: (claude ? 'claude.log' : 'log') as EvKind,
        at: toIso(e.at),
        actor: login,
        for: forTok ? forTok[1] : undefined,
        project: e.project || undefined,
        title: entryTitle(e),
        path,
        logKind: e.kind,
        fields,
        ref: e.ref && e.ref.length ? [...e.ref] : undefined,
        when: e.when,
      }))
    }
  }
  return out
}

/** Everything that happened, derived from the files (nothing is stored). Sorted by time, then id.
 *  `viewer`: AI questions show their text only to their author ("asked AI" for everyone else). */
export function deriveEvents(docs: CoreDoc[], opts: { logs: Map<string, Entry[]>; viewer?: string }): Ev[] {
  const all = [...(docs || [])].filter((d) => d && typeof d.path === 'string').sort((a, b) => cmp(a.path, b.path))
  const out: Ev[] = logEvents(all, opts && opts.logs)
  const posts = all.filter((d) => POST_RE.test(d.path))
  const postById = new Map<string, CoreDoc>()
  for (const p of posts) postById.set(idOf(p), p)
  for (const d of all) {
    const x = dataOf(d)
    if (TODO_RE.test(d.path)) {
      const owner = str(x.owner).trim()
      const by = str(x.by).trim() || owner
      const title = str(x.title).trim() || firstLine(d.body)
      const project = str(x.project).trim() || undefined
      const status = lower(x.status) || 'todo'
      const fields = clean({ by, owner, status, blocker: str(x.blocker).trim() || undefined })
      const forOf = (actor: string) => (owner && !same(owner, actor) ? owner : undefined)
      out.push(clean({ id: `todo.created:${d.path}`, kind: 'todo.created' as EvKind, at: toIso(x.created), actor: by, for: forOf(by), project, title, path: d.path, fields: { ...fields } }))
      if (x.started_at) {
        const actor = str(x.started_by).trim() || owner
        out.push(clean({ id: `todo.started:${d.path}`, kind: 'todo.started' as EvKind, at: toIso(x.started_at), actor, for: forOf(actor), project, title, path: d.path, fields: { ...fields } }))
      }
      if (status === 'done') {
        const actor = str(x.done_by).trim() || owner
        out.push(clean({ id: `todo.done:${d.path}`, kind: 'todo.done' as EvKind, at: toIso(x.done_at), actor, for: forOf(actor), project, title, path: d.path, fields: { ...fields } }))
      }
    } else if (POST_RE.test(d.path)) {
      const author = str(x.author).trim()
      const to = str(x.to).trim()
      const title = firstLine(d.body) || str(x.title)
      const project = str(x.project).trim() || undefined
      const fields = clean({ type: str(x.type) || undefined, request: str(x.request) || undefined, part: str(x.part) || undefined, status: lower(x.status) || 'open' })
      out.push(clean({ id: `post:${d.path}`, kind: 'post' as EvKind, at: toIso(x.created), actor: author, for: to && !same(to, author) ? to : undefined, project, title, path: d.path, fields }))
      if (lower(x.status) === 'done') {
        const actor = str(x.closed_by).trim() || author
        out.push(clean({ id: `post.closed:${d.path}`, kind: 'post.closed' as EvKind, at: toIso(x.closed_at), actor, for: !same(actor, author) ? author : undefined, project, title, path: d.path }))
      }
    } else if (REPLY_RE.test(d.path)) {
      const parent = postById.get(str(x.parent).trim())
      const pa = parent ? str(dataOf(parent).author).trim() : ''
      const project = parent ? str(dataOf(parent).project).trim() || undefined : undefined
      if (lower(x.via) === 'bridge') {
        const fields = clean({ seconds: typeof x.seconds === 'number' ? x.seconds : undefined, files: typeof x.files === 'number' ? x.files : undefined })
        out.push(clean({ id: `claude.run:${d.path}`, kind: 'claude.run' as EvKind, at: toIso(x.created), actor: 'claude', for: pa || undefined, project, title: firstLine(d.body), path: d.path, fields: Object.keys(fields).length ? fields : undefined }))
      } else {
        const author = str(x.author).trim()
        out.push(clean({ id: `reply:${d.path}`, kind: 'reply' as EvKind, at: toIso(x.created), actor: author, for: pa && !same(pa, author) ? pa : undefined, project, title: firstLine(d.body), path: d.path }))
      }
    } else if (REQUEST_RE.test(d.path)) {
      const author = str(x.author).trim()
      if (!author) continue
      const mine = !!(opts && opts.viewer) && same(opts.viewer, author)
      out.push(clean({ id: `ai.question:${d.path}`, kind: 'ai.question' as EvKind, at: toIso(x.created), actor: author, project: str(x.project).trim() || undefined, title: mine ? firstLine(d.body) || 'asked AI' : 'asked AI', path: d.path }))
    }
  }
  for (const [slug, d] of projectDocs(all)) {
    const x = dataOf(d)
    const owner = str(x.owner).trim()
    if (!owner || !x.started) continue
    out.push({ id: `project.started:${d.path}`, kind: 'project.started', at: toIso(x.started), actor: owner, project: slug, title: projectTitle(slug, d), path: d.path })
  }
  // two rows in the same minute → keep ids unique, deterministically
  const ids = new Map<string, number>()
  for (const e of out) {
    const n = (ids.get(e.id) || 0) + 1
    ids.set(e.id, n)
    if (n > 1) e.id = `${e.id}~${n}`
  }
  return out.sort((a, b) => cmp(a.at, b.at) || cmp(a.id, b.id))
}

/** Label a commit for toasts, activity and digest counts (never for people stats). */
export function commitActor(c: { message: string; author: string }): string {
  const author = str(c && c.author).trim()
  const msg = str(c && c.message)
  const a = author.toLowerCase()
  if (a === 'hq-ai' || a === 'hq-digest') return a
  if (/^claude:/i.test(msg.split(/\r?\n/)[0].trim()) || /^co-authored-by:\s*claude\b/im.test(msg)) return 'claude'
  return author
}

/** Does this event count as working on its project? An Ask AI question tagged with a project does not: AI
 *  questions live in ai/ (not indexed, so the AI could never agree) and their topic stays the asker's (P6). */
const worksOn = (e: Ev): boolean => !!e.project && e.kind !== 'ai.question'

const minutesOf = (f: Record<string, unknown> | undefined): number => {
  if (!f) return 0
  if (typeof f.minutes === 'number' && Number.isFinite(f.minutes)) return f.minutes
  if (typeof f.hours === 'number' && Number.isFinite(f.hours)) return Math.round(f.hours * 60)
  return 0
}

/** Counts for one person in [from, to). Log-row counts are self-reported; the rest are recorded.
 *  Keys: checkins wins learned blockers todos_done todos_created assigned_in assigned_out posts
 *  replies claude_for ai_questions minutes. */
export function summarize(events: Ev[], login: string, from: string, to: string): Record<string, number> {
  const F = toIso(from)
  const T = toIso(to)
  const s: Record<string, number> = {
    checkins: 0, wins: 0, learned: 0, blockers: 0, todos_done: 0, todos_created: 0, assigned_in: 0, assigned_out: 0,
    posts: 0, replies: 0, claude_for: 0, ai_questions: 0, minutes: 0,
  }
  const me = same(login, 'claude') ? 'claude' : login
  for (const e of events || []) {
    if (!inWin(e.at, F, T)) continue
    const mine = same(e.actor, me)
    const logRow = e.kind === 'log' || (e.kind === 'claude.log' && me === 'claude')
    if (logRow && mine) {
      if (e.logKind !== 'unblocked') s.checkins++
      if (e.logKind === 'win') s.wins++
      if (e.logKind === 'learned') s.learned++
      if (e.logKind === 'blocked') s.blockers++
      s.minutes += minutesOf(e.fields)
    } else if (e.kind === 'todo.done' && mine) s.todos_done++
    else if (e.kind === 'todo.created') {
      if (mine) s.todos_created++
      if (mine && e.for && isHuman(me) && isHuman(e.for)) s.assigned_out++
      if (same(e.for, me) && !mine && isHuman(e.actor)) s.assigned_in++
    } else if (e.kind === 'post' && mine) s.posts++
    else if (e.kind === 'reply' && mine) s.replies++
    else if (e.kind === 'ai.question' && mine) s.ai_questions++
    if (same(e.for, me) && (e.kind === 'claude.log' || e.kind === 'claude.run' || (e.kind === 'todo.done' && same(e.actor, 'claude')))) s.claude_for++
  }
  return s
}

const metricLabel = (m: string): string =>
  ({ checkins: 'check-ins', wins: 'wins', learned: 'learned', todos_done: 'to-dos done', posts: 'posts', replies: 'replies', minutes: 'minutes', hours: 'hours' } as Record<string, string>)[m] || m.replace(/_/g, ' ')

function metricValue(metric: string, events: Ev[], login: string, from: string, to: string): number {
  const s = summarize(events, login, from, to)
  if (metric === 'hours') return round1(s.minutes / 60)
  if (metric in s) return s[metric]
  let sum = 0
  for (const e of events) {
    if (e.kind !== 'log' || !same(e.actor, login) || !inWin(e.at, from, to)) continue
    const v = e.fields ? e.fields[metric] : undefined
    if (typeof v === 'number' && Number.isFinite(v)) sum += v
  }
  return round1(sum)
}

/** Progress on my goals: this week (my week_starts, my tz) or this month, up to `now`. */
export function goalProgress(p: Person, events: Ev[], now: string): { goal: Goal; actual: number; label: string }[] {
  const tz = zoneOr(p.timezone)
  const today = zonedParts(now, tz).date
  const to = isoOf(Date.parse(toIso(now)) + 1000)
  if (!today || !to) return []
  return (cfgOk(p.log).goals || []).map((goal) => {
    const start = goal.per === 'month' ? today.slice(0, 8) + '01' : weekStart(today, p.log.week_starts)
    const from = zonedToUtc(start, '00:00', tz)
    const evs = goal.project ? (events || []).filter((e) => e.project === goal.project) : events || []
    const actual = metricValue(goal.metric, evs, p.login, from, to)
    return { goal, actual, label: `${actual} of ${goal.target} ${goal.per === 'week' ? 'this week' : 'this month'}` }
  })
}

/** Minutes per project per week (my week_starts) for the last `weeks` weeks, oldest first.
 *  Rows without a project count as '—'. `tz` = whose "now" (default Cairo). */
export function timeByProject(entries: Entry[], cfg: LogConfig, weeks: number, now: string, tz: string = TEAM_TZ): { week: string; byProject: Record<string, number> }[] {
  const c = cfgOk(cfg)
  const today = zonedParts(now, tz).date
  if (!today) return []
  const cur = weekStart(today, c.week_starts)
  const n = Math.max(1, Math.min(104, Math.floor(weeks) || 1))
  const out: { week: string; byProject: Record<string, number> }[] = []
  for (let i = n - 1; i >= 0; i--) out.push({ week: addDays(cur, -7 * i), byProject: {} })
  for (const e of entries || []) {
    if (!e || !e.date) continue
    const min = entryMinutes(e.fields, c)
    if (!min) continue
    const w = out.find((x) => x.week === weekStart(e.date, c.week_starts))
    if (!w) continue
    const k = e.project || '—'
    w.byProject[k] = (w.byProject[k] || 0) + min
  }
  return out
}

/** Who's on what: projects × people (+ Claude) with role, part and coarse activity dots
 *  (events per person per project in `days`: 0 · 1–2 · 3–5 · 6+). No counts per person. */
export function teamMatrix(events: Ev[], roster: Person[], docs: CoreDoc[], days: number, now: string): {
  projects: string[]
  cells: Record<string, Record<string, { role?: 'owner' | 'member'; part?: string; dots: 0 | 1 | 2 | 3 }>>
} {
  const T = isoOf(Date.parse(toIso(now)) + 1000)
  const F = isoOf(Date.parse(toIso(now)) - Math.max(1, days) * DAY_MS)
  const canon = canonFn(docs, roster)
  const projs = projectDocs(docs)
  const counts = new Map<string, number>()
  for (const e of events || []) {
    if (!worksOn(e) || !inWin(e.at, F, T)) continue
    const k = `${e.project}\u0000${canon(e.actor).toLowerCase()}`
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  const people: string[] = []
  const addP = (l: string) => {
    const c = canon(l)
    if (c && !people.some((x) => same(x, c))) people.push(c)
  }
  for (const p of roster || []) if (p.status === 'active') addP(p.login)
  const slugs = [...projs.keys()].filter((s) => lower(dataOf(projs.get(s)).status) !== 'done' || [...counts.keys()].some((k) => k.startsWith(s + '\u0000')))
  slugs.sort((a, b) => statusRank(lower(dataOf(projs.get(a)).status)) - statusRank(lower(dataOf(projs.get(b)).status)) || cmp(a, b))
  for (const s of slugs) for (const m of membersOf(s, docs)) if (isHuman(m.login)) addP(m.login)
  const cols = [...people, 'claude']
  const cells: Record<string, Record<string, { role?: 'owner' | 'member'; part?: string; dots: 0 | 1 | 2 | 3 }>> = {}
  for (const s of slugs) {
    const members = membersOf(s, docs)
    cells[s] = {}
    for (const l of cols) {
      const n = counts.get(`${s}\u0000${l.toLowerCase()}`) || 0
      const m = members.find((x) => same(x.login, l))
      const cell: { role?: 'owner' | 'member'; part?: string; dots: 0 | 1 | 2 | 3 } = { dots: n === 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : 3 }
      if (m) cell.role = m.role
      if (m && m.part) cell.part = m.part
      cells[s][l] = cell
    }
  }
  return { projects: slugs, cells }
}

// ===========================================================================
// Blockers, waits, For you
// ===========================================================================

/** A 🔓 row may read up to this much before its blocker (a wall-clock hour that happens twice). */
const DST_SLACK_MS = 36e5
const notBefore = (at: string, ref: string): boolean => !at || !ref || Date.parse(at) >= Date.parse(ref) - DST_SLACK_MS

/** When (and how) a blocked log event was resolved: a 🔓 row with `↳ <When>`, or the help
 *  to-do (blocker = path#When) done. null = still open. at '' = resolved, time unknown.
 *  `asOf`: only resolutions known by then (a stamp after it doesn't count; no stamp = current state). */
function resolutionOf(b: Ev, events: Ev[], asOf = ''): { at: string; via: 'row' | 'todo'; by: string } | null {
  const key = `${b.path}#${b.when}`
  let best: { at: string; via: 'row' | 'todo'; by: string } | null = null
  const consider = (r: { at: string; via: 'row' | 'todo'; by: string }) => {
    if (asOf && r.at && r.at > asOf) return
    if (!best || (r.at && (!best.at || r.at < best.at))) best = r
  }
  for (const e of events) {
    if (e.kind === 'log' && e.logKind === 'unblocked' && same(e.actor, b.actor) && (e.ref || []).includes(`↳ ${b.when}`) && notBefore(e.at, b.at)) consider({ at: e.at, via: 'row', by: e.actor })
    if (e.kind === 'todo.done' && e.fields && str(e.fields.blocker) === key) consider({ at: e.at, via: 'todo', by: e.actor })
  }
  return best
}

/** Is this blocker row still open? (A 🔓 row with `↳ <When>`, or its help to-do done, closes it.) */
export function blockerOpen(e: Entry, logPath: string, entries: Entry[], todos: CoreDoc[]): boolean {
  if (!e || e.kind !== 'blocked') return false
  const key = `${logPath}#${e.when}`
  if ((entries || []).some((x) => x && x.kind === 'unblocked' && (x.ref || []).includes(`↳ ${e.when}`) && notBefore(x.at, e.at))) return false
  if ((todos || []).some((t) => str(dataOf(t).blocker).trim() === key && lower(dataOf(t).status) === 'done')) return false
  return true
}

const WAIT_ICON: Record<string, string> = { join: '🙋', leave: '🚪' }

/** Was this to-do or post still open at `at`? Done with a stamp (done_at / closed_at) after `at` → still open then;
 *  done without a stamp → done (its current status is all we know). */
function openAt(d: CoreDoc, at: string): boolean {
  if (isOpen(d)) return true
  const x = dataOf(d)
  const stamp = toIso(TODO_RE.test(d.path) ? x.done_at : x.closed_at)
  return !!at && !!stamp && stamp > at
}

/** Open waits at `now`. asOf: to-dos, posts and blockers as they stood at `now` (past weeks of a digest), not now. */
function waitsCore(docs: CoreDoc[], evs: Ev[], now: string, asOf = false): Wait[] {
  const N = toIso(now)
  const open = (d: CoreDoc) => (asOf ? openAt(d, N) : isOpen(d))
  const at = asOf ? N : ''
  const out: Wait[] = []
  const todos = docs.filter((d) => TODO_RE.test(d.path))
  const hasTodo = new Set(todos.filter((t) => !asOf || toIso(dataOf(t).created) <= N).map((t) => str(dataOf(t).blocker).trim()).filter(Boolean))
  const blockerByKey = new Map<string, Ev>()
  for (const e of evs) if (e.kind === 'log' && e.logKind === 'blocked') blockerByKey.set(`${e.path}#${e.when}`, e)
  for (const t of todos) {
    const x = dataOf(t)
    const owner = str(x.owner).trim()
    const by = str(x.by).trim()
    if (!open(t) || !isHuman(owner) || !isHuman(by) || same(owner, by)) continue
    const blocker = str(x.blocker).trim()
    const row = blocker ? blockerByKey.get(blocker) : undefined
    if (row && resolutionOf(row, evs, at)) continue // the blocked person moved on (🔓)
    out.push({ waiter: by, on: owner, what: `${blocker ? '🧱' : '☑'} ${str(x.title).trim() || firstLine(t.body)}`, since: toIso(x.created), path: t.path })
  }
  for (const p of docs.filter((d) => POST_RE.test(d.path))) {
    const x = dataOf(p)
    const author = str(x.author).trim()
    const to = str(x.to).trim()
    if (!to || !open(p) || !isHuman(author) || !isHuman(to) || same(author, to)) continue
    const req = lower(x.request)
    const what = req === 'join'
      ? `🙋 Join ${str(x.project)} as ${str(x.part) || 'a member'}`
      : req === 'leave' ? `🚪 Leave ${str(x.project)}` : `💬 ${firstLine(p.body) || 'post'}`
    out.push({ waiter: author, on: to, what, since: toIso(x.created), path: p.path })
  }
  for (const e of evs) {
    if (e.kind !== 'log' || e.logKind !== 'blocked' || !isHuman(e.actor)) continue
    const key = `${e.path}#${e.when}`
    if (hasTodo.has(key) || resolutionOf(e, evs, at)) continue
    for (const r of e.ref || []) {
      const m = r.match(/^@([A-Za-z0-9][A-Za-z0-9-]*)$/)
      if (!m || !isHuman(m[1]) || same(m[1], e.actor)) continue
      out.push({ waiter: e.actor, on: m[1], what: `🧱 ${e.title}`, since: e.at, path: key })
    }
  }
  return out
    .filter((w) => !N || !w.since || w.since <= N)
    .sort((a, b) => cmp(a.since, b.since) || cmpI(a.waiter, b.waiter) || cmp(a.path, b.path))
}

/** Open "X waits on Y" items, oldest first: hand-off and help to-dos, posts with `to:` (incl.
 *  join/leave requests) and blocker rows with @someone that have no help to-do yet. */
export function waitingOn(docs: CoreDoc[], logs: Map<string, Entry[]>, now: string): Wait[] {
  const all = [...(docs || [])].filter(Boolean)
  return waitsCore(all, logEvents(all, logs), now)
}

/** Ack hash of the "you were added to <slug>" item. */
export const memberAckHash = (slug: string): string => shortHash(`member:${slug}`)

/** The digest's `updated` (a Saturday) → when the item counts as new: Sunday 12:00 Cairo. */
function digestSince(updated: unknown): string {
  const s = str(updated).trim()
  return isDate(s) ? zonedToUtc(addDays(s, 1), '12:00', TEAM_TZ) : toIso(s)
}

/** For-you ids are stable per file: one to-do keeps its id when it moves between "help" and "assigned" (its blocker
 *  got resolved), one post between "join/leave" and "to-me" (the project changed hands). */
const FY_GROUP: Record<string, string> = { help: 'todo', assigned: 'todo', join: 'post', leave: 'post', 'to-me': 'post' }

/** Everything waiting for `viewer`, derived (no writes). Rules, in order:
 *  1 help (open to-do for me with `blocker`) · 2 join/leave request to me for a project I own ·
 *  3 assigned (open to-do for me by someone else) · 4 open post `to: me` · 5 added to a project
 *  (until acked) · 6 reply to my post · 7 @mention · 8 my new digest (6–8: newer than seen.at).
 *  Then oldest first. Ids: `todo:<path>` (rules 1, 3), `post:<path>` (2, 4), else `${kind}:<path>`; hashes =
 *  shortHash(id) (added: memberAckHash). opts.asOf: to-dos, posts and blockers as they stood at `now` (a
 *  digest's past weeks), not as they are today. */
export function forYou(viewer: string, docs: CoreDoc[], logs: Map<string, Entry[]>, seen: Seen, now: string, opts: { asOf?: boolean } = {}): ForYouItem[] {
  const all = [...(docs || [])].filter((d) => d && typeof d.path === 'string').sort((a, b) => cmp(a.path, b.path))
  const N = toIso(now)
  const asOf = !!(opts && opts.asOf) && !!N
  const isOpen = (d: CoreDoc): boolean => (asOf ? openAt(d, N) : lower(dataOf(d).status) !== 'done')
  const resolved = (row: Ev): boolean => !!resolutionOf(row, evs, asOf ? N : '')
  const seenAt = toIso(seen && seen.at)
  const ack = new Set(seen && Array.isArray(seen.ack) ? seen.ack : [])
  const evs = logEvents(all, logs)
  const todos = all.filter((d) => TODO_RE.test(d.path))
  const posts = all.filter((d) => POST_RE.test(d.path))
  const replies = all.filter((d) => REPLY_RE.test(d.path))
  const projs = projectDocs(all)
  const postById = new Map<string, CoreDoc>()
  for (const p of posts) postById.set(idOf(p), p)
  const blockerRows = new Map<string, Ev>()
  for (const e of evs) if (e.kind === 'log' && e.logKind === 'blocked') blockerRows.set(`${e.path}#${e.when}`, e)
  const hasTodo = new Set(todos.filter((t) => !asOf || toIso(dataOf(t).created) <= N).map((t) => str(dataOf(t).blocker).trim()).filter(Boolean))
  const items: { rule: number; item: ForYouItem }[] = []
  const used = new Set<string>()
  const push = (rule: number, kind: ForYouKind, d: { from: string; title: string; path: string; since: string; project?: string; part?: string; hash?: string }) => {
    if (used.has(d.path)) return
    if (N && d.since && d.since > N) return
    const id = `${FY_GROUP[kind] || kind}:${d.path}`
    const hash = d.hash || shortHash(id)
    if (rule >= 5 && ack.has(hash)) return
    used.add(d.path)
    const isNew = rule >= 5 ? true : !ack.has(hash) && (!seenAt || !d.since || d.since > seenAt)
    items.push({ rule, item: clean({ id, hash, kind, from: d.from, title: d.title, path: d.path, since: d.since, project: d.project || undefined, part: d.part || undefined, isNew }) })
  }
  // 1 + 3: open to-dos for me
  for (const t of todos) {
    const x = dataOf(t)
    if (!isOpen(t) || !same(x.owner, viewer)) continue
    const by = str(x.by).trim()
    const blocker = str(x.blocker).trim()
    const title = str(x.title).trim() || firstLine(t.body)
    const base = { title, path: t.path, since: toIso(x.created), project: str(x.project).trim() || undefined }
    const row = blocker ? blockerRows.get(blocker) : undefined
    if (blocker && !same(by, viewer) && !(row && resolved(row))) push(1, 'help', { ...base, from: by })
  }
  // 2: join/leave requests for projects I own
  for (const p of posts) {
    const x = dataOf(p)
    const req = lower(x.request)
    if (!isOpen(p) || !same(x.to, viewer) || (req !== 'join' && req !== 'leave')) continue
    const proj = projs.get(str(x.project).trim())
    if (!proj || !same(dataOf(proj).owner, viewer)) continue
    push(2, req as ForYouKind, { from: str(x.author).trim(), title: firstLine(p.body), path: p.path, since: toIso(x.created), project: str(x.project).trim(), part: str(x.part).trim() || undefined })
  }
  for (const t of todos) {
    const x = dataOf(t)
    const by = str(x.by).trim()
    if (!isOpen(t) || !same(x.owner, viewer) || same(by, viewer) || !by) continue
    push(3, 'assigned', { from: by, title: str(x.title).trim() || firstLine(t.body), path: t.path, since: toIso(x.created), project: str(x.project).trim() || undefined })
  }
  // 4: open posts to me
  for (const p of posts) {
    const x = dataOf(p)
    if (!isOpen(p) || !same(x.to, viewer) || same(x.author, viewer)) continue
    push(4, 'to-me', { from: str(x.author).trim(), title: firstLine(p.body), path: p.path, since: toIso(x.created), project: str(x.project).trim() || undefined })
  }
  // 5: added to a project as a member. `updated` is a date (the owner's local day): 00:00 UTC of it can still be
  // ahead of now, so it is capped at now (else the item would hide for up to a few hours after midnight).
  for (const [slug, d] of projs) {
    const m = membersOf(slug, all).find((x) => same(x.login, viewer))
    if (!m || m.role !== 'member') continue
    const upd = toIso(dataOf(d).updated)
    push(5, 'added', { from: str(dataOf(d).owner).trim(), title: projectTitle(slug, d), path: d.path, since: N && upd > N ? N : upd, project: slug, part: m.part, hash: memberAckHash(slug) })
  }
  const newer = (at: string) => !!at && (!seenAt || at > seenAt)
  // 6: replies to my posts
  for (const r of replies) {
    const x = dataOf(r)
    const parent = postById.get(str(x.parent).trim())
    const author = lower(x.via) === 'bridge' ? 'claude' : str(x.author).trim()
    if (!parent || !same(dataOf(parent).author, viewer) || same(author, viewer) || !newer(toIso(x.created))) continue
    push(6, 'reply', { from: author, title: firstLine(parent.body), path: r.path, since: toIso(x.created), project: str(dataOf(parent).project).trim() || undefined })
  }
  // 7: @mentions in log rows, posts and replies
  const mentions: { from: string; title: string; path: string; since: string; project?: string }[] = []
  for (const e of evs) {
    if (e.kind !== 'log' || same(e.actor, viewer) || !newer(e.at)) continue
    if (!(e.ref || []).some((r) => same(r, '@' + viewer))) continue
    const key = `${e.path}#${e.when}`
    if (hasTodo.has(key)) continue // the help to-do already covers it
    mentions.push({ from: e.actor, title: e.title, path: key, since: e.at, project: e.project })
  }
  const at = new RegExp(`(^|[^\\w@])@${str(viewer).replace(/[^A-Za-z0-9-]/g, '')}(?![\\w-])`, 'i')
  for (const d of [...posts, ...replies]) {
    const x = dataOf(d)
    const author = str(x.author).trim()
    if (!str(viewer).trim() || same(author, viewer) || !newer(toIso(x.created)) || !at.test(str(d.body))) continue
    const parent = REPLY_RE.test(d.path) ? postById.get(str(x.parent).trim()) : d
    mentions.push({ from: author, title: firstLine(d.body), path: d.path, since: toIso(x.created), project: str(dataOf(parent).project).trim() || undefined })
  }
  for (const m of mentions.sort((a, b) => cmp(a.since, b.since) || cmp(a.path, b.path))) push(7, 'mention', m)
  // 8: my newest digest
  const dig = all.filter((d) => {
    const m = d.path.match(DIGEST_RE)
    return !!m && m[1] === slugOf(viewer)
  }).sort((a, b) => cmp(b.path, a.path))[0]
  if (dig) {
    const since = digestSince(dataOf(dig).updated)
    const weeks = strList(dataOf(dig).weeks)
    const last = weeks[weeks.length - 1]
    if (newer(since)) push(8, 'digest', { from: 'hq-digest', title: `Your week of ${last && isDate(last) ? dayLabel(last) : str(dataOf(dig).month)}`, path: dig.path, since })
  }
  return items
    .sort((a, b) => a.rule - b.rule || cmp(a.item.since, b.item.since) || cmp(a.item.id, b.item.id))
    .map((x) => x.item)
}

/** One line for a For-you item. `toast` = the "alice added you to demo (mobile app)" form. */
export function forYouText(item: ForYouItem, nameOf: (login: string) => string = (l) => l, toast = false): string {
  const from = nameOf(item.from)
  switch (item.kind) {
    case 'help': return `🧱 ${from} is blocked and asked you · "${item.title}"`
    case 'join': return `🙋 ${from} asks to join ${item.project} as ${item.part || 'a member'}`
    case 'leave': return `🚪 ${from} asks to leave ${item.project}`
    case 'assigned': return `☑ From ${from}: ${item.title}`
    case 'to-me': return `💬 ${from} → you: ${item.title}`
    case 'added': return toast
      ? `📁 ${from} added you to ${item.title}${item.part ? ` (${item.part})` : ''}`
      : `📁 You were added to ${item.title}${item.part ? ` as ${item.part}` : ''}`
    case 'reply': return `💬 ${from} replied to your post "${item.title}"`
    case 'mention': return `@ ${from} mentioned you · ${item.title}`
    case 'digest': return `🗓️ ${item.title} is ready`
  }
  return item.title
}

// ===========================================================================
// Collaboration metrics (team, pair and project level only)
// ===========================================================================

type PairAcc = Pair & { touched?: true }

/** Pairs from events in [F, T): replies to each other, to-dos for each other, unblocks (help
 *  to-do done by its owner ≠ the blocked person) and projects both touched. Humans only. */
function pairsFrom(events: Ev[], F: string, T: string, canon: (l: unknown) => string): Pair[] {
  const map = new Map<string, PairAcc>()
  const get = (x: string, y: string): { p: PairAcc; first: boolean } | null => {
    const a0 = canon(x)
    const b0 = canon(y)
    if (!isHuman(a0) || !isHuman(b0) || same(a0, b0)) return null
    const [a, b] = cmpI(a0, b0) <= 0 ? [a0, b0] : [b0, a0]
    const k = `${a.toLowerCase()}\u0000${b.toLowerCase()}`
    let p = map.get(k)
    if (!p) {
      p = { a, b, replies: 0, todos_ab: 0, todos_ba: 0, unblocks: 0, projects: [] }
      map.set(k, p)
    }
    return { p, first: same(a, a0) }
  }
  const touched = new Map<string, Set<string>>()
  for (const e of events || []) {
    if (!inWin(e.at, F, T)) continue
    if (worksOn(e) && isHuman(e.actor)) {
      const k = canon(e.actor)
      if (!touched.has(k)) touched.set(k, new Set())
      ;(touched.get(k) as Set<string>).add(e.project as string)
    }
    if (e.kind === 'reply' && e.for) {
      const g = get(e.actor, e.for)
      if (g) g.p.replies++
    } else if (e.kind === 'todo.created' && e.fields) {
      const g = get(str(e.fields.by), str(e.fields.owner))
      if (g && g.first) g.p.todos_ab++
      else if (g) g.p.todos_ba++
    } else if (e.kind === 'todo.done' && e.fields && str(e.fields.blocker)) {
      if (!same(e.actor, e.fields.owner)) continue // credit goes to the helper only
      const g = get(str(e.fields.owner), str(e.fields.by))
      if (g) g.p.unblocks++
    }
  }
  const people = [...touched.keys()].sort(cmpI)
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const both = [...(touched.get(people[i]) as Set<string>)].filter((s) => (touched.get(people[j]) as Set<string>).has(s)).sort(cmp)
      if (!both.length) continue
      const g = get(people[i], people[j])
      if (g) g.p.projects = both
    }
  }
  return [...map.values()]
    .filter((p) => p.replies + p.todos_ab + p.todos_ba + p.unblocks > 0 || p.projects.length > 0)
    .sort((x, y) => cmpI(x.a, y.a) || cmpI(x.b, y.b))
}

/** Collaboration metrics for [from, to): asks and first replies, the blocker loop, hand-offs,
 *  pairs, shared vs solo projects, team time per project and Claude's tasks. Medians need
 *  n ≥ 3 (else null = "too few to say"). No per-person totals by design. */
export function collabStats(events: Ev[], docs: CoreDoc[], roster: Person[], from: string, to: string): CollabStats {
  const F = toIso(from)
  const T = toIso(to)
  const all = [...(docs || [])].filter((d) => d && typeof d.path === 'string').sort((a, b) => cmp(a.path, b.path))
  const evs = events || []
  const canon = canonFn(all, roster || [])
  const posts = all.filter((d) => POST_RE.test(d.path))
  const replies = all.filter((d) => REPLY_RE.test(d.path))
  const todos = all.filter((d) => TODO_RE.test(d.path))

  // asks → first response by the addressee
  const asks: { created: string; answered: string }[] = []
  for (const p of posts) {
    const x = dataOf(p)
    const author = str(x.author).trim()
    const to2 = str(x.to).trim()
    const created = toIso(x.created)
    if (!to2 || !isHuman(author) || !isHuman(to2) || same(author, to2) || !inWin(created, F, T)) continue
    const id = idOf(p)
    const resp = replies
      .filter((r) => str(dataOf(r).parent).trim() === id && same(dataOf(r).author, to2) && lower(dataOf(r).via) !== 'bridge')
      .map((r) => toIso(dataOf(r).created))
    if (same(x.closed_by, to2)) resp.push(toIso(x.closed_at))
    asks.push({ created, answered: resp.filter((a) => a && a >= created && a < T).sort(cmp)[0] || '' })
  }
  for (const t of todos) {
    const x = dataOf(t)
    const by = str(x.by).trim()
    const owner = str(x.owner).trim()
    const created = toIso(x.created)
    if (!str(x.blocker).trim() || !isHuman(by) || !isHuman(owner) || same(by, owner) || !inWin(created, F, T)) continue
    const resp: string[] = []
    if (same(x.started_by, owner)) resp.push(toIso(x.started_at))
    if (lower(x.status) === 'done' && same(x.done_by, owner)) resp.push(toIso(x.done_at))
    asks.push({ created, answered: resp.filter((a) => a && a >= created && a < T).sort(cmp)[0] || '' })
  }
  const replyH = asks.filter((a) => a.answered).map((a) => hoursBetween(a.created, a.answered))

  // blocker loop (self-reported rows)
  const blocks = evs.filter((e) => e.kind === 'log' && e.logKind === 'blocked' && isHuman(e.actor) && inWin(e.at, F, T))
  let resolved = 0
  const unblockH: number[] = []
  for (const b of blocks) {
    const r = resolutionOf(b, evs)
    if (!r || (r.at && r.at >= T)) continue
    resolved++
    if (r.at) unblockH.push(Math.max(0, hoursBetween(b.at, r.at)))
  }

  // hand-offs
  let handoffsDone = 0
  let handoffsOpen = 0
  for (const t of todos) {
    const x = dataOf(t)
    const by = str(x.by).trim()
    const owner = str(x.owner).trim()
    if (!isHuman(by) || !isHuman(owner) || same(by, owner)) continue
    const done = lower(x.status) === 'done'
    const doneAt = toIso(x.done_at)
    if (done && inWin(doneAt, F, T)) handoffsDone++
    const created = toIso(x.created)
    if (created && created < T && !(done && (!doneAt || doneAt < T))) handoffsOpen++
  }

  // projects
  const shared: string[] = []
  const solo: { slug: string; owner: string }[] = []
  const F30 = isoOf(Date.parse(T) - 30 * DAY_MS)
  for (const [slug, d] of projectDocs(all)) {
    const humans = uniq(membersOf(slug, all).filter((m) => isHuman(m.login)).map((m) => canon(m.login)))
    if (humans.length >= 2) shared.push(slug)
    else if (humans.length === 1 && (lower(dataOf(d).status) || 'active') === 'active' && evs.some((e) => worksOn(e) && e.project === slug && inWin(e.at, F30, T))) {
      solo.push({ slug, owner: humans[0] })
    }
  }

  // team time per project (self-reported, never split by person)
  const minutes: Record<string, number> = {}
  for (const e of evs) {
    if (e.kind !== 'log' || !isHuman(e.actor) || !inWin(e.at, F, T)) continue
    const m = minutesOf(e.fields)
    if (!m) continue
    const k = e.project || '—'
    minutes[k] = (minutes[k] || 0) + m
  }
  const team_minutes_by_project: Record<string, number> = {}
  for (const k of Object.keys(minutes).sort(cmp)) team_minutes_by_project[k] = minutes[k]

  // Claude's tasks, per person (never in pairs)
  const claudeFor = new Map<string, number>()
  for (const e of evs) {
    if (!inWin(e.at, F, T) || !e.for) continue
    if (e.kind === 'claude.log' || e.kind === 'claude.run' || (e.kind === 'todo.done' && same(e.actor, 'claude'))) {
      const k = canon(e.for)
      claudeFor.set(k, (claudeFor.get(k) || 0) + 1)
    }
  }

  return {
    from: F,
    to: T,
    team: {
      asks_sent: asks.length,
      asks_answered: replyH.length,
      median_reply_h: replyH.length >= 3 ? round1(median(replyH)) : null,
      blockers_raised: blocks.length,
      blockers_resolved: resolved,
      median_unblock_h: unblockH.length >= 3 ? round1(median(unblockH)) : null,
      handoffs_done: handoffsDone,
      handoffs_open: handoffsOpen,
      shared_projects: shared.sort(cmp),
      solo_projects: solo.sort((a, b) => cmp(a.slug, b.slug)),
      team_minutes_by_project,
    },
    pairs: pairsFrom(evs, F, T, canon),
    waits: waitsCore(all, evs.filter((e) => e.kind === 'log'), T, true),
    claude: [...claudeFor.entries()].sort((a, b) => cmpI(a[0], b[0])).map(([f, tasks]) => ({ for: f, tasks })),
  }
}

const STOP = new Set(['the', 'and', 'for', 'with', 'help', 'who', 'can', 'could', 'our', 'need', 'needs', 'some', 'someone', 'this', 'that', 'from', 'into', 'about', 'what'])
const tokens = (s: string): string[] => lower(s).split(/[^a-z0-9]+/).filter(Boolean)
const wordHit = (word: string, item: string): boolean =>
  tokens(item).some((t) => t === word || (word.length >= 4 && t.startsWith(word)) || (t.length >= 4 && word.startsWith(t)))

/** Transparent helper scoring: +3 per task word in skills/ask_me_about · +2 owner/member of the
 *  project · +1 per log row on it in 30 days (max 3) · −1 per open item over 3. A `learning`
 *  match scores 0 and lists the person under `growth`. Claude and alumni never appear. */
export function findHelpers(task: string, project: string | undefined, roster: Person[], docs: CoreDoc[], events: Ev[], now: string): { candidates: Helper[]; growth: Helper[] } {
  const N = isoOf(Date.parse(toIso(now)) + 1000)
  const F30 = isoOf(Date.parse(toIso(now)) - 30 * DAY_MS)
  const words = uniq(tokens(task).filter((w) => w.length >= 3 && !STOP.has(w)))
  const all = [...(docs || [])].filter(Boolean)
  const proj = str(project).trim()
  const members = proj ? membersOf(proj, all) : []
  const projDoc = proj ? projectDocs(all).get(proj) : undefined
  const candidates: Helper[] = []
  const growth: Helper[] = []
  for (const p of roster || []) {
    if (p.status !== 'active' || isBot(p.login)) continue
    const mine = (events || []).filter((e) => e.kind === 'log' && same(e.actor, p.login))
    const last = mine.filter((e) => e.at && e.at < N).map((e) => e.at).sort(cmp).pop() || null
    const openTodos = all.filter((d) => TODO_RE.test(d.path) && isOpen(d) && same(dataOf(d).owner, p.login)).length
    const openPosts = all.filter((d) => POST_RE.test(d.path) && isOpen(d) && same(dataOf(d).to, p.login) && !same(dataOf(d).author, p.login)).length
    const openLoad = openTodos + openPosts
    const memberOf = projectsOf(p.login, all).map((x) => x.slug)
    const helper = (score: number, reasons: string[], g: boolean, evidence: string[]): Helper =>
      ({ login: p.login, name: p.name, pronouns: p.pronouns, score, reasons, growth: g, openLoad, lastCheckin: last, memberOf, evidence: uniq(evidence).slice(0, 5) })
    let score = 0
    const reasons: string[] = []
    const evidence = [p.path]
    for (const w of words) {
      const item = [...p.skills, ...p.askMeAbout].find((s) => wordHit(w, s))
      if (item) {
        score += 3
        reasons.push(`knows "${w}" (${item}) +3`)
      }
    }
    const m = members.find((x) => same(x.login, p.login))
    if (m && projDoc) {
      score += 2
      reasons.push(`${m.role} of ${proj}${m.part ? ` (${m.part})` : ''} +2`)
      evidence.push(projDoc.path)
    }
    if (proj) {
      const rows = mine.filter((e) => e.project === proj && inWin(e.at, F30, N))
      if (rows.length) {
        score += Math.min(3, rows.length)
        reasons.push(`${rows.length} log row${rows.length === 1 ? '' : 's'} on ${proj} in 30 days +${Math.min(3, rows.length)}`)
        evidence.push(...rows.map((e) => e.path))
      }
    }
    if (reasons.length) {
      const over = Math.max(0, openLoad - 3)
      if (over) {
        score -= over
        reasons.push(`${openLoad} open items −${over}`)
      }
      candidates.push(helper(score, reasons, false, evidence))
    }
    const learn = words.map((w) => p.learning.find((s) => wordHit(w, s))).filter((x): x is string => !!x)
    if (learn.length) growth.push(helper(0, uniq(learn).map((l) => `learning "${l}" (a chance to learn)`), true, [p.path]))
  }
  return {
    candidates: candidates.sort((a, b) => b.score - a.score || cmpI(a.login, b.login)).slice(0, 5),
    growth: growth.sort((a, b) => cmpI(a.login, b.login)).slice(0, 3),
  }
}

/** ≤3 team-up ideas, round-robin over: solo projects, learning ↔ ask-me-about, help wanted. */
export function collabHints(roster: Person[], docs: CoreDoc[], stats: CollabStats, now: string): string[] {
  const all = [...(docs || [])].filter(Boolean)
  const projs = projectDocs(all)
  const people = (roster || []).filter((p) => p.status === 'active' && isHuman(p.login))
  const soloH: string[] = []
  for (const s of (stats && stats.team && stats.team.solo_projects) || []) {
    const started = str(dataOf(projs.get(s.slug)).started).trim()
    const weeks = isDate(started) ? Math.floor((Date.parse(toIso(now)) - Date.parse(started + 'T00:00:00Z')) / (7 * DAY_MS)) : 0
    soloH.push(weeks >= 1
      ? `${s.slug} has had one person for ${weeks} week${weeks === 1 ? '' : 's'} · ask "who could help on ${s.slug}?"`
      : `${s.slug} has one person · ask "who could help on ${s.slug}?"`)
  }
  const learnH: string[] = []
  for (const a of [...people].sort((x, y) => cmpI(x.login, y.login))) {
    for (const l of a.learning) {
      const b = [...people].sort((x, y) => cmpI(x.login, y.login)).find((o) => !same(o.login, a.login) && o.askMeAbout.some((i) => tokens(l).some((w) => wordHit(w, i))))
      if (!b) continue
      const item = b.askMeAbout.find((i) => tokens(l).some((w) => wordHit(w, i)))
      learnH.push(`${a.name} is learning ${l} → ${b.name} lists "ask me about: ${item}"`)
    }
  }
  const helpH: string[] = []
  for (const [slug, d] of projs) {
    if (lower(dataOf(d).status) === 'done') continue
    for (const h of strList(dataOf(d).help_wanted).slice(0, LIMITS.helpWanted)) helpH.push(`${slug} wants help: "${h}"`)
  }
  const out: string[] = []
  for (let i = 0; out.length < 3 && i < Math.max(soloH.length, learnH.length, helpH.length); i++) {
    for (const list of [soloH, learnH, helpH]) if (list[i] && out.length < 3) out.push(list[i])
  }
  return out
}

/** The "➜ Next:" line. Own page: 1 oldest help request · 2 a join request · 3 oldest other
 *  For-you item · 4 my doing to-do · 5 my own open blocker · 6 nothing logged today · All clear.
 *  Someone else's page: a status line (projects, last check-in, open blockers). */
export function nextLine(
  viewer: string,
  person: Person,
  ctx: { events: Ev[]; forYou: ForYouItem[]; waits: Wait[]; now: string; nameOf?: (login: string) => string },
): NextLine {
  const now = toIso(ctx.now)
  const name = ctx.nameOf || ((l: string) => l)
  const events = ctx.events || []
  const login = person.login
  const tz = zoneOr(person.timezone)
  const mineLog = events.filter((e) => (e.kind === 'log' || (e.kind === 'claude.log' && same(login, 'claude'))) && same(e.actor, login) && e.at && e.at <= now)
  const openBlockers = mineLog.filter((e) => e.logKind === 'blocked' && !resolutionOf(e, events)).sort((a, b) => cmp(a.at, b.at))
  if (!same(viewer, login)) {
    const F = isoOf(Date.parse(now) - 14 * DAY_MS)
    const T = isoOf(Date.parse(now) + 1000)
    const counts = new Map<string, number>()
    for (const e of events) if (same(e.actor, login) && worksOn(e) && inWin(e.at, F, T)) counts.set(e.project as string, (counts.get(e.project as string) || 0) + 1)
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).slice(0, 2).map((x) => x[0])
    const last = mineLog.map((e) => e.at).sort(cmp).pop()
    const parts = [person.name, top.length ? `on ${top.join(', ')}` : '', last ? `last check-in ${ageText(last, now)} ago` : 'no check-ins yet']
    if (openBlockers.length) parts.push(`${openBlockers.length} open blocker${openBlockers.length === 1 ? '' : 's'}`)
    const out: NextLine = { text: parts.filter(Boolean).join(' · ').replace('just now ago', 'just now') }
    if (openBlockers.length) {
      out.action = 'help'
      out.path = `${openBlockers[0].path}#${openBlockers[0].when}`
    }
    return out
  }
  const fy = [...(ctx.forYou || [])].sort((a, b) => cmp(a.since, b.since) || cmp(a.id, b.id))
  const help = fy.find((i) => i.kind === 'help')
  if (help) return { text: `${name(help.from)} is blocked and asked you · "${help.title}" · ${ageText(help.since, now)}`, action: 'open', path: help.path }
  const join = fy.find((i) => i.kind === 'join')
  if (join) return { text: `${name(join.from)} asks to join ${join.project} as ${join.part || 'a member'}`, action: 'add', path: join.path }
  const other = fy[0]
  if (other) return { text: forYouText(other, name).replace(/^\S+\s/, ''), action: 'open', path: other.path }
  const doing = events.filter((e) => e.kind === 'todo.created' && e.fields && same(e.fields.owner, login) && e.fields.status === 'doing').sort((a, b) => cmp(a.at, b.at))[0]
  if (doing) return { text: `Keep going: ${doing.title}`, action: 'open', path: doing.path }
  const blocker = openBlockers[0]
  if (blocker) return { text: `You're blocked: ${blocker.title} · ${ageText(blocker.at, now)}`, action: 'unblock', path: `${blocker.path}#${blocker.when}` }
  const today = zonedParts(now, tz).date
  if (!mineLog.some((e) => zonedParts(e.at, tz).date === today)) return { text: 'Log one thing', action: 'checkin' }
  return { text: 'All clear ✓' }
}

// ===========================================================================
// Digests (weekly sections in monthly files, deterministic, never LLM-written)
// ===========================================================================

const sundaysOf = (month: string): string[] => {
  if (!/^\d{4}-\d{2}$/.test(month)) return []
  const first = month + '-01'
  let d = addDays(first, (7 - dowOf(first)) % 7)
  const out: string[] = []
  while (d.slice(0, 7) === month) {
    out.push(d)
    d = addDays(d, 7)
  }
  return out
}

/** Sundays of `month` whose Sun–Sat week (Cairo) has ended by `now`, ascending. */
export function digestWeeks(month: string, now: string): string[] {
  const N = toIso(now)
  return sundaysOf(month).filter((s) => !!N && weekWindow(s).to <= N)
}

/** When a week's "Waiting on you" is evaluated: the Sunday 08:00 (Cairo) after it. */
export function weekEvalAt(sunday: string): string {
  return zonedToUtc(addDays(sunday, 7), '08:00', TEAM_TZ)
}

const fmtH = (min: number): string => `${round1(min / 60)} h`
const monthTitle = (month: string): string => {
  const m = month.match(/^(\d{4})-(\d{2})$/)
  return m && MONTH_NAMES[Number(m[2]) - 1] ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : month
}
const fmBlock = (pairs: [string, unknown][]): string =>
  ['---', ...pairs.filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${Array.isArray(v) ? inlineList(v) : yamlValue(v)}`), '---'].join('\n')
const SELF_REPORTED = '> Log rows (check-ins, time, wins, learned, blockers) are self-reported. To-dos, posts and replies are recorded.'
const DIGEST_COUNTERS = ['checkins', 'wins', 'learned', 'blockers', 'minutes', 'todos_done', 'assigned_in', 'assigned_out', 'posts', 'replies', 'ai_questions', 'claude_for']
const joinItems = (xs: string[], max = 6): string => (xs.length > max ? [...xs.slice(0, max), `+${xs.length - max} more`] : xs).join('; ')
const minutesByProject = (evs: Ev[]): string =>
  Object.entries(evs.reduce((m: Record<string, number>, e) => {
    const n = minutesOf(e.fields)
    if (n) m[e.project || '—'] = (m[e.project || '—'] || 0) + n
    return m
  }, {})).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).map(([k, v]) => `${k} ${fmtH(v)}`).join(' · ')

function personWeek(p: Person, sunday: string, ctx: { events: Ev[]; logs: Entry[]; forYouAt: (weekEnd: string) => ForYouItem[] }, canon: (l: unknown) => string): string[] {
  const { from, to } = weekWindow(sunday)
  const prev = weekWindow(addDays(sunday, -7))
  const events = ctx.events || []
  const s = summarize(events, p.login, from, to)
  const l = summarize(events, p.login, prev.from, prev.to)
  const claude = same(p.login, 'claude')
  const own = events.filter((e) => (e.kind === 'log' || (claude && e.kind === 'claude.log')) && same(e.actor, p.login) && inWin(e.at, from, to))
  const tz = zoneOr(p.timezone)
  const dm = (at: string) => dayMon(zonedParts(at, tz).date)
  const line = (e: Ev) => [dm(e.at), e.project, e.title].filter(Boolean).join(' · ')
  const out = [`## Week of ${dayLabel(sunday)}`, '', '| At a glance | This week | Last week |', '|---|---|---|',
    `| Check-ins | ${s.checkins} | ${l.checkins} |`, `| To-dos done | ${s.todos_done} | ${l.todos_done} |`]
  if (s.minutes || l.minutes) out.push(`| Time | ${fmtH(s.minutes)} | ${fmtH(l.minutes)} |`)
  out.push('')
  const add = (label: string, text: string) => {
    if (text) out.push(`**${label}** · ${text}`, '')
  }
  add('Time by project', minutesByProject(own))
  add('🏆 Wins', joinItems(own.filter((e) => e.logKind === 'win').map(line)))
  add('📚 Learned', joinItems(own.filter((e) => e.logKind === 'learned').map(line)))
  if (!claude) {
    const pairs = pairsFrom(events, from, to, canon).filter((x) => same(x.a, p.login) || same(x.b, p.login))
    add('🤝 Worked with', pairs.map((x) => {
      const other = same(x.a, p.login) ? x.b : x.a
      const fromThem = same(x.a, p.login) ? x.todos_ba : x.todos_ab
      const toThem = same(x.a, p.login) ? x.todos_ab : x.todos_ba
      const bits = [
        x.replies ? `${x.replies} repl${x.replies === 1 ? 'y' : 'ies'}` : '',
        fromThem ? `${fromThem} to-do${fromThem === 1 ? '' : 's'} from ${other}` : '',
        toThem ? `${toThem} to-do${toThem === 1 ? '' : 's'} to ${other}` : '',
        x.unblocks ? `${x.unblocks} unblock${x.unblocks === 1 ? '' : 's'}` : '',
        x.projects.length ? `projects: ${x.projects.join(' · ')}` : '',
      ].filter(Boolean)
      return `${other}: ${bits.join(' · ')}`
    }).join('; '))
  }
  add('🧱 Blockers', joinItems(own.filter((e) => e.logKind === 'blocked').map((e) => {
    const r = resolutionOf(e, events, to) // as the week ended: a later 🔓 doesn't rewrite a past week
    return `${line(e)} (${r ? (r.at ? `resolved ${dm(r.at)}` : 'resolved') : 'open'})`
  })))
  const goals = cfgOk(p.log).goals.filter((g) => g.per === 'week')
  add('🎯 Goals', goals.map((g) => {
    const evs = g.project ? events.filter((e) => e.project === g.project) : events
    return `${metricLabel(g.metric)} ${metricValue(g.metric, evs, p.login, from, to)} of ${g.target}${g.project ? ` (${g.project})` : ''}`
  }).join(' · '))
  // custom fields (this person's own digest only): numbers summed, scales averaged
  const rows = (ctx.logs && ctx.logs.length ? ctx.logs.filter((e) => inWin(e.at, from, to)).map((e) => e.fields) : own.map((e) => e.fields || {}))
  const tf = timeFieldsOf(p.log)
  const custom = cfgOk(p.log).fields.filter((f) => (f.type === 'number' || f.type === 'scale') && f.key !== 'minutes' && f.key !== 'hours' && f !== tf.min && f !== tf.hour)
  add('📊 My fields', custom.map((f) => {
    const vals = rows.map((r) => (r ? r[f.key] : undefined)).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (!vals.length) return ''
    return f.type === 'scale'
      ? `${f.label} avg ${round1(vals.reduce((a, b) => a + b, 0) / vals.length)} · ${vals.length} entr${vals.length === 1 ? 'y' : 'ies'}`
      : `${f.label} ${round1(vals.reduce((a, b) => a + b, 0))}${f.unit ? ' ' + f.unit : ''}`
  }).filter(Boolean).join(' · '))
  if (claude) {
    const byFor = new Map<string, number>()
    for (const e of events) {
      if (!inWin(e.at, from, to) || !e.for) continue
      if (e.kind === 'claude.log' || e.kind === 'claude.run' || (e.kind === 'todo.done' && same(e.actor, 'claude'))) byFor.set(canon(e.for), (byFor.get(canon(e.for)) || 0) + 1)
    }
    add('🤖 Tasks for', [...byFor.entries()].sort((a, b) => cmpI(a[0], b[0])).map(([k, n]) => `${k} ${n}`).join(' · '))
  } else {
    if (s.claude_for) add('🤖 Claude', `${s.claude_for} task${s.claude_for === 1 ? '' : 's'} for you`)
    const at = weekEvalAt(sunday)
    const icon: Record<string, string> = { help: '🧱', join: '🙋', leave: '🚪', assigned: '☑', 'to-me': '💬' }
    const waiting = (ctx.forYouAt ? ctx.forYouAt(at) : []).filter((i) => icon[i.kind])
    add(`📥 Waiting on you (${dayLabel(addDays(sunday, 7)).split(' ')[0]} 08:00)`,
      joinItems(waiting.map((i) => `${icon[i.kind]} ${i.kind === 'join' ? `Join ${i.project} as ${i.part || 'a member'}` : i.kind === 'leave' ? `Leave ${i.project}` : i.title} (from ${i.from}, ${shortAge(i.since, at)})`)))
  }
  return out
}

/** One person's digest file for `month`: every completed Sun–Sat week (Cairo) that starts in the
 *  month, newest first, regenerated from data (reruns give identical bytes). Frontmatter counters
 *  are month-to-date sums of the weeks written. `forYouAt(at)` is called with the ISO instant the
 *  week is reported (the following Sunday 08:00 Cairo = weekEvalAt) and should return
 *  forYou(p.login, docs, logs, {at: '', ack: []}, at, {asOf: true}) (items as they stood then, so a rerun next
 *  week doesn't rewrite this week's section). `commits` is omitted when unknown.
 *  Works for Claude too (pass CLAUDE_PERSON). */
export function renderDigest(
  p: Person,
  month: string,
  ctx: { events: Ev[]; logs: Entry[]; forYouAt: (weekEnd: string) => ForYouItem[]; commits?: { mine: number; claudeFor: number }; now: string },
): string {
  const weeks = digestWeeks(month, ctx.now)
  const final = weeks.length > 0 && weeks.length === sundaysOf(month).length
  const events = ctx.events || []
  const canon = (l: unknown) => {
    const s = str(l).trim()
    const hit = events.find((e) => same(e.actor, s))
    return hit ? hit.actor : s
  }
  const sums: Record<string, number> = {}
  for (const k of DIGEST_COUNTERS) sums[k] = 0
  for (const w of weeks) {
    const { from, to } = weekWindow(w)
    const s = summarize(events, p.login, from, to)
    for (const k of DIGEST_COUNTERS) sums[k] += s[k] || 0
  }
  let projects: string[] = []
  let worked: string[] = []
  if (weeks.length) {
    const F = weekWindow(weeks[0]).from
    const T = weekWindow(weeks[weeks.length - 1]).to
    projects = uniq(events.filter((e) => same(e.actor, p.login) && worksOn(e) && inWin(e.at, F, T)).map((e) => e.project as string)).sort(cmp)
    worked = pairsFrom(events, F, T, canon).filter((x) => same(x.a, p.login) || same(x.b, p.login)).map((x) => (same(x.a, p.login) ? x.b : x.a)).sort(cmpI)
  }
  const fm = fmBlock([
    ['title', `${p.login} · digest · ${month}`],
    ['type', 'digest'],
    ['scope', 'person'],
    ['person', p.login],
    ['month', month],
    ['weeks', weeks],
    ['updated', weeks.length ? addDays(weeks[weeks.length - 1], 6) : undefined],
    ['final', final],
    ...DIGEST_COUNTERS.map((k): [string, unknown] => [k, sums[k]]),
    ['commits', ctx.commits ? ctx.commits.mine : undefined],
    ['claude_commits_for', ctx.commits ? ctx.commits.claudeFor : undefined],
    ['projects', projects],
    ['worked_with', worked],
  ])
  const body = [`# ${p.login} · ${monthTitle(month)}`, '', SELF_REPORTED, '']
  if (!weeks.length) body.push('No completed weeks yet.', '')
  for (const w of [...weeks].reverse()) body.push(...personWeek(p, w, ctx, canon))
  return fm + '\n\n' + body.join('\n').replace(/\n+$/, '') + '\n'
}

const ofText = (a: number, b: number): string => `${a} of ${b}`
const medText = (h: number | null): string => (h === null ? 'too few to say' : `${h} h`)

/** The team digest file for `month`: collaboration only (asks, replies, the blocker loop,
 *  pairs, team time per project, waits, Claude). No per-person totals side by side. */
export function renderTeamDigest(month: string, ctx: { events: Ev[]; docs: CoreDoc[]; roster: Person[]; now: string }): string {
  const weeks = digestWeeks(month, ctx.now)
  const final = weeks.length > 0 && weeks.length === sundaysOf(month).length
  const events = ctx.events || []
  const docs = [...(ctx.docs || [])].filter(Boolean)
  const roster = ctx.roster || []
  const people = roster.filter((p) => p.status === 'active' && isHuman(p.login)).map((p) => p.login).sort(cmpI)
  const stats = weeks.length ? collabStats(events, docs, roster, weekWindow(weeks[0]).from, weekWindow(weeks[weeks.length - 1]).to) : null
  const t = stats ? stats.team : null
  const fm = fmBlock([
    ['title', `Team · digest · ${month}`],
    ['type', 'digest'],
    ['scope', 'team'],
    ['month', month],
    ['weeks', weeks],
    ['updated', weeks.length ? addDays(weeks[weeks.length - 1], 6) : undefined],
    ['final', final],
    ['people', people],
    ['asks_sent', t ? t.asks_sent : 0],
    ['asks_answered', t ? t.asks_answered : 0],
    ['median_reply_h', t && t.median_reply_h !== null ? t.median_reply_h : undefined],
    ['blockers_raised', t ? t.blockers_raised : 0],
    ['blockers_resolved', t ? t.blockers_resolved : 0],
    ['median_unblock_h', t && t.median_unblock_h !== null ? t.median_unblock_h : undefined],
    ['handoffs_done', t ? t.handoffs_done : 0],
    ['handoffs_open', t ? t.handoffs_open : 0],
    ['shared_projects', t ? t.shared_projects : []],
    ['solo_projects', t ? t.solo_projects.map((s) => s.slug) : []],
    ['pairs_active', stats ? stats.pairs.length : 0],
    ['team_minutes', t ? Object.values(t.team_minutes_by_project).reduce((a, b) => a + b, 0) : 0],
  ])
  const body = [`# Team · ${monthTitle(month)}`, '', SELF_REPORTED, '']
  if (!weeks.length) body.push('No completed weeks yet.', '')
  for (const w of [...weeks].reverse()) {
    const cur = weekWindow(w)
    const prev = weekWindow(addDays(w, -7))
    const s = collabStats(events, docs, roster, cur.from, cur.to)
    const l = collabStats(events, docs, roster, prev.from, prev.to)
    const at = weekEvalAt(w)
    const hint = collabHints(roster, docs, s, at)[0]
    const blk = (x: CollabStats) => ofText(x.team.blockers_resolved, x.team.blockers_raised) + (x.team.median_unblock_h !== null ? ` · ${x.team.median_unblock_h} h` : '')
    body.push(`## Week of ${dayLabel(w)}`, '', `➜ Next: ${hint || 'all clear ✓'}`, '',
      '| Together | This week | Last week |', '|---|---|---|',
      `| Asks answered | ${ofText(s.team.asks_answered, s.team.asks_sent)} | ${ofText(l.team.asks_answered, l.team.asks_sent)} |`,
      `| Median first reply | ${medText(s.team.median_reply_h)} | ${medText(l.team.median_reply_h)} |`,
      `| Blockers resolved (self-reported) | ${blk(s)} | ${blk(l)} |`, '')
    if (s.pairs.length) {
      body.push('| Pair | Replies | To-dos for each other | Unblocks | Projects together |', '|---|---|---|---|---|')
      for (const x of s.pairs) body.push(`| ${x.a} ↔ ${x.b} | ${x.replies} | ${x.a}→${x.b} ${x.todos_ab} · ${x.b}→${x.a} ${x.todos_ba} | ${x.unblocks} | ${x.projects.join(' · ') || '—'} |`)
      body.push('')
    } else body.push('No pairs worked together this week.', '')
    const time = Object.entries(s.team.team_minutes_by_project).sort((a, b) => b[1] - a[1] || cmp(a[0], b[0])).map(([k, v]) => `${k} ${fmtH(v)}`).join(' · ')
    if (time) body.push(`**Time by project (team total, self-reported)** · ${time}`, '')
    const waits = s.waits.filter((x) => !x.since || x.since <= at)
    if (waits.length) body.push(`**Waiting now (${dayLabel(addDays(w, 7)).split(' ')[0]} 08:00)** · ${joinItems(waits.map((x) => `${x.waiter} → ${x.on} · ${x.what} · ${shortAge(x.since, at)}`))}`, '')
    if (s.claude.length) body.push(`**Claude** · ${s.claude.map((c) => `${c.tasks} task${c.tasks === 1 ? '' : 's'} for ${c.for}`).join(' · ')}`, '')
  }
  return fm + '\n\n' + body.join('\n').replace(/\n+$/, '') + '\n'
}
