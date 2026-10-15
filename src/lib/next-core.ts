// One Next for every page (spec §2.3, D11). Pure and zero-import (like people-core): the queue, the project scope, the
// "same item" rule, decisions, and the writers behind the Next buttons (Decide, Done) with byte-exact Undo.
//
// Queue (mine): help → join → to-do matching a status.md `now` line → other to-dos (oldest first) → status-only lines →
// check-in nudge. "Same item" = token Jaccard ≥ .5 (words ≥ 3 characters, or #n), so status.md, project.md and to-do
// lines that say the same thing are ONE item. Project scope: the first queue item of that project, else `next:` (unless
// a to-do already covers it), else the first open milestone. "Make it a to-do" is never offered when a to-do exists.
//
// Writes go through `src.update(path, fn, message)` (the app's Source): only the changed frontmatter lines are rewritten
// (setKeys is a byte-for-byte twin of people-core setTopKeys; a test keeps them equal) and every writer returns an
// undo that restores the exact bytes it replaced.

export type CoreNextKind = 'help' | 'join' | 'decision' | 'todo' | 'milestone' | 'status' | 'checkin'
/** Same shape as contracts NextItem. `id`: 'todo:<path>' · 'post:<path>' · 'ms:<slug>' · 'status:<words>' · 'checkin'. */
export type CoreNextItem = { kind: CoreNextKind; id: string; text: string; project?: string; path?: string; from?: string; since?: string }

type Rec = Record<string, unknown>
export type NextDoc = { path: string; data: Rec; body?: string }
/** The parts of the app Model the resolver reads (structural, so tests can pass plain objects). */
export type NextModel = {
  todos: NextDoc[]
  projects: NextDoc[]
  status?: NextDoc | null
  board?: NextDoc[]
  all?: NextDoc[]
  byPath?: { get(path: string): NextDoc | undefined }
}
export type NextMe = string | { login: string }
/** A For-you item (people-core ForYouItem): `help` and `join`/`leave` become Next items. */
export type ForYouLike = { kind: string; path: string; title?: string; from?: string; since?: string; project?: string; part?: string }
export type NextOpts = {
  /** forYouFor(model, me): exact help/join items (resolved blockers drop out). Without it they are derived here. */
  forYou?: ForYouLike[] | null
  /** login → display name (join item text). */
  nameOf?: (login: string) => string
}
/** The app Source's update(): fn(current text | null) → new text, or null / the same text to skip. true = written. */
export type UpdateSource = { update(path: string, fn: (cur: string | null) => string | null | undefined, message: string): Promise<boolean> }
export type Undo = () => Promise<void>

// ---------------------------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------------------------

const str = (v: unknown): string =>
  v === undefined || v === null ? '' : typeof v === 'string' ? v : v instanceof Date ? v.toISOString().replace(/\.\d{3}Z$/, 'Z') : typeof v === 'object' ? '' : String(v)
const lower = (v: unknown): string => str(v).trim().toLowerCase()
const same = (a: unknown, b: unknown): boolean => lower(a) !== '' && lower(a) === lower(b)
const isObj = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v)
const dataOf = (d: NextDoc | null | undefined): Rec => (d && isObj(d.data) ? d.data : {})
const loginOf = (me: NextMe): string => (typeof me === 'string' ? me : str(me && me.login)).trim()
const cut = (s: string, n: number): string => {
  const cp = Array.from(s)
  return cp.length > n ? cp.slice(0, n).join('').trim() : s
}
const strList = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map((x) => (isObj(x) ? '' : str(x).trim())).filter(Boolean)
  if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean)
  return []
}
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const isoNow = (now?: unknown): string => {
  const t = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : now ? Date.parse(str(now)) : Date.now()
  return new Date(Number.isFinite(t) ? t : Date.now()).toISOString().replace(/\.\d{3}Z$/, 'Z')
}
const createdOf = (d: NextDoc): string => str(dataOf(d).created).trim()
export const todoTitle = (t: NextDoc): string => {
  const x = str(dataOf(t).title).trim()
  if (x) return x
  for (const l of str(t.body).split(/\r?\n/)) {
    const s = l.replace(/^[\s#>*-]+/, '').trim()
    if (s) return cut(s, 120)
  }
  return (t.path.split('/').pop() || '').replace(/\.md$/i, '')
}
export const isOpenTodo = (t: NextDoc): boolean => lower(dataOf(t).status) !== 'done'
const docAt = (m: NextModel, path: string): NextDoc | undefined => {
  if (!path) return undefined
  const hit = m.byPath && typeof m.byPath.get === 'function' ? m.byPath.get(path) : undefined
  return hit || (m.all || []).find((d) => d.path === path) || (m.projects || []).find((d) => d.path === path)
}
/** A to-do's `link:` as a repo path (no anchor, no leading ./ or /). */
const linkPath = (v: unknown): string => str(v).trim().replace(/#.*$/, '').replace(/^\.?\/+/, '')

// ---------------------------------------------------------------------------------------------------------------
// same item
// ---------------------------------------------------------------------------------------------------------------

/** The words that count: lower case, letters/digits/# only, ≥ 3 characters or `#n`, each once. */
export function wordsOf(s: unknown): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of str(s).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}#\s]+/gu, ' ').split(/\s+/)) {
    if (!w || seen.has(w)) continue
    if (Array.from(w).length >= 3 || /^#\d+$/.test(w)) {
      seen.add(w)
      out.push(w)
    }
  }
  return out
}
/** Token Jaccard of two lines (0 when either has no words). */
export function jaccard(a: unknown, b: unknown): number {
  const A = wordsOf(a)
  const B = new Set(wordsOf(b))
  if (!A.length || !B.size) return 0
  const n = A.filter((w) => B.has(w)).length
  return n / (A.length + B.size - n)
}
/** status.md / project.md / to-do lines that say the same thing are ONE item. */
export const sameItem = (a: unknown, b: unknown): boolean => jaccard(a, b) >= 0.5
/** Share of the SHORTER line's words that the other line has (a milestone "Pick a direction" inside a longer to-do). */
function overlap(a: unknown, b: unknown): { share: number; n: number } {
  const A = wordsOf(a)
  const B = new Set(wordsOf(b))
  if (!A.length || !B.size) return { share: 0, n: 0 }
  const n = A.filter((w) => B.has(w)).length
  return { share: n / Math.min(A.length, B.size), n }
}

// ---------------------------------------------------------------------------------------------------------------
// projects, to-dos, decisions
// ---------------------------------------------------------------------------------------------------------------

export const projectSlugOf = (d: NextDoc): string =>
  (d.path.match(/^projects\/([^/]+)\/project\.md$/i) || d.path.match(/^projects\/([^/]+)\.md$/i) || [])[1] || ''
const projectBySlug = (m: NextModel, slug: string) => (m.projects || []).find((p) => projectSlugOf(p) === slug)

/** The project a to-do belongs to: its `project:` key, else the project whose `hub` is the to-do's `link`, else one
 *  whose `docs` list it, else the folder the link sits in (projects/<slug>/…). undefined = none. */
export function projectOfTodo(todo: NextDoc, m: NextModel): string | undefined {
  const own = str(dataOf(todo).project).trim()
  if (own) return own
  const link = linkPath(dataOf(todo).link)
  if (!link) return undefined
  const ps = m.projects || []
  const hub = ps.find((p) => linkPath(dataOf(p).hub) === link)
  if (hub) return projectSlugOf(hub) || undefined
  const listed = ps.find((p) => strList(dataOf(p).docs).some((d) => linkPath(d) === link))
  if (listed) return projectSlugOf(listed) || undefined
  return link.match(/^projects\/([^/]+)\//)?.[1]
}

/** The project a free line is about: one whose `next:` or first open milestone says the same thing. */
export function projectOfText(m: NextModel, text: string): string | undefined {
  for (const p of m.projects || []) {
    const d = dataOf(p)
    if (sameItem(d.next, text)) return projectSlugOf(p) || undefined
    const first = milestonesOf(p).find((x) => !x.done)
    if (first && sameItem(first.text, text)) return projectSlugOf(p) || undefined
  }
  return undefined
}

const hasOptions = (d: NextDoc | undefined) => Array.isArray(dataOf(d).options) && (dataOf(d).options as unknown[]).length > 0
/** A decision = a to-do with `kind: decision`, or a Pick/Choose/Decide to-do that links a doc with `options:`. */
export function isDecision(todo: NextDoc, m: NextModel): boolean {
  if (lower(dataOf(todo).kind) === 'decision') return true
  return /^\s*(pick|choose|decide)\b/i.test(todoTitle(todo)) && hasOptions(docAt(m, linkPath(dataOf(todo).link)))
}
/** The doc a decision is about (its `link:` when that doc has `options:`), else undefined. */
export function decisionDoc(todo: NextDoc, m: NextModel): NextDoc | undefined {
  const d = docAt(m, linkPath(dataOf(todo).link))
  return hasOptions(d) ? d : undefined
}

export type MilestoneRow = { index: number; text: string; date: string; done: boolean }
const truthy = (v: unknown) => v === true || (typeof v === 'string' && /^(?:true|yes|y|x|done)$/i.test(v.trim()))
export function milestonesOf(p: NextDoc | undefined): MilestoneRow[] {
  const raw = dataOf(p).milestones
  const out: MilestoneRow[] = []
  ;(Array.isArray(raw) ? raw : []).forEach((x, index) => {
    const o: Rec = isObj(x) ? x : { text: x }
    const text = str(o.text).trim()
    if (text) out.push({ index, text, date: str(o.date).trim().slice(0, 10), done: truthy(o.done) })
  })
  return out
}
/** The open milestone a to-do title is about: same item, else the best word overlap (≥ 2 shared words, ≥ 60% of the
 *  shorter line). Falls back to the first open milestone when the project's `next:` is that to-do. null = none. */
export function matchMilestone(p: NextDoc | undefined, title: string): MilestoneRow | null {
  const open = milestonesOf(p).filter((x) => !x.done)
  if (!open.length || !wordsOf(title).length) return null
  const same1 = open.find((x) => sameItem(x.text, title))
  if (same1) return same1
  let best: MilestoneRow | null = null
  let score = 0
  for (const x of open) {
    const o = overlap(x.text, title)
    if (o.n >= 2 && o.share >= 0.6 && o.share > score) {
      best = x
      score = o.share
    }
  }
  if (best) return best
  return sameItem(dataOf(p).next, title) ? open[0] : null
}

const todoItem = (t: NextDoc, m: NextModel): CoreNextItem =>
  clean({
    kind: isDecision(t, m) ? 'decision' : 'todo',
    id: 'todo:' + t.path,
    text: todoTitle(t),
    project: projectOfTodo(t, m),
    path: t.path,
    from: str(dataOf(t).by).trim() || undefined,
    since: createdOf(t) || undefined,
  })
function clean(it: CoreNextItem): CoreNextItem {
  for (const k of Object.keys(it) as (keyof CoreNextItem)[]) if (it[k] === undefined || it[k] === '') delete it[k]
  return it
}
const byAge = (a: NextDoc, b: NextDoc) => cmp(createdOf(a), createdOf(b)) || cmp(a.path, b.path)

// ---------------------------------------------------------------------------------------------------------------
// status.md
// ---------------------------------------------------------------------------------------------------------------

/** Whose list status.md `now` is: its `owner:` (or `person:`), else the workspace's first person = the owner of the
 *  earliest-started projects (most projects that first day; ties → the first project file). Teammates who join later
 *  start their projects later, so creating projects never moves status ownership. Teammates never get someone else's
 *  status lines as their Next. */
export function statusOwner(m: NextModel): string {
  const d = dataOf(m.status)
  const own = str(d.owner).trim() || str(d.person).trim()
  if (own) return own
  const dayOf = (p: NextDoc) => {
    const v = str(dataOf(p).started || dataOf(p).created).trim().slice(0, 10)
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '9999-99-99'
  }
  const owned = (m.projects || []).filter((p) => lower(dataOf(p).owner))
  const firstDay = owned.map(dayOf).sort()[0]
  const count = new Map<string, number>()
  const first = new Map<string, number>()
  ;[...owned.filter((p) => dayOf(p) === firstDay)].sort((a, b) => cmp(a.path, b.path)).forEach((p, i) => {
    const o = lower(dataOf(p).owner)
    if (!o) return
    count.set(o, (count.get(o) || 0) + 1)
    if (!first.has(o)) first.set(o, i)
  })
  let best = ''
  for (const [o, n] of count) if (!best || n > count.get(best)! || (n === count.get(best)! && first.get(o)! < first.get(best)!)) best = o
  return best
}
/** status.md `now` lines (trimmed, deduped). */
export function nowLines(m: NextModel): string[] {
  const out: string[] = []
  for (const l of strList(dataOf(m.status).now)) if (!out.includes(l)) out.push(l)
  return out
}
const statusId = (line: string) => 'status:' + (wordsOf(line).join('-').slice(0, 80) || 'line')

// ---------------------------------------------------------------------------------------------------------------
// the queue
// ---------------------------------------------------------------------------------------------------------------

/** Everything waiting on me, in Next order (§2.3). Never empty: the last resort is the check-in nudge. Help and join
 *  items dated after `now` don't count yet (same rule as For you); the order itself does not depend on the clock. */
export function nextQueue(m: NextModel, me: NextMe, now?: unknown, opts: NextOpts = {}): CoreNextItem[] {
  const login = loginOf(me)
  const N = isoNow(now)
  const notYet = (since: unknown) => !!str(since).trim() && str(since).trim() > N
  const todos = (m.todos || []).filter((t) => t && typeof t.path === 'string')
  const nameOf = opts.nameOf || ((l: string) => l)
  const out: CoreNextItem[] = []
  const used = new Set<string>()
  const todoByPath = new Map(todos.map((t) => [t.path, t]))

  // 1 · help: someone blocked asked me
  const fy = Array.isArray(opts.forYou) ? opts.forYou : null
  const helps = fy
    ? fy.filter((x) => x && x.kind === 'help').map((x) => todoByPath.get(x.path)).filter((t): t is NextDoc => !!t && isOpenTodo(t))
    : todos.filter((t) => isOpenTodo(t) && same(dataOf(t).owner, login) && str(dataOf(t).blocker).trim() && !same(dataOf(t).by, login) && str(dataOf(t).by).trim() && !notYet(createdOf(t)))
  for (const t of [...helps].sort(byAge)) {
    if (used.has(t.path)) continue
    used.add(t.path)
    out.push(clean({ ...todoItem(t, m), kind: 'help' }))
  }

  // 2 · join / leave requests for projects I own
  const projOwner = (slug: string) => str(dataOf(projectBySlug(m, slug)).owner)
  const joins: { path: string; from: string; project: string; since: string; leave: boolean; part: string }[] = []
  if (fy) {
    for (const x of fy) if (x && (x.kind === 'join' || x.kind === 'leave'))
      joins.push({ path: x.path, from: str(x.from), project: str(x.project), since: str(x.since), leave: x.kind === 'leave', part: str(x.part) })
  } else {
    for (const p of m.board || []) {
      const d = dataOf(p)
      const req = lower(d.request)
      if (lower(d.status) === 'done' || !same(d.to, login) || (req !== 'join' && req !== 'leave')) continue
      const slug = str(d.project).trim()
      if (!slug || !same(projOwner(slug), login) || notYet(d.created)) continue
      joins.push({ path: p.path, from: str(d.author).trim(), project: slug, since: str(d.created).trim(), leave: req === 'leave', part: str(d.part).trim() })
    }
  }
  for (const j of joins.sort((a, b) => cmp(a.since, b.since) || cmp(a.path, b.path))) {
    const title = str(dataOf(projectBySlug(m, j.project)).title).trim() || j.project
    const who = nameOf(j.from) || j.from || 'Someone'
    out.push(clean({
      kind: 'join', id: 'post:' + j.path, path: j.path, project: j.project || undefined, from: j.from || undefined, since: j.since || undefined,
      text: j.leave ? `${who} asks to leave ${title}` : `${who} asks to join ${title}${j.part ? ' as ' + j.part : ''}`,
    }))
  }

  // 3 + 4 · my open to-dos: the ones status.md `now` names first, then the rest, oldest first
  const mine = todos.filter((t) => isOpenTodo(t) && same(dataOf(t).owner, login) && !used.has(t.path)).sort(byAge)
  const doneTitles = todos.filter((t) => !isOpenTodo(t)).map(todoTitle)
  const lines = same(statusOwner(m), login) ? nowLines(m).filter((l) => !doneTitles.some((t) => sameItem(t, l))) : []
  const pri = mine.filter((t) => lines.some((l) => sameItem(todoTitle(t), l)))
  const rest = mine.filter((t) => !pri.includes(t))
  for (const t of [...pri, ...rest]) out.push(todoItem(t, m))

  // 5 · status-only lines (no to-do says the same thing)
  const openTitles = todos.filter(isOpenTodo).map(todoTitle)
  const since = str(dataOf(m.status).updated).trim()
  for (const l of lines) {
    if (openTitles.some((t) => sameItem(t, l))) continue
    out.push(clean({ kind: 'status', id: statusId(l), text: l, project: projectOfText(m, l), path: m.status?.path, since: since || undefined }))
  }

  // 6 · nothing waiting: the check-in nudge
  if (!out.length) out.push({ kind: 'checkin', id: 'checkin', text: 'Log one thing you did today' })
  return out
}

/** A project's one Next: my first queue item for it, else its `next:` (unless a to-do already covers it), else the
 *  first open milestone no to-do covers. null = nothing to offer. */
export function nextFor(m: NextModel, me: NextMe, slug: string, now?: unknown, opts: NextOpts = {}): CoreNextItem | null {
  const queue = nextQueue(m, me, now, opts)
  const hit = queue.find((it) => it.project === slug && it.kind !== 'checkin')
  if (hit) return hit
  const p = projectBySlug(m, slug)
  if (!p) return null
  const d = dataOf(p)
  const todos = (m.todos || []).filter((t) => t && typeof t.path === 'string')
  const login = loginOf(me)
  const since = str(d.updated).trim() || undefined
  const nx = str(d.next).trim()
  // `next:` names one of my open to-dos that isn't filed under this project: that to-do IS the project's Next
  if (nx) {
    const mineSame = queue.find((it) => (it.kind === 'todo' || it.kind === 'decision') && sameItem(it.text, nx))
    if (mineSame) return mineSame
  }
  const covered = (text: string) => todos.some((t) => sameItem(todoTitle(t), text))
  if (nx && !covered(nx)) return clean({ kind: 'milestone', id: 'ms:' + slug, text: nx, project: slug, path: p.path, since })
  for (const ms of milestonesOf(p)) {
    if (ms.done || covered(ms.text)) continue
    return clean({ kind: 'milestone', id: 'ms:' + slug, text: ms.text, project: slug, path: p.path, since })
  }
  void login
  return null
}

// ---------------------------------------------------------------------------------------------------------------
// frontmatter edits (byte-preserving)
// ---------------------------------------------------------------------------------------------------------------

const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)
/** Same quoting rule as people-core yamlValue (md.mjs + YAML 1.1/1.2 lookalikes). */
function yamlValue(v: unknown): string {
  if (typeof v === 'boolean') return String(v)
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : JSON.stringify(String(v))
  const s = str(v)
  const plain = /^[\w./+-][\w ./@+:-]*$/.test(s) && !/:\s/.test(s) && !/:$/.test(s) && !/\s$/.test(s) && !/^-(\s|$)/.test(s) &&
    !s.includes(',') && !/^(true|false|null|yes|no|on|off|y|n|~)$/i.test(s) &&
    !/^[-+]?(\.\d+|\d+(\.\d*)?)([eE][-+]?\d+)?$/.test(s) && !/^0[xo]/i.test(s) && !/^[-+]?\.(inf|nan)$/i.test(s)
  return plain ? s : JSON.stringify(s)
}
/** ',' → ' · ', '|' → '·', one line, ≤ max characters (people-core cleanItem). */
export function cleanLine(s: unknown, max = 80): string {
  const t = str(s).replace(/\r\n|\r|\n/g, ' ').replace(/\s*,\s*/g, ' · ').replace(/\|/g, '·').replace(/\s+/g, ' ').trim()
  return cut(t, max).trim()
}

type KeyPatch = Record<string, string | number | boolean | string[] | null | undefined>
/** Twin of people-core setTopKeys: rewrite only the named top-level frontmatter keys (with their continuation lines);
 *  null/undefined removes a key; new keys go just before the closing `---`; every other byte stays (CRLF kept). */
export function setKeys(text: string, patch: KeyPatch): string {
  const src = str(text)
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  const keys = Object.keys(patch || {}).filter((k) => /^[A-Za-z0-9_][\w.-]*$/.test(k))
  const render = (k: string, v: unknown): string[] => {
    if (Array.isArray(v)) {
      const items = v.map((x) => cleanLine(str(x), 200)).filter(Boolean)
      return items.length ? [`${k}:`, ...items.map((x) => `  - ${yamlValue(x)}`)] : [`${k}: []`]
    }
    return [`${k}: ${yamlValue(v)}`]
  }
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
    const mm = content(lines[i]).match(/^([A-Za-z0-9_][\w.-]*)[ \t]*:(?:[ \t]|$)/)
    return mm ? mm[1] : null
  }
  const isCont = (i: number, emptyValue: boolean): boolean => {
    const c = content(lines[i])
    return /^[ \t]+\S/.test(c) || (emptyValue && /^-( |$)/.test(c))
  }
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
    if (done.has(b.key)) continue
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

/** Top-level scalar values of a frontmatter block (quotes removed). */
export function topScalars(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const mm = stripBom(str(text)).match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/)
  if (!mm) return out
  for (const line of mm[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_][\w.-]*)[ \t]*:[ \t]*(.*)$/)
    if (!kv) continue
    let v = kv[2].trim()
    if (/^".*"$/.test(v)) {
      try { v = String(JSON.parse(v)) } catch { v = v.slice(1, -1) }
    } else if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'")
    if (!(kv[1] in out)) out[kv[1]] = v
  }
  return out
}

/** A YAML scalar's text. A quoted scalar is read first (a " #" inside the quotes is text, "Pick #1 or #2"); only an
 *  unquoted value loses a trailing " # comment". */
const unquote = (v: string): string => {
  const s = v.trim()
  const dq = s.match(/^"((?:[^"\\]|\\.)*)"(?:[ \t]+#.*)?$/)
  if (dq) {
    try { return String(JSON.parse(`"${dq[1]}"`)) } catch { return dq[1] }
  }
  const sq = s.match(/^'((?:[^']|'')*)'(?:[ \t]+#.*)?$/)
  if (sq) return sq[1].replace(/''/g, "'")
  return s.replace(/\s+#.*$/, '')
}
const normText = (s: string) => str(s).replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * Tick one milestone in a project.md: the item of the `milestones:` block list whose text is `milestone` (or the
 * index-th item) gets `done: true` and `date: <date>`. Only that item's lines change; every other byte stays (CRLF
 * kept). Already done → the text comes back unchanged (idempotent). Not found → unchanged.
 */
export function tickMilestone(text: string, milestone: string | number, date: string): string {
  const src = str(text)
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  const lines: string[] = [...(src.match(/[^\n]*\n|[^\n]+$/g) || [])]
  const content = (l: string) => l.replace(/\r?\n$/, '')
  const endOf = (l: string) => (/\r\n$/.test(l) ? '\r\n' : /\n$/.test(l) ? '\n' : eol)
  if (!lines.length || !/^---[ \t]*$/.test(stripBom(content(lines[0])))) return src
  let close = -1
  for (let i = 1; i < lines.length; i++) if (/^---[ \t]*$/.test(content(lines[i]))) { close = i; break }
  if (close < 0) return src
  const start = lines.findIndex((l, i) => i > 0 && i < close && /^milestones[ \t]*:[ \t]*(#.*)?$/.test(content(l)))
  if (start < 0) return src
  // the block: lines after `milestones:` that are indented or start with "- "
  let end = start + 1
  while (end < close) {
    const c = content(lines[end])
    if (c.trim() === '' || /^[ \t]+/.test(c) || /^-( |$)/.test(c)) end++
    else break
  }
  while (end > start + 1 && content(lines[end - 1]).trim() === '') end--
  // items
  type Item = { from: number; to: number; dash: number }
  const items: Item[] = []
  let dashCol = -1
  for (let i = start + 1; i < end; i++) {
    const mm = content(lines[i]).match(/^([ \t]*)-( |$)/)
    if (!mm) continue
    if (dashCol < 0) dashCol = mm[1].length
    if (mm[1].length !== dashCol) continue
    if (items.length) items[items.length - 1].to = i
    items.push({ from: i, to: end, dash: dashCol })
  }
  if (!items.length) return src
  const textOf = (it: Item): string => {
    const keyPad = ' '.repeat(it.dash + 2)
    // `text: value`, or a block scalar (`text: >-` + deeper lines; whitespace is normalised when comparing)
    const valueAt = (i: number, v: string): string => {
      if (!/^[>|][+-]?\d*\s*(#.*)?$/.test(v.trim())) return unquote(v)
      const parts: string[] = []
      for (let k = i + 1; k < it.to && content(lines[k]).startsWith(keyPad + ' '); k++) parts.push(content(lines[k]).trim())
      return parts.join(' ')
    }
    const first = content(lines[it.from]).slice(it.dash + 2)
    const kv = first.match(/^text[ \t]*:[ \t]*(.*)$/)
    if (kv) return valueAt(it.from, kv[1])
    const flow = first.match(/^\{(.*)\}\s*$/)
    if (flow) {
      const t = flow[1].match(/(?:^|,)\s*text\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,]*)/)
      return t ? unquote(t[1]) : ''
    }
    if (/^[A-Za-z0-9_][\w.-]*[ \t]*:/.test(first)) {
      for (let i = it.from + 1; i < it.to; i++) {
        const c = content(lines[i]).match(/^[ \t]+text[ \t]*:[ \t]*(.*)$/)
        if (c && content(lines[i]).startsWith(keyPad + 'text')) return valueAt(i, c[1])
      }
      return ''
    }
    return unquote(first)
  }
  const target = typeof milestone === 'number'
    ? items[milestone]
    : items.find((it) => normText(textOf(it)) === normText(milestone))
  if (!target) return src
  const pad = ' '.repeat(target.dash + 2)
  const first = content(lines[target.from]).slice(target.dash + 2)
  const isMap = /^[A-Za-z0-9_][\w.-]*[ \t]*:/.test(first)
  const dateLine = `date: ${yamlValue(date)}`
  if (!isMap) {
    // a plain "- text" or "- {text: …}" item → rewrite just this item in block form
    const flowDone = /\bdone\s*:\s*(true|yes|y|x|done)\b/i.test(first)
    if (flowDone) return src
    const t = textOf(target)
    if (!t) return src
    const e = endOf(lines[target.to - 1])
    const indent = ' '.repeat(target.dash)
    const rebuilt = [`${indent}- text: ${yamlValue(t)}`, `${pad}${dateLine}`, `${pad}done: true`].map((l) => l + e)
    return [...lines.slice(0, target.from), ...rebuilt, ...lines.slice(target.to)].join('')
  }
  // block map item: replace `done:` and `date:` at the item's key column, else add them
  const keyLine = (i: number, key: string) => {
    const c = content(lines[i])
    const own = i === target.from ? c.slice(target.dash + 2) : c.startsWith(pad) && !/^[ \t]/.test(c.slice(pad.length)) ? c.slice(pad.length) : null
    return own !== null && new RegExp(`^${key}[ \\t]*:`).test(own)
  }
  let doneAt = -1
  let dateAt = -1
  let textEnd = target.from + 1
  for (let i = target.from; i < target.to; i++) {
    if (keyLine(i, 'done')) doneAt = i
    if (keyLine(i, 'date')) dateAt = i
  }
  if (doneAt >= 0) {
    const v = content(lines[doneAt]).replace(/^.*?done[ \t]*:[ \t]*/, '').replace(/\s+#.*$/, '').trim()
    if (truthy(v)) return src
  }
  // the text key's own block (its continuation lines are indented deeper than the item's keys)
  for (let i = target.from; i < target.to; i++) {
    if (!keyLine(i, 'text')) continue
    textEnd = i + 1
    while (textEnd < target.to && content(lines[textEnd]).startsWith(pad + ' ')) textEnd++
    break
  }
  const out = lines.slice()
  const e = endOf(lines[target.to - 1])
  const lineAt = (i: number, body: string) => {
    const c = content(lines[i])
    const prefix = i === target.from ? c.slice(0, target.dash + 2) : pad
    return prefix + body + endOf(lines[i])
  }
  if (doneAt >= 0) out[doneAt] = lineAt(doneAt, 'done: true')
  if (dateAt >= 0) out[dateAt] = lineAt(dateAt, dateLine)
  const inserts: { at: number; line: string }[] = []
  // same spot (a one-line item): done is spliced first so date lands before it
  if (doneAt < 0) inserts.push({ at: target.to, line: pad + 'done: true' + e })
  if (dateAt < 0) inserts.push({ at: textEnd, line: pad + dateLine + e })
  // the last item's last line may have no line break: give it one before appending after it
  for (const ins of inserts.sort((a, b) => b.at - a.at)) {
    if (ins.at > 0 && !/\n$/.test(out[ins.at - 1])) out[ins.at - 1] += e
    out.splice(ins.at, 0, ins.line)
  }
  return out.join('')
}

// ---------------------------------------------------------------------------------------------------------------
// writers behind the Next buttons
// ---------------------------------------------------------------------------------------------------------------

const label = (s: string) => cut(str(s).replace(/\s+/g, ' ').trim(), 50)

/** Restore exact bytes when the file still holds what we wrote; otherwise apply `fallback` (or leave it). */
function restorer(src: UpdateSource, path: string, before: string | null, after: string | null, message: string, fallback?: (cur: string) => string): Undo {
  return async () => {
    if (after === null || before === null) return
    await src.update(path, (cur) => (cur === null ? null : cur === after ? before : fallback ? fallback(cur) : cur), message)
  }
}
const revertDone = (before: string) => (cur: string) => {
  const was = topScalars(before)
  return setKeys(cur, {
    status: was.status || 'todo',
    done_at: was.done_at || null,
    done_by: was.done_by || null,
    choice: was.choice || null,
  })
}

/** Done on a to-do (the Next `todo` button, a tick in a list): status done + done_at/done_by. Already done → nothing.
 *  Returns the undo (restores the exact bytes). */
export async function completeItem(src: UpdateSource, me: NextMe, _m: NextModel, item: { path?: string; text?: string }, opts: { now?: unknown } = {}): Promise<Undo> {
  const path = str(item && item.path)
  if (!/^todos\/[^/]+\.md$/.test(path)) throw new Error('Only a to-do can be ticked here')
  const login = loginOf(me)
  const N = isoNow(opts.now)
  let before: string | null = null
  let after: string | null = null
  const written = await src.update(path, (cur) => {
    before = cur
    after = null
    if (cur === null || lower(topScalars(cur).status) === 'done') return cur
    after = setKeys(cur, { status: 'done', done_at: N, done_by: login })
    return after
  }, `todo: done · ${label(item.text || topScalars(before || '').title || path)}`)
  if (!written) return async () => {}
  return restorer(src, path, before, after, `todo: reopen · ${label(item.text || path)}`, revertDone(before!))
}

export type DecideResult = { undo: Undo; written: boolean; ticked: string | null; project?: string }
/**
 * Decide on a decision to-do: the to-do gets status done + done_at/done_by + `choice:`; ONLY when I own its project,
 * the matching milestone gets `done: true` + `date:` (tickMilestone). Nothing else changes. `day` = my local date
 * (YYYY-MM-DD) for the milestone. Returns the undo (restores both files' exact bytes).
 */
export async function decide(src: UpdateSource, me: NextMe, m: NextModel, todoPath: string, choice: string, opts: { now?: unknown; day?: string } = {}): Promise<DecideResult> {
  const login = loginOf(me)
  const N = isoNow(opts.now)
  const day = /^\d{4}-\d{2}-\d{2}$/.test(str(opts.day)) ? str(opts.day) : N.slice(0, 10)
  const c = cleanLine(choice, 120)
  if (!c) throw new Error('Pick an option first')
  if (!/^todos\/[^/]+\.md$/.test(todoPath)) throw new Error('Not a to-do')
  const todo = docAt(m, todoPath) || (m.todos || []).find((t) => t.path === todoPath)
  const title = todo ? todoTitle(todo) : ''
  let tBefore: string | null = null
  let tAfter: string | null = null
  const written = await src.update(todoPath, (cur) => {
    tBefore = cur
    tAfter = null
    if (cur === null || lower(topScalars(cur).status) === 'done') return cur
    tAfter = setKeys(cur, { status: 'done', done_at: N, done_by: login, choice: c })
    return tAfter
  }, `todo: done · ${label(title || todoPath)} → ${label(c)}`)
  if (!written) return { undo: async () => {}, written: false, ticked: null }

  const slug = todo ? projectOfTodo(todo, m) : undefined
  const proj = slug ? projectBySlug(m, slug) : undefined
  let ticked: string | null = null
  let pBefore: string | null = null
  let pAfter: string | null = null
  if (proj && same(dataOf(proj).owner, login)) {
    const ms = matchMilestone(proj, title)
    if (ms) {
      try {
        const ok = await src.update(proj.path, (cur) => {
          pBefore = cur
          pAfter = null
          if (cur === null) return null
          // the file I edit must still be owned by me (it may have changed hands since the model loaded)
          if (!same(topScalars(cur).owner, login)) return null
          const next = tickMilestone(cur, ms.text, day)
          if (next !== cur) pAfter = next
          return next
        }, `project: milestone done · ${label(ms.text)}`)
        if (ok && pAfter !== null) ticked = ms.text
      } catch {
        // the decision itself is saved; a milestone that could not be ticked is not a reason to fail it
        pAfter = null
      }
    }
  }
  const undoTodo = restorer(src, todoPath, tBefore, tAfter, `todo: reopen · ${label(title || todoPath)}`, revertDone(tBefore!))
  const undoProj = ticked ? restorer(src, proj!.path, pBefore, pAfter, `project: milestone reopened · ${label(ticked)}`) : async () => {}
  return {
    written: true,
    ticked,
    project: slug,
    undo: async () => {
      await undoProj()
      await undoTodo()
    },
  }
}

/** The label a decision's choice gets from the options list: "#1 Support audits", "#1 + #2", or the person's words. */
export function choiceLabel(options: unknown, pick: number | 'both' | string): string {
  const list = Array.isArray(options) ? options : []
  const nameAt = (i: number) => {
    const o = list[i]
    const n = isObj(o) ? str(o.short).trim() || str(o.name).trim() || str(o.title).trim() : str(o).trim()
    return n ? `#${i + 1} ${n}` : `#${i + 1}`
  }
  if (pick === 'both') return list.length >= 2 ? cleanLine(`#1 + #2: ${nameAt(0).replace(/^#1 /, '')} + ${nameAt(1).replace(/^#2 /, '')}`, 120) : ''
  if (typeof pick === 'number') return pick >= 0 && pick < list.length ? nameAt(pick) : ''
  return cleanLine(pick, 120)
}
