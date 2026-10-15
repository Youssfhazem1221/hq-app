// Turns the repo's markdown files into the app's model, and writes new items back.
import { openTasks, parse, serialize, title, type Doc } from './md'
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
  people: Doc[]
  requests: Doc[]
  answers: Map<string, Doc>
  tasks: Task[]
  projects: Doc[]
  /** Other .md files inside each project folder (projects/<slug>/…), by slug. */
  projectFiles: Map<string, Doc[]>
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
/** App route for a repo path: a project file opens the project page, other .md files the doc view. */
export const routeFor = (p: string) =>
  isProjectFile(p) ? '/projects/' + projectOfPath(p) : p.toLowerCase().endsWith('.md') ? '/docs/' + p : '/docs'
const STATUS_ORDER = ['active', 'waiting', 'parked', 'done']
const statusRank = (d: Doc) => {
  const i = STATUS_ORDER.indexOf(String(d.data.status || ''))
  return i === -1 ? STATUS_ORDER.length : i
}

const newestFirst = (a: Doc, b: Doc) => String(b.data.created || '').localeCompare(String(a.data.created || ''))
const baseName = (p: string) => p.split('/').pop()!.replace(/\.md$/i, '')

export function buildModel(files: FileEntry[]): Model {
  const all = files.map((f) => parse(f.path, f.text))
  const byPath = new Map(all.map((d) => [d.path, d]))
  const under = (prefix: string) => all.filter((d) => d.path.startsWith(prefix))

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
    investigations: under('investigations/').sort((a, b) => a.path.localeCompare(b.path)),
    linkedin: byPath.get('linkedin/generallinkedin.md'),
    board: under('board/').filter((d) => !d.path.startsWith('board/replies/')).sort(newestFirst),
    replies,
    todos: under('todos/').sort(newestFirst),
    people: under('people/').sort((a, b) => String(a.data.name).localeCompare(String(b.data.name))),
    requests: under('ai/requests/').sort(newestFirst),
    answers,
    tasks: knowledge.flatMap((d) => openTasks(d).map((t) => ({ ...t, path: d.path, doc: title(d) }))),
    projects: [...projectBySlug.values()].sort(
      (a, b) => statusRank(a) - statusRank(b) || String(b.data.updated || '').localeCompare(String(a.data.updated || '')),
    ),
    projectFiles,
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

export function displayName(model: Model, login: unknown) {
  const l = String(login || '')
  if (l.toLowerCase() === 'claude') return 'Claude'
  return String(model.people.find((p) => String(p.data.github || '').toLowerCase() === l.toLowerCase())?.data.name || l || '?')
}

// ---- writers (each one = one commit on GitHub) ----

export async function postMessage(src: Source, me: Me, m: { type: string; body: string; forClaude: boolean; project?: string }) {
  const id = makeId(me.login)
  const data = { id, author: me.login, created: nowIso(), type: m.type, for_claude: m.forClaude, status: 'open', project: m.project || undefined }
  await src.write(`board/${id}.md`, serialize(data, m.body), `board: ${m.type} from ${me.login}`)
}

export async function postReply(src: Source, me: Me, parent: string, body: string) {
  const id = makeId(me.login)
  await src.write(`board/replies/${parent}--${id}.md`, serialize({ id, parent, author: me.login, created: nowIso() }, body), `board: reply from ${me.login}`)
}

export async function patchDoc(src: Source, doc: Doc, patch: Record<string, unknown>, message: string) {
  await src.write(doc.path, serialize({ ...doc.data, ...patch }, doc.body), message)
}

export async function addTodo(src: Source, me: Me, t: { title: string; owner: string; project?: string }) {
  const id = makeId(me.login)
  const data = { id, title: t.title, status: 'todo', owner: t.owner, created: nowIso(), by: me.login, project: t.project || undefined }
  await src.write(`todos/${id}.md`, serialize(data, ''), `todo: ${t.title.slice(0, 60)}`)
}

export async function saveProfile(src: Source, me: Me, data: Record<string, unknown>, body: string) {
  await src.write(`people/${slug(me.login)}.md`, serialize({ ...data, github: me.login }, body), `people: update ${me.login}`)
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
