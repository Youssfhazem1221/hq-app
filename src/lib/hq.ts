// Turns the repo's markdown files into the app's model, and writes new items back.
import { openTasks, parse, serialize, title, type Doc } from './md'
import {
  CLAUDE_LOG_CONFIG, DIGEST_RE, LIMITS, LOG_RE, cleanItem, deriveEvents, isProfilePath, knownLogins, parseLog, rosterOf, setTopKeys,
  type Entry, type Ev, type Person,
} from './people-core'
import type { FileEntry, Me, Source } from './source'
import { makeId, nowIso, slug } from './util'

export type Task = { path: string; doc: string; text: string; heading: string }

export type Model = {
  all: Doc[]
  byPath: Map<string, Doc>
  knowledge: Doc[]
  status?: Doc
  investigations: Doc[]
  linkedin?: Doc
  board: Doc[]
  replies: Map<string, Doc[]>
  todos: Doc[]
  /** Profiles only: people/<slug>.md (depth 1). Log and digest files under people/<slug>/ are not people. */
  people: Doc[]
  requests: Doc[]
  answers: Map<string, Doc>
  tasks: Task[]
  projects: Doc[]
  /** Other .md files inside each project folder (projects/<slug>/…), by slug. */
  projectFiles: Map<string, Doc[]>
  /** The profiles, parsed (name, pronouns, timezone, log settings…), by name. Alumni included (status 'alumni'). */
  roster: Person[]
  /** Every human login HQ knows: profiles ∪ project owners/members ∪ to-do owner/by ∪ post author/to (no bots). */
  knownLogins: string[]
  /** Log month files (people/<slug>/log/YYYY-MM.md) by folder slug, incl. 'claude'. Newest month first. */
  logs: Map<string, Doc[]>
  /** Digest month files (people/<slug>/digest/YYYY-MM.md) by folder slug, incl. '_team'. Newest month first. */
  digests: Map<string, Doc[]>
  /** Parsed log rows by folder slug (with that person's log settings), oldest month first. */
  logEntries: Map<string, Entry[]>
  /** Everything that happened, derived from the files (nothing stored), oldest first. AI question text is hidden
   *  ('asked AI'); people.ts personCtx() shows it to its own author. */
  events: Ev[]
}

// Projects: canonical projects/<slug>/project.md; a legacy flat projects/<slug>.md still works.
const PROJECT_FILE = /^projects\/([^/]+)\/project\.md$/i
const LEGACY_PROJECT = /^projects\/([^/]+)\.md$/i
export const isProjectFile = (p: string) => PROJECT_FILE.test(p) || LEGACY_PROJECT.test(p)
/** Project a path belongs to: anything under projects/<slug>/, or a legacy projects/<slug>.md. */
export const projectOfPath = (p: string) => (p.match(/^projects\/([^/]+)\//) || p.match(LEGACY_PROJECT))?.[1]
export const projectSlug = (d: Doc) => projectOfPath(d.path) || baseName(d.path)
/** A project's folder (legacy flat projects have none). */
export const projectFolder = (d: Doc) => (PROJECT_FILE.test(d.path) ? d.path.replace(/\/project\.md$/i, '') : null)
/** The person a path belongs to (the folder slug): people/<slug>.md and people/<slug>/log|digest/YYYY-MM.md.
 *  '_team' for the team digest. undefined for anything else. */
export const personOfPath = (p: string) => {
  if (isProfilePath(p)) return p.slice('people/'.length, -'.md'.length)
  return (p.match(LOG_RE) || p.match(DIGEST_RE))?.[1]
}
/** App route for a repo path: a project file opens the project page, a profile, log or digest the person
 *  (the team digest opens /people/_team), other .md files the doc view. */
export const routeFor = (p: string) => {
  if (isProjectFile(p)) return '/projects/' + projectOfPath(p)
  const person = personOfPath(p)
  if (person) return '/people/' + person
  return p.toLowerCase().endsWith('.md') ? '/docs/' + p : '/docs'
}
const STATUS_ORDER = ['active', 'waiting', 'parked', 'done']
const statusRank = (d: Doc) => {
  const i = STATUS_ORDER.indexOf(String(d.data.status || ''))
  return i === -1 ? STATUS_ORDER.length : i
}

const newestFirst = (a: Doc, b: Doc) => String(b.data.created || '').localeCompare(String(a.data.created || ''))
const baseName = (p: string) => p.split('/').pop()!.replace(/\.md$/i, '')

/** Files matching a people regex, grouped by its first capture (the folder slug), newest month first. */
function byFolder(all: Doc[], re: RegExp) {
  const out = new Map<string, Doc[]>()
  for (const d of [...all].sort((a, b) => b.path.localeCompare(a.path))) {
    const s = d.path.match(re)?.[1]
    if (s) out.set(s, [...(out.get(s) || []), d])
  }
  return out
}

export function buildModel(files: FileEntry[]): Model {
  const all = files.map((f) => parse(f.path, f.text))
  const byPath = new Map(all.map((d) => [d.path, d]))
  const under = (prefix: string) => all.filter((d) => d.path.startsWith(prefix))

  // People: profiles are depth 1; logs and digests are parsed from the raw text (the frontmatter holds month + tz).
  const text = new Map(files.map((f) => [f.path, f.text]))
  const roster = rosterOf(all)
  const logs = byFolder(all, LOG_RE)
  const digests = byFolder(all, DIGEST_RE)
  const logEntries = new Map<string, Entry[]>()
  for (const [s, months] of logs) {
    const cfg = s === 'claude' ? CLAUDE_LOG_CONFIG : roster.find((p) => p.slug === s)?.log
    logEntries.set(s, [...months].reverse().flatMap((d) => parseLog(text.get(d.path) || '', cfg)))
  }

  const replies = new Map<string, Doc[]>()
  for (const r of under('board/replies/').sort((a, b) => -newestFirst(a, b))) {
    const k = String(r.data.parent || '')
    replies.set(k, [...(replies.get(k) || []), r])
  }
  const answers = new Map<string, Doc>()
  for (const a of under('ai/answers/')) answers.set(String(a.data.request || a.data.id || baseName(a.path)), a)

  // One project per slug; the folder's project.md wins over a leftover legacy file.
  const projectBySlug = new Map<string, Doc>()
  for (const d of all.filter((x) => isProjectFile(x.path))) {
    const s = projectSlug(d)
    if (!projectBySlug.has(s) || PROJECT_FILE.test(d.path)) projectBySlug.set(s, d)
  }
  const projectFiles = new Map<string, Doc[]>()
  for (const d of [...all].sort((a, b) => a.path.localeCompare(b.path))) {
    const s = d.path.match(/^projects\/([^/]+)\//)?.[1]
    if (s && !PROJECT_FILE.test(d.path)) projectFiles.set(s, [...(projectFiles.get(s) || []), d])
  }

  const knowledge = all.filter((d) => !/^(board|todos|people|ai)\//.test(d.path)).sort((a, b) => a.path.localeCompare(b.path))

  return {
    all,
    byPath,
    knowledge,
    status: byPath.get('status.md'),
    investigations: all.filter((d) => /(^|\/)investigations\/[^/]+\.md$/i.test(d.path)).sort((a, b) => a.path.localeCompare(b.path)),
    linkedin: byPath.get('projects/linkedin/generallinkedin.md') || byPath.get('linkedin/generallinkedin.md'),
    board: under('board/').filter((d) => !d.path.startsWith('board/replies/')).sort(newestFirst),
    replies,
    todos: under('todos/').sort(newestFirst),
    people: all.filter((d) => isProfilePath(d.path)).sort((a, b) => String(a.data.name).localeCompare(String(b.data.name))),
    requests: under('ai/requests/').sort(newestFirst),
    answers,
    tasks: knowledge.flatMap((d) => openTasks(d).map((t) => ({ ...t, path: d.path, doc: title(d) }))),
    projects: [...projectBySlug.values()].sort(
      (a, b) => statusRank(a) - statusRank(b) || String(b.data.updated || '').localeCompare(String(a.data.updated || '')),
    ),
    projectFiles,
    roster,
    knownLogins: knownLogins(all, roster),
    logs,
    digests,
    logEntries,
    events: deriveEvents(all, { logs: logEntries }),
  }
}

// ---- projects ----

export type Freshness = { days: number; tone: 'ok' | 'warn' | 'bad'; label: string }
/** How long since a project was touched. ADHD nudge: green < 4 days, amber < 11, red after. */
export function freshness(updated: unknown): Freshness {
  const t = Date.parse(String(updated || ''))
  if (!t) return { days: 999, tone: 'bad', label: 'never updated' }
  const days = Math.max(0, Math.floor((Date.now() - t) / 864e5))
  const label = days === 0 ? 'updated today' : days === 1 ? 'updated yesterday' : `updated ${days} days ago`
  return { days, tone: days < 4 ? 'ok' : days < 11 ? 'warn' : 'bad', label }
}

export type Milestone = { text: string; date?: string; done: boolean }
export const milestones = (d: Doc): Milestone[] =>
  (Array.isArray(d.data.milestones) ? d.data.milestones : []).map((m: any) => ({ text: String(m.text || m), date: m.date ? String(m.date) : undefined, done: !!m.done }))

export type Snapshot = { date: string; source?: string; values: Record<string, number | string> }
export function metrics(d: Doc): Snapshot[] {
  const rows = Array.isArray(d.data.metrics) ? d.data.metrics : []
  return rows
    .map((r: any) => {
      const { date, source, ...values } = r || {}
      return { date: String(date || ''), source: source ? String(source) : undefined, values }
    })
    .sort((a: Snapshot, b: Snapshot) => a.date.localeCompare(b.date))
}

export async function askClaudeToRefresh(src: Source, me: Me, project: Doc) {
  const slug = projectSlug(project)
  const body =
    slug === 'linkedin'
      ? `Refresh the **LinkedIn tracker**: read my profile, add a new \`metrics\` row to \`${project.path}\` (date + numbers + source), update \`updated\`, and log anything new.`
      : `Update the **${project.data.title}** tracker: check progress, tick milestones, refresh \`updated\` and \`next\` in \`${project.path}\`.`
  await postMessage(src, me, { type: 'update', body, forClaude: true, project: slug })
}

export const requestId = (d: Doc) => String(d.data.id || baseName(d.path))

/** A login's name from its profile. Through the roster, so only people/<that login's slug>.md can name it (a file
 *  elsewhere with `github: <login>` can't). */
export function displayName(model: Model, login: unknown) {
  const l = String(login || '')
  if (l.toLowerCase() === 'claude') return 'Claude'
  return model.roster.find((p) => p.login.toLowerCase() === l.toLowerCase())?.name || l || '?'
}

// ---- writers (each one = one commit on GitHub) ----

export type PostRequest = 'join' | 'leave'

/** New board post. `to`: one person it's for (feeds their For you); `request` + `part`: join/leave requests.
 *  Returns the new file's path. */
export async function postMessage(
  src: Source,
  me: Me,
  m: { type: string; body: string; forClaude: boolean; project?: string; to?: string; request?: PostRequest; part?: string },
) {
  const id = makeId(me.login)
  const path = `board/${id}.md`
  const data = {
    id, author: me.login, created: nowIso(), type: m.type, for_claude: m.forClaude, status: 'open', project: m.project || undefined,
    to: m.to?.trim() || undefined, request: m.request || undefined, part: (m.part && cleanItem(m.part, LIMITS.part)) || undefined,
  }
  await src.write(path, serialize(data, m.body), `board: ${m.type} from ${me.login}`)
  return path
}

export async function postReply(src: Source, me: Me, parent: string, body: string) {
  const id = makeId(me.login)
  const path = `board/replies/${parent}--${id}.md`
  await src.write(path, serialize({ id, parent, author: me.login, created: nowIso() }, body), `board: reply from ${me.login}`)
  return path
}

/** Re-serializes the whole frontmatter (reformats it). Status ticks use setTodoStatus / setPostStatus instead. */
export async function patchDoc(src: Source, doc: Doc, patch: Record<string, unknown>, message: string) {
  await src.write(doc.path, serialize({ ...doc.data, ...patch }, doc.body), message)
}

/** New to-do. `blocker` = "people/<slug>/log/YYYY-MM.md#<When>" when it is a help request for a blocker row.
 *  Returns the new file's path. */
export async function addTodo(src: Source, me: Me, t: { title: string; owner: string; project?: string; blocker?: string }) {
  const id = makeId(me.login)
  const path = `todos/${id}.md`
  const data = { id, title: t.title, status: 'todo', owner: t.owner, created: nowIso(), by: me.login, project: t.project || undefined, blocker: t.blocker || undefined }
  await src.write(path, serialize(data, ''), `todo: ${t.title.slice(0, 60)}`)
  return path
}

type Stamps = Record<string, string | null>

/** Move a to-do (todo · doing · done). Only the changed lines are rewritten (setTopKeys). Stamps on transition:
 *  first move to doing → started_at/started_by; into done → done_at/done_by; out of done → done_* removed.
 *  Same status again → nothing written. true = written. */
export async function setTodoStatus(src: Source, me: Me, todo: { path: string; data?: Record<string, any> }, status: string, now = nowIso()) {
  const label = String(todo.data?.title || todo.path.split('/').pop()).slice(0, 50)
  return src.update(
    todo.path,
    (cur) => {
      if (cur === null) return null
      const d = parse(todo.path, cur).data
      const was = String(d.status || 'todo')
      if (was === status) return cur
      const patch: Stamps = { status }
      if (status === 'doing' && !d.started_at) Object.assign(patch, { started_at: now, started_by: me.login })
      if (status === 'done') Object.assign(patch, { done_at: now, done_by: me.login })
      else if (was === 'done') Object.assign(patch, { done_at: null, done_by: null })
      return setTopKeys(cur, patch)
    },
    `todo: ${status} · ${label}`,
  )
}

/** Close or reopen a board post. Closing stamps closed_at/closed_by; reopening removes them. Only those lines
 *  change. true = written. */
export async function setPostStatus(src: Source, me: Me, post: { path: string; data?: Record<string, any> }, status: 'open' | 'done', now = nowIso()) {
  const id = String(post.data?.id || baseName(post.path))
  return src.update(
    post.path,
    (cur) => {
      if (cur === null) return null
      const was = String(parse(post.path, cur).data.status || 'open')
      if (was === status) return cur
      const patch: Stamps = { status }
      if (status === 'done') Object.assign(patch, { closed_at: now, closed_by: me.login })
      else Object.assign(patch, { closed_at: null, closed_by: null })
      return setTopKeys(cur, patch)
    },
    `board: ${status === 'done' ? 'done' : 'reopen'} ${id}`,
  )
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Save my profile from the profile form, merged onto the newest saved version: keys the form does not send
 * (log settings, pronouns…) are kept. `base` = the data the form started from; keys the form left unchanged then
 * keep their newest saved value. Without `base`, the version first read here stands in for it.
 */
export async function saveProfile(src: Source, me: Me, data: Record<string, unknown>, body: string, base?: Record<string, unknown>) {
  const path = `people/${slug(me.login)}.md`
  let first: Record<string, unknown> | undefined
  return src.update(
    path,
    (cur) => {
      const now: Record<string, unknown> = cur === null ? {} : parse(path, cur).data
      const from = base ?? (first ??= now)
      const merged: Record<string, unknown> = { ...now }
      // the form changed it, or it is new everywhere → the form's value; else the newest saved value stays
      for (const [k, v] of Object.entries(data)) if (!sameValue(v, from[k]) || (!(k in now) && !(k in from))) merged[k] = v
      merged.github = me.login
      return serialize(merged, body)
    },
    `people: update ${me.login}`,
  )
}

export type Connector = 'web' | 'links' | 'history' | 'supabase'
export type AskOptions = {
  /** optional: pick the id up front (the chat needs it to open the new conversation) */
  id?: string
  question: string
  kind: 'ask' | 'summarize'
  target?: string
  /** id of the first request in a conversation (follow-ups share it) */
  thread?: string
  connectors?: Connector[]
  model?: 'fast' | 'deep'
  project?: string
}

export async function askAi(src: Source, me: Me, q: AskOptions) {
  const id = q.id || makeId(me.login)
  const data = {
    id, author: me.login, created: nowIso(), kind: q.kind, target: q.target, thread: q.thread,
    connectors: q.connectors?.length ? q.connectors : undefined, model: q.model, project: q.project,
  }
  await src.write(`ai/requests/${id}.md`, serialize(data, q.question), `ai: ${q.kind} from ${me.login}`)
  return id
}
