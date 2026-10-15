// People: personal logs, profiles, project teams and "For you".
// Writers (each one = one commit on GitHub) go through Source.update: safe when two tabs or devices write at
// once, retried, and idempotent (no change → no commit). Every writer touches only the writer's own files, the
// items they create, and the team lines of projects they own (blueprint P2, Y3).
// Selectors read the in-memory model (0 API calls). All derivation lives in people-core.ts (shared with the AI
// and the scripts); this file is the app glue.
import { stringify as stringifyYaml } from 'yaml'
import { addTodo, displayName, postMessage, postReply, projectSlug, setPostStatus, type Model } from './hq'
import { parse, serialize, type Doc } from './md'
import {
  CLAUDE_PERSON, DEFAULT_LOG_CONFIG, LIMITS, LOG_RE, TEAM_TZ, appendEntry, blockerOpen, cleanItem, columnsFor, deriveEvents, entryLogPath,
  formatRoles, forYou, goalProgress, isBot, keepOldLabels, logPathFor, nextLine, nextProjectColor, parseLog, parseQuickLine, parseRoles, projectsOf, replaceRow,
  setTopKeys, shortHash, slugOf, summarize, timeByProject, toIso, validTz, validateConfig, waitingOn, weekStart, whenFor, zonedParts, zonedToUtc,
  type Entry, type Ev, type FieldValue, type ForYouItem, type Goal, type LogConfig, type NewEntry, type NextLine, type Person,
  type ProjectRef, type Seen, type Wait,
} from './people-core'
import type { Me, Source } from './source'
import { nowIso, slug, store } from './util'

// ---- small helpers ----

const DAY_MS = 864e5
/** Own log rows can be fixed or removed for this many days. */
export const EDIT_DAYS = 7
const LOGIN_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/

const same = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : []
const isHumanLogin = (l: string) => LOGIN_RE.test(l) && !isBot(l)

/** The browser's time zone (falls back to the team clock, Africa/Cairo). */
export function localTz() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz && validTz(tz) ? tz : TEAM_TZ
  } catch {
    return TEAM_TZ
  }
}

/** YYYY-MM-DD of `now` in `tz` (project `started` / `updated` dates). */
export const dayOf = (now: string = nowIso(), tz: string = localTz()) => zonedParts(now, tz).date

/** The `When` cell a log row gets for `at` in a file's time zone ("15 Oct 14:32"; in the hour that happens twice
 *  when clocks go back, the second pass ends with its UTC offset). Same rule as appendEntry (core whenFor). */
export function whenText(at: string, tz: string) {
  return whenFor(at, tz)
}

/** people/<slug>.md for a login (same rule as the profile form). */
export const profilePathFor = (login: string) => `people/${slug(login)}.md`

/** Is `path` a month file of my own log? */
export const isOwnLog = (me: Me, path: string) => LOG_RE.test(path) && path.startsWith(`people/${slugOf(me.login)}/log/`)

// ---- personal log ----

/** What a check-in needs: my log settings and my time zone. null = no profile yet (onboarding first). */
export type LogTarget = { cfg: LogConfig; tz: string }

export function logTargetFor(model: Model, login: string): LogTarget | null {
  const p = model.roster.find((x) => same(x.login, login))
  return p ? { cfg: p.log, tz: p.timezone } : null
}

/** Problems that block saving a row: required fields of this kind left empty. [] = fine. */
export function checkEntry(e: NewEntry, cfg: LogConfig): string[] {
  const kind = String(e.kind || cfg.kinds[0] || 'done')
  return columnsFor(cfg, kind)
    .filter((f) => f.required)
    .filter((f) => {
      const v = (e.fields || {})[f.key]
      return v === undefined || v === null || (typeof v === 'string' && !v.trim())
    })
    .map((f) => `${f.label} is required`)
}

/** The one-line check-in ("fixed login 45m +hq energy=4 @bob") → an entry for appendLog, plus the live chips. */
export function quickEntry(model: Model, login: string, line: string, now: string = nowIso()) {
  const cfg = logTargetFor(model, login)?.cfg || DEFAULT_LOG_CONFIG
  const myProjects = projectsOf(login, model.all).map((p) => p.slug)
  const allProjects = model.projects.map(projectSlug)
  const q = parseQuickLine(line, { cfg, myProjects, roster: model.roster, allProjects })
  const entry: NewEntry = { at: toIso(now), kind: q.kind, project: q.project || '', fields: q.fields, ref: q.ref }
  return { entry, chips: q.chips, errors: checkEntry(entry, cfg) }
}

const kindWord = (e: NewEntry, cfg: LogConfig) => String(e.kind || cfg.kinds[0] || 'done').replace(/^#/, '').toLowerCase()

/**
 * Add one row to MY log: people/<my slug>/log/<month of e.at>.md (created on first use). Idempotent: the same row
 * twice → one row and no second commit (`written: false`). `when` = the row's When cell (for a blocker's help to-do).
 */
export async function appendLog(src: Source, me: Me, e: NewEntry, t: LogTarget): Promise<{ written: boolean; path: string; when: string }> {
  const tz = validTz(t.tz) ? t.tz : TEAM_TZ
  const p = zonedParts(e.at, tz)
  if (!p.date) throw new Error('Not saved: the time of this entry is not valid')
  const errors = checkEntry(e, t.cfg)
  if (errors.length) throw new Error(`Not saved: ${errors.join(' · ')}`)
  const path = logPathFor(me.login, p.month)
  let when = whenText(e.at, tz)
  const written = await src.update(
    path,
    (cur) => {
      // an existing month keeps its own frozen tz (appendEntry uses it too)
      const fileTz = cur === null ? tz : String(parse(path, cur).data.tz || tz)
      when = whenText(e.at, validTz(fileTz) ? fileTz : tz)
      return appendEntry(cur, e, t.cfg, me.login, tz)
    },
    `log: ${kindWord(e, t.cfg)} from ${me.login}`,
  )
  return { written, path, when }
}

/** What ✏️ may change on a row; anything left out keeps its value. A new `at` must stay in the same month. */
export type RowChange = Partial<Pick<NewEntry, 'at' | 'kind' | 'project' | 'fields' | 'ref'>>

async function fixRow(src: Source, me: Me, path: string, when: string, change: RowChange | null, cfg: LogConfig, now: string) {
  if (!isOwnLog(me, path)) throw new Error('You can only change rows in your own log')
  return src.update(
    path,
    (cur) => {
      if (cur === null) throw new Error(`Not found: ${path}`)
      const row = parseLog(cur, cfg).find((x) => x.when === when)
      if (!row) throw new Error(`That row (${when}) is gone; it may have been changed on another device`)
      if (Date.parse(toIso(now)) - Date.parse(row.at) > EDIT_DAYS * DAY_MS) throw new Error(`Rows older than ${EDIT_DAYS} days stay as they are`)
      if (!change) return replaceRow(cur, when, null, cfg)
      const next: NewEntry = {
        at: change.at ? toIso(change.at) : row.at,
        kind: change.kind ?? row.kind,
        project: change.project ?? row.project,
        fields: change.fields ?? row.fields,
        ref: change.ref ?? row.ref,
      }
      const fileTz = String(parse(path, cur).data.tz || TEAM_TZ)
      const tz = validTz(fileTz) ? fileTz : TEAM_TZ
      // a row stays in its month: a new time must keep the month the row has (after a time-zone change a row near
      // midnight can carry the next month's date inside this file; it can still be fixed)
      if (zonedParts(next.at, tz).month !== zonedParts(row.at, tz).month) throw new Error('A row stays in its month; remove it and log it again instead')
      const errors = checkEntry(next, cfg)
      if (errors.length) throw new Error(`Not saved: ${errors.join(' · ')}`)
      return replaceRow(cur, when, next, cfg)
    },
    `log: fix from ${me.login}`,
  )
}

/** ✏️ Fix one of my own rows (≤7 days old), in place. true = written. */
export function editLogRow(src: Source, me: Me, path: string, when: string, change: RowChange, cfg: LogConfig, now: string = nowIso()) {
  return fixRow(src, me, path, when, change, cfg, now)
}

/** Remove one of my own rows (≤7 days old). An emptied table and day heading go too. true = written. */
export function removeLogRow(src: Source, me: Me, path: string, when: string, cfg: LogConfig, now: string = nowIso()) {
  return fixRow(src, me, path, when, null, cfg, now)
}

/**
 * 🧱 → "Ask <name>": a to-do for `to` that points at my blocker row. It shows in their For you and resolves the
 * blocker when done. The row itself is written first, with appendLog. Returns the to-do's path.
 */
export async function askForHelp(src: Source, me: Me, a: { logPath: string; when: string; to: string; title: string; project?: string }) {
  if (!isOwnLog(me, a.logPath)) throw new Error('A help request points at a row in your own log')
  const to = String(a.to || '').trim().replace(/^@/, '')
  if (!isHumanLogin(to) || same(to, me.login)) throw new Error('Ask a teammate (a GitHub login other than yours)')
  if (!a.when.trim()) throw new Error('Which blocker? (no row time)')
  const what = String(a.title || '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'blocked'
  return addTodo(src, me, { title: `Help: ${what}`, owner: to, project: a.project || undefined, blocker: `${a.logPath}#${a.when}` })
}

// ---- profile ----

/** A YAML block for a map or a list of maps (links, log), replacing just that key's lines. */
function setTopBlock(text: string, key: string, value: unknown) {
  const mark = `__hq_block_${shortHash(key + '\u0000' + JSON.stringify(value))}__`
  const marked = setTopKeys(text, { [key]: mark })
  const eol = marked.includes('\r\n') ? '\r\n' : '\n'
  const block = stringifyYaml({ [key]: value }, { lineWidth: 0 }).trimEnd().split('\n').join(eol)
  return marked.replace(`${key}: ${mark}`, () => block)
}

const isScalar = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

/** Set top-level keys, keeping every other byte: scalars and string lists through setTopKeys, maps and lists of
 *  maps as block-style YAML (the scripts' parser reads only block style, C1). null/undefined removes a key. */
export function setProfileKeys(text: string, patch: Record<string, unknown>) {
  let t = text
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) t = setTopKeys(t, { [k]: null })
    else if (isScalar(v)) t = setTopKeys(t, { [k]: v as string | number | boolean })
    else if (Array.isArray(v) && v.every(isScalar)) t = setTopKeys(t, { [k]: v.map(String) })
    else t = setTopBlock(t, k, v)
  }
  return t
}

/** A file's text with a new markdown body (the frontmatter bytes stay). */
function withBody(text: string, body: string) {
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const b = String(body || '').trim()
  return m ? m[0].replace(/(\r?\n)?$/, eol) + eol + (b ? b.split(/\r?\n/).join(eol) + eol : '') : text
}

/**
 * Change keys of MY profile (people/<my slug>.md), leaving every other line as it is. No profile yet → the file is
 * created (onboarding: one commit). `github` is always my login. `body` replaces the bio when given. true = written.
 */
export async function saveProfilePatch(src: Source, me: Me, patch: Record<string, unknown>, opts: { body?: string } = {}) {
  const path = profilePathFor(me.login)
  const keys = { ...patch }
  delete keys.github
  return src.update(
    path,
    (cur) => {
      if (cur === null) {
        const data: Record<string, unknown> = {}
        if (keys.name !== undefined && keys.name !== null) data.name = keys.name
        data.github = me.login
        for (const [k, v] of Object.entries(keys)) if (v !== null && v !== undefined && k !== 'name') data[k] = v
        return serialize(data, opts.body ?? '')
      }
      let t = cur
      if (String(parse(path, cur).data.github ?? '') !== me.login) t = setTopKeys(t, { github: me.login })
      t = setProfileKeys(t, keys)
      return opts.body === undefined ? t : withBody(t, opts.body)
    },
    `people: update ${me.login}`,
  )
}

/** The `log:` block as it is written: validated, keys in a fixed order, block style. */
export function logConfigYaml(cfg: LogConfig) {
  return stringifyYaml({ log: validateConfig(cfg).config }, { lineWidth: 0 })
}

/** ⚙️ My logging: validate and write the `log:` block of my profile (block style; only those lines change).
 *  Invalid parts are dropped and listed in `errors` (validateConfig). A relabelled field (same key, new label) keeps
 *  its old labels as `aliases`, so month tables written under an old label still count (relabelling never splits
 *  stats, blueprint §6). `config` = what was written. */
export async function saveLogConfig(src: Source, me: Me, raw: unknown): Promise<{ written: boolean; errors: string[]; config: LogConfig }> {
  const { config: wanted, errors } = validateConfig(raw)
  let config = wanted
  const path = profilePathFor(me.login)
  const written = await src.update(
    path,
    (cur) => {
      if (cur === null) throw new Error('Set up your profile first (People → you)')
      config = keepOldLabels(wanted, validateConfig(parse(path, cur).data.log).config)
      return setTopBlock(cur, 'log', config)
    },
    `people: log settings ${me.login}`,
  )
  return { written, errors, config }
}

// ---- projects ----

/** New project file: the same template as `node scripts/hq.mjs project new`. `color` = the project's colour slot
 *  1–8 (`var(--viz-N)`); createProject picks the lowest free one. */
/** The `next:` a new project starts with (projectTemplate; the same line as `hq.mjs project new`). */
export const TEMPLATE_NEXT = 'Fill in summary, goal and the first milestones'

/**
 * Owner only: give a project with no milestones its first one (block style `milestones:` with `{text, done: false}`).
 * The template's placeholder `next:` is cleared at the same time, so the project's Next becomes this milestone. Only
 * `milestones` (and that `next`) change; every other byte stays. false = nothing written (it has milestones by now).
 */
export async function addFirstMilestone(src: Source, me: Me, path: string, text: string): Promise<boolean> {
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 140)
  if (!t) throw new Error('Write the milestone first')
  return src.update(
    path,
    (cur) => {
      if (cur === null) throw new Error('This project is gone')
      const d = parse(path, cur).data
      if (!same(d.owner, me.login)) throw new Error(`Only ${String(d.owner || 'the owner')} can change this project`)
      if (Array.isArray(d.milestones) && d.milestones.length) return null
      let next = setTopBlock(cur, 'milestones', [{ text: t, done: false }])
      if (String(d.next ?? '').trim() === TEMPLATE_NEXT) next = setTopKeys(next, { next: null })
      return next
    },
    `project: first milestone · ${String(t).slice(0, 40)}`,
  )
}

export function projectTemplate(title: string, slugName: string, owner: string, day: string, color: number = 1) {
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    'type: project',
    `owner: ${owner}`,
    'status: active',
    `color: ${Number.isInteger(color) && color >= 1 && color <= 8 ? color : 1}`,
    `started: ${day}`,
    `updated: ${day}`,
    'summary: ""',
    'goal: ""',
    `next: ${JSON.stringify(TEMPLATE_NEXT)}`,
    'hub: ""',
    'docs: []',
    'metrics: []',
    'milestones: []',
    '---',
    '',
    `# ${title}`,
    '',
    `- **Notes for this project** go in this folder (\`projects/${slugName}/\`). The app lists them under "Files in this project".`,
    '- **Tracker:** add `milestones` (`{text, date?, done}`) and `metrics` rows (`{date, source, <metric>: n}`) in the frontmatter above.',
    '',
  ].join('\n')
}

/** [+ New project]: create-only (never overwrites); I become its owner. Throws if the slug is taken. Its `color:` is
 *  the lowest colour slot no project in `model` shows yet (core nextProjectColor); `usedColors` = slots already given to
 *  projects made since `model` was built (several projects created in one go each get their own slot). */
export async function createProject(src: Source, me: Me, p: { title: string; slug?: string; usedColors?: number[] }, model?: Model, now: string = nowIso()) {
  const title = String(p.title || '').replace(/\s+/g, ' ').trim()
  if (!title) throw new Error('A project needs a title')
  const s = p.slug ?? slug(title)
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(s)) throw new Error('The short name may use lowercase letters, digits and dashes')
  const taken = `A project called "${s}" already exists`
  if (model?.projects.some((d) => projectSlug(d) === s)) throw new Error(taken)
  const path = `projects/${s}/project.md`
  const color = nextProjectColor([...(model?.projects || []).map((d) => d.data?.color), ...(p.usedColors || [])])
  const ok = await src.update(path, (cur) => (cur === null ? projectTemplate(title, s, me.login, dayOf(now), color) : null), `project: new ${s} by ${me.login}`)
  if (!ok) throw new Error(taken)
  return { slug: s, path, color }
}

/** A project's team as the editor shows it. `roles` keys are lower-case logins. */
export type Team = { owner: string; members: string[]; roles: Record<string, string>; helpWanted: string[] }

/** The team written in a project file's frontmatter. */
export function teamOf(data: Record<string, unknown>): Team {
  return {
    owner: String(data.owner ?? '').trim(),
    members: list(data.members),
    roles: parseRoles(data.roles),
    helpWanted: list(data.help_wanted),
  }
}

/** Normalized team lines: members (exact case, no owner, no bots, ≤12), roles (`login=part`), help wanted (≤5).
 *  strict = a new team (bad input throws); not strict = the team already in the file (bad parts are skipped). */
function teamLines(t: Team, strict: boolean) {
  const members: string[] = []
  for (const m of t.members.map((x) => String(x || '').trim().replace(/^@/, ''))) {
    if (!m || same(m, t.owner) || members.some((x) => same(x, m))) continue
    if (!isHumanLogin(m)) {
      if (strict) throw new Error(`Not a teammate's GitHub login: "${m}"`)
      continue
    }
    members.push(m)
  }
  if (strict && members.length > LIMITS.members) throw new Error(`A project can have ${LIMITS.members} members at most`)
  const help: string[] = []
  for (const h of t.helpWanted.map((x) => cleanItem(x, LIMITS.part)).filter(Boolean)) if (!help.includes(h)) help.push(h)
  if (strict && help.length > LIMITS.helpWanted) throw new Error(`At most ${LIMITS.helpWanted} "help wanted" items`)
  return { members, roles: formatRoles(t.roles, members, t.owner), help_wanted: help }
}

const projectPathOf = (model: Model | undefined, s: string) =>
  model?.projects.find((d) => projectSlug(d) === s)?.path || `projects/${s}/project.md`

/**
 * Owner-only change of a project's team. `edit` gets the team as it is NOW in the file (fresh on every retry) and
 * returns the new one. Only members, roles, help_wanted, updated and updated_by change (setTopKeys). An unchanged
 * team writes nothing. Throws "Only <owner> can change this project" (before any write) when I'm not the owner.
 */
async function changeTeam(src: Source, me: Me, s: string, edit: (t: Team) => Team, model: Model | undefined, now: string) {
  const path = projectPathOf(model, s)
  const known = model?.projects.find((d) => projectSlug(d) === s)
  if (known && !same(known.data.owner, me.login)) throw new Error(`Only ${String(known.data.owner || 'the owner')} can change this project`)
  let refused = ''
  const written = await src.update(
    path,
    (cur) => {
      refused = ''
      if (cur === null) {
        refused = `No such project: ${s}`
        return null
      }
      const before = teamOf(parse(path, cur).data)
      if (!same(before.owner, me.login)) {
        refused = `Only ${before.owner || 'the owner'} can change this project`
        return null
      }
      const old = teamLines(before, false)
      const next = teamLines({ ...edit(before), owner: before.owner }, true)
      if (JSON.stringify(old) === JSON.stringify(next)) return cur
      // an empty list removes its key (a project without a team keeps a clean file)
      const lines = (xs: string[]) => (xs.length ? xs : null)
      return setTopKeys(cur, {
        members: lines(next.members), roles: lines(next.roles), help_wanted: lines(next.help_wanted), updated: dayOf(now), updated_by: me.login,
      })
    },
    `project: team ${s} by ${me.login}`,
  )
  if (refused) throw new Error(refused)
  return written
}

/** 👥 TeamEditor → Save: set a project's members, parts and help wanted (owner only). true = written. */
export function setProjectTeam(
  src: Source,
  me: Me,
  slugName: string,
  team: { members: string[]; roles: Record<string, string>; helpWanted: string[] },
  model?: Model,
  now: string = nowIso(),
) {
  return changeTeam(src, me, slugName, (t) => ({ ...t, members: team.members, roles: team.roles, helpWanted: team.helpWanted }), model, now)
}

function projectFor(model: Model, s: string) {
  const d = model.projects.find((x) => projectSlug(x) === s)
  if (!d) throw new Error(`No such project: ${s}`)
  return d
}

/** 🙋 Ask to join (or "I can help" with `part` = the help-wanted item): a board post to the owner. Returns its path. */
export async function requestJoin(src: Source, me: Me, model: Model, r: { project: string; part?: string }) {
  const d = projectFor(model, r.project)
  const owner = String(d.data.owner || '').trim()
  const t = teamOf(d.data)
  if (same(owner, me.login) || t.members.some((m) => same(m, me.login))) throw new Error(`You're already on ${r.project}`)
  if (!owner) throw new Error(`${r.project} has no owner to ask`)
  const part = cleanItem(r.part || '', LIMITS.part)
  return postMessage(src, me, {
    type: 'question', forClaude: false, project: r.project, to: owner, request: 'join', part: part || undefined,
    body: `🙋 I'd like to join ${r.project}${part ? ` as: ${part}` : ''}`,
  })
}

/** 🚪 Leave (a member asks the owner; members never edit the owner's file). Returns the post's path. */
export async function requestLeave(src: Source, me: Me, model: Model, r: { project: string }) {
  const d = projectFor(model, r.project)
  const owner = String(d.data.owner || '').trim()
  if (same(owner, me.login)) throw new Error("You own this project; change the owner in the file if you're handing it over")
  if (!teamOf(d.data).members.some((m) => same(m, me.login))) throw new Error(`You're not a member of ${r.project}`)
  return postMessage(src, me, { type: 'question', forClaude: false, project: r.project, to: owner, request: 'leave', body: `🚪 I'd like to leave ${r.project}` })
}

function requestOf(post: Doc, me: Me, kind: 'join' | 'leave') {
  const x = post.data
  if (String(x.request || '').toLowerCase() !== kind) throw new Error(`Not a ${kind} request`)
  if (!same(x.to, me.login)) throw new Error(`This request is for ${String(x.to || 'someone else')}`)
  const who = String(x.author || '').trim()
  const s = String(x.project || '').trim()
  if (!who || !s) throw new Error('This request has no author or project')
  return { who, project: s, part: cleanItem(String(x.part || ''), LIMITS.part), id: String(x.id || post.path.split('/').pop()!.replace(/\.md$/i, '')) }
}

/** The owner's answer to a join request. add: team + close + reply "✅ Added as <part>" (3 commits).
 *  decline: reply + close (2 commits). */
export async function answerJoin(src: Source, me: Me, model: Model, post: Doc, decision: 'add' | 'decline', now: string = nowIso()) {
  const r = requestOf(post, me, 'join')
  if (decision === 'add') {
    await changeTeam(
      src, me, r.project,
      (t) => ({ ...t, members: [...t.members, r.who], roles: r.part ? { ...t.roles, [r.who.toLowerCase()]: r.part } : t.roles }),
      model, now,
    )
    await setPostStatus(src, me, post, 'done', now)
    await postReply(src, me, r.id, `✅ Added as ${r.part || 'a member'}`)
  } else {
    await postReply(src, me, r.id, 'Not now, thanks for asking.')
    await setPostStatus(src, me, post, 'done', now)
  }
}

/** The owner's [Remove] on a leave request: team + close + reply (3 commits). */
export async function answerLeave(src: Source, me: Me, model: Model, post: Doc, now: string = nowIso()) {
  const r = requestOf(post, me, 'leave')
  await changeTeam(
    src, me, r.project,
    (t) => {
      const roles = { ...t.roles }
      delete roles[r.who.toLowerCase()]
      return { ...t, members: t.members.filter((m) => !same(m, r.who)), roles }
    },
    model, now,
  )
  await setPostStatus(src, me, post, 'done', now)
  await postReply(src, me, r.id, `👋 Removed from ${r.project}`)
}

// ---- For you: seen state (this device only) ----

const SEEN_MAX = 200
const HASH_RE = /^[0-9a-f]{8}$/
const seenKey = (login: string) => `hq.seen.${String(login).toLowerCase()}`
const cleanSeen = (v: any): Seen => {
  const at = typeof v?.at === 'string' ? toIso(v.at) : ''
  const ack = Array.isArray(v?.ack) ? [...new Set(v.ack.filter((h: unknown) => typeof h === 'string' && HASH_RE.test(h)) as string[])] : []
  return { at, ack: ack.slice(-SEEN_MAX) }
}

/** What I've seen on this device: a timestamp and ≤200 short hashes. No text, no paths (P12). Losing it only
 *  shows items again. Every read and write is guarded (private mode, blocked storage). */
export const seenStore = {
  get(login: string): Seen {
    try {
      return cleanSeen(store.get<unknown>(seenKey(login), null))
    } catch {
      return { at: '', ack: [] }
    }
  },
  set(login: string, seen: Seen) {
    try {
      store.set(seenKey(login), cleanSeen(seen))
    } catch {
      /* storage blocked: items just show again */
    }
  },
  /** Opening For you: everything up to `now` is seen (never moves back). */
  markSeen(login: string, now: string = nowIso()) {
    const s = seenStore.get(login)
    const at = toIso(now)
    seenStore.set(login, { at: at > s.at ? at : s.at, ack: s.ack })
  },
  /** [Got it] on one item (its `hash`). */
  ack(login: string, hash: string) {
    const s = seenStore.get(login)
    if (!s.ack.includes(hash)) seenStore.set(login, { at: s.at, ack: [...s.ack, hash] })
  },
}

// ---- selectors (in-memory, 0 API calls) ----

/** login → display name (profile name; 'Claude'). */
export const nameOf = (model: Model) => (login: string) => displayName(model, login)

/** Everything waiting for me (forYou rules 1–8), with this device's seen state unless one is given. */
export function forYouFor(model: Model, me: Me | string, now: string = nowIso(), seen?: Seen): ForYouItem[] {
  const login = typeof me === 'string' ? me : me.login
  return forYou(login, model.all, model.logEntries, seen ?? seenStore.get(login), now)
}

type Window = { from: string; to: string; counts: Record<string, number> }

/** Everything a person page needs, derived from the model. */
export type PersonCtx = {
  login: string
  slug: string
  /** null = a known login without a profile yet (ghost card). Claude gets CLAUDE_PERSON. */
  person: Person | null
  profile?: Doc
  isClaude: boolean
  /** The viewer is this person (own page: For you, check-in, ✏️, ⚙️). */
  isMe: boolean
  cfg: LogConfig
  tz: string
  projects: ProjectRef[]
  /** Log month files, newest first. */
  logDocs: Doc[]
  /** Their log rows, oldest month first. */
  entries: Entry[]
  /** Events they did or that were for them, oldest first. Their own AI questions show text only on their own page. */
  events: Ev[]
  /** This week and last week (their week_starts, their time zone). Log counts are self-reported. */
  week: Window
  lastWeek: Window
  goals: { goal: Goal; actual: number; label: string }[]
  /** Minutes per project per week, last 8 weeks, oldest first (the weekly time chart). */
  time: { week: string; byProject: Record<string, number> }[]
  openBlockers: Entry[]
  /** What they wait on (they are the waiter) and what waits on them. */
  waitingOn: Wait[]
  waitingForThem: Wait[]
  /** Newest log row time (ISO), null = no check-ins yet. */
  lastCheckin: string | null
  /** Last check-in older than nudge_days (amber word, never red). false when nudge_days is 0 or there is no row yet. */
  quiet: boolean
  /** Only on their own page (viewer = this person). */
  forYou: ForYouItem[]
  next: NextLine
}

/** One person's page data. `viewer` = who is looking (their own page shows For you and their AI question text). */
export function personCtx(model: Model, login: string, now: string = nowIso(), opts: { viewer?: string; seen?: Seen } = {}): PersonCtx {
  const N = toIso(now)
  const isClaude = same(login, 'claude')
  const person = isClaude ? CLAUDE_PERSON : model.roster.find((p) => same(p.login, login)) || null
  const canon = person?.login || model.knownLogins.find((l) => same(l, login)) || login
  const s = slugOf(canon)
  const isMe = !!opts.viewer && same(opts.viewer, canon)
  const cfg = person?.log || DEFAULT_LOG_CONFIG
  const tz = person?.timezone || TEAM_TZ
  const all = isMe ? deriveEvents(model.all, { logs: model.logEntries, viewer: canon }) : model.events
  const events = all.filter((e) => same(e.actor, canon) || same(e.for, canon))
  const entries = model.logEntries.get(s) || []

  const today = zonedParts(N, tz).date
  const start = weekStart(today, cfg.week_starts)
  const to = new Date(Date.parse(N) + 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const from = zonedToUtc(start, '00:00', tz)
  const lastFrom = zonedToUtc(new Date(Date.parse(start + 'T00:00:00Z') - 7 * DAY_MS).toISOString().slice(0, 10), '00:00', tz)
  const todos = model.todos
  const openBlockers = entries.filter((e) => e.kind === 'blocked' && blockerOpen(e, entryLogPath(s, e), entries, todos))
  const waits = waitingOn(model.all, model.logEntries, N)
  const rows = entries.map((e) => e.at).filter(Boolean).sort()
  const lastCheckin = rows.length ? rows[rows.length - 1] : null
  const quiet = cfg.nudge_days > 0 && !!lastCheckin && Date.parse(N) - Date.parse(lastCheckin) > cfg.nudge_days * DAY_MS
  const fy = isMe ? forYouFor(model, canon, N, opts.seen) : []
  const next: NextLine = person
    ? nextLine(opts.viewer || '', person, { events: all, forYou: fy, waits, now: N, nameOf: nameOf(model) })
    : { text: `${canon} · no profile yet` }

  return {
    login: canon,
    slug: s,
    person,
    profile: person && !isClaude ? model.byPath.get(person.path) : undefined,
    isClaude,
    isMe,
    cfg,
    tz,
    projects: isClaude ? [] : projectsOf(canon, model.all),
    logDocs: model.logs.get(s) || [],
    entries,
    events,
    week: { from, to, counts: summarize(all, canon, from, to) },
    lastWeek: { from: lastFrom, to: from, counts: summarize(all, canon, lastFrom, from) },
    goals: person && !isClaude ? goalProgress(person, all, N) : [],
    time: timeByProject(entries, cfg, 8, N, tz),
    openBlockers,
    waitingOn: waits.filter((w) => same(w.waiter, canon)),
    waitingForThem: waits.filter((w) => same(w.on, canon)),
    lastCheckin,
    quiet,
    forYou: fy,
    next,
  }
}

export type { Entry, FieldValue, ForYouItem, LogConfig, NewEntry, Person, Seen }
