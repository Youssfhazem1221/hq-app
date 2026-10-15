import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import YAML from 'yaml'
import { DEFAULT_REPO } from './src/config'

// The workspace (private data repo) is the folder above app/.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// The app may only write into these folders (projects/: create-only, or a project the local login owns; people/: only
// my own files).
const WRITABLE = ['board', 'todos', 'people', 'ai', 'projects']
// "Me" for reading and display when HQ_LOCAL_LOGIN is not set: the owner of the default data repo (src/config.ts).
const DEFAULT_LOGIN = DEFAULT_REPO.split('/')[0]

const skip = (rel: string) =>
  rel.split('/').some((s) => s.startsWith('.') || s === 'node_modules') || rel === 'app' || rel.startsWith('app/')
const posix = (p: string) => p.split(path.sep).join('/')
/** A person's look settings (people/<slug>/ui.md): app config, read by the app, never AI context. */
export const isUiPrefsPath = (rel: string) => /^people\/[^/]+\/ui\.md$/i.test(String(rel))
// The shared server code (Ask AI core, Adjust look handler) always comes from this workspace, even when HQ_ROOT points
// the data at a fixture copy.
const SHARED = path.join(ROOT, 'supabase', 'functions', '_shared')
/** Largest POST body for /__hq/ui-tweak: Adjust look sends ≤4 KB; an onboarding intake (action "profile-draft") ≤~20 KB.
 *  The handler applies the per-action limits. */
const UI_TWEAK_MAX_BODY = 64 * 1024
/** The keys the Adjust look handler may see (never logged, never sent to the browser). */
const UI_TWEAK_ENV = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ALLOWED_LOGINS'] as const

function walk(root: string, dir = root, out: { path: string; text: string }[] = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    const rel = posix(path.relative(root, abs))
    if (skip(rel)) continue
    if (e.isDirectory()) walk(root, abs, out)
    else if (e.name.toLowerCase().endsWith('.md')) out.push({ path: rel, text: fs.readFileSync(abs, 'utf8') })
  }
  return out
}

/** A workspace-relative path that is safe to touch: forward slashes only (no "\", drive letters or NUL, which
 *  path.posix would not see but Windows would), no "..", no dot-folders, not the app. */
function cleanRel(rel: string) {
  const raw = String(rel || '')
  if (/[\\:\0]/.test(raw)) return null
  const norm = path.posix.normalize(raw).replace(/^\/+/, '').replace(/\/+$/, '')
  return !norm || norm === '.' || norm.startsWith('..') || skip(norm) ? null : norm
}

/** Absolute path of a clean relative path, only if it really is inside `base`. */
const inside = (base: string, rel: string) => {
  const abs = path.resolve(base, ...rel.split('/'))
  return abs.startsWith(path.resolve(base) + path.sep) ? abs : null
}

function safePath(root: string, rel: string, write = false) {
  const norm = cleanRel(rel)
  if (!norm || !norm.endsWith('.md')) return null
  const top = norm.split('/')[0]
  if (write && !WRITABLE.includes(top)) return null
  const abs = inside(root, norm)
  return abs && (!write || abs.startsWith(path.resolve(root, top) + path.sep)) ? abs : null
}

/** KEY=VALUE pairs from .env.local, read per request. Stays on the server: nothing is sent to the browser. */
function readEnv(file: string) {
  const env: Record<string, string> = {}
  if (!fs.existsSync(file)) return env
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i < 1 || line.trim().startsWith('#')) continue
    const v = line.slice(i + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
    if (v) env[line.slice(0, i).trim()] = v
  }
  return env
}

/** HQ_LOCAL_LOGIN as set up: the environment, then .env.local. '' when neither has it. */
export const configuredLogin = (envFile: string) => String(process.env.HQ_LOCAL_LOGIN || readEnv(envFile).HQ_LOCAL_LOGIN || '').trim()

/** Who "me" is in local mode: the configured login, else the owner (a default for reading and display only; writes
 *  that need an owner check, like projects/, refuse it: see projectRefusal). */
export const localLogin = (envFile: string) => configuredLogin(envFile) || DEFAULT_LOGIN

/** A text without a leading byte-order mark (U+FEFF). */
const noBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

/** Frontmatter of a markdown text as data ({} when missing or unreadable). */
function frontmatter(text: string): Record<string, any> {
  const m = noBom(String(text)).match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/)
  if (!m) return {}
  try {
    const d = YAML.parse(m[1])
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {}
  } catch {
    return {}
  }
}

/** A login's people/ slug (same rule as the app's slugOf). */
const loginSlug = (login: string) => login.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x'

/** The name in a login's profile (people/<slug>.md), '' when there is none. */
function profileName(root: string, login: string) {
  const slug = loginSlug(login)
  const abs = inside(root, `people/${slug}.md`)
  return abs && fs.existsSync(abs) ? String(frontmatter(fs.readFileSync(abs, 'utf8')).name ?? '').trim() : ''
}

/** sha1 (hex) of a file's text, as the app computes it for `expect` (a leading BOM is ignored). */
export const textSha1 = (text: string) => createHash('sha1').update(noBom(String(text)), 'utf8').digest('hex')

const PROJECT_FILE = /^projects\/[^/]+\/project\.md$/i
const LEGACY_PROJECT = /^projects\/[^/]+\.md$/i
const ownerOf = (text: string | null) => (text === null ? '' : String(frontmatter(text).owner ?? '').trim())
const sameLogin = (a: string, b: string) => !!a && a.toLowerCase() === b.toLowerCase()

/** Why the app may not write this projects/ file ('' = it may). New files are create-only (expect 'absent'): a new
 *  project.md must name me as its owner (anyone may start a project); any other new file inside projects/<slug>/
 *  needs that project to exist and be mine. Existing projects: only their owner, and never the owner line. `login` = the
 *  CONFIGURED local login: '' (HQ_LOCAL_LOGIN not set) refuses, so a clone without it never acts as the owner. */
function projectRefusal(root: string, rel: string, cur: string | null, text: string, expect: unknown, login: string) {
  if (!login) return 'Set HQ_LOCAL_LOGIN=<your GitHub login> in .env.local to create or change projects in local mode'
  const slug = rel.split('/')[1].replace(/\.md$/i, '')
  const projAbs = [`projects/${slug}/project.md`, `projects/${slug}.md`].map((r) => inside(root, r)).find((a) => a && fs.existsSync(a))
  const projText = projAbs ? fs.readFileSync(projAbs, 'utf8') : null
  const isProject = PROJECT_FILE.test(rel) || LEGACY_PROJECT.test(rel)
  if (cur === null) {
    if (expect !== 'absent') return 'New files under projects/ are create-only (expect "absent")'
    if (projText !== null && !sameLogin(ownerOf(projText), login)) return `Only ${ownerOf(projText) || 'its owner'} can add to projects/${slug}`
    // A new project.md: anyone may start a project (Y3), as its owner.
    if (isProject) return sameLogin(ownerOf(text), login) ? '' : `A new project must name you (${login}) as its owner`
    // Any other new file in a project folder (notes, "Save to project" explainers): that project's owner only.
    if (projText === null) return `projects/${slug} has no project.md: create the project first`
    return ''
  }
  const owner = isProject ? ownerOf(cur) : ownerOf(projText)
  if (!sameLogin(owner, login)) return `Only ${owner || 'its owner'} can change this project`
  if (isProject && ownerOf(text) !== owner) return "A project's owner can't be changed from the app"
  return ''
}

/** Why the app may not write this people/ file ('' = it may). Only MY files: my profile people/<my slug>.md and my
 *  folder people/<my slug>/ (log, ui.md, intake), never my digest/ (the weekly digest Action writes it), never another
 *  person's, the team's or Claude's files. `login` = the CONFIGURED local login: '' (HQ_LOCAL_LOGIN not set) refuses,
 *  so a clone without it never writes check-ins, a look or a profile into the default owner's files. */
function peopleRefusal(rel: string, login: string) {
  if (!login) return 'Set HQ_LOCAL_LOGIN=<your GitHub login> in .env.local to save check-ins, your profile or your look in local mode'
  const mine = loginSlug(login)
  const low = rel.toLowerCase()
  if (low === `people/${mine}.md`) return ''
  if (low.startsWith(`people/${mine}/`) && !low.startsWith(`people/${mine}/digest/`)) return ''
  return low.startsWith(`people/${mine}/digest/`) ? 'Digests are written by the weekly digest, not the app' : `You (${login}) can only change your own files under people/`
}

/**
 * The app's local save (POST /__hq/write). `expect`: sha1 of the text the change was based on, or 'absent'
 * (create-only); 409 when the file is not that version any more. No `expect` = overwrite (the old behaviour).
 * projects/: see projectRefusal, people/: see peopleRefusal (403). `login` = the configured local login
 * (HQ_LOCAL_LOGIN; '' when not set).
 */
export function localWrite(root: string, body: any, login: string = configuredLogin(path.join(root, '.env.local'))): { status: number; data: Record<string, unknown> } {
  const rel = cleanRel(body?.path)
  const p = rel && safePath(root, rel, true)
  if (!rel || !p) return { status: 400, data: { error: 'path not allowed' } }
  if (typeof body.text !== 'string') return { status: 400, data: { error: 'text must be a string' } }
  const expect = body.expect
  if (expect !== undefined && !(expect === 'absent' || (typeof expect === 'string' && /^[0-9a-f]{40}$/.test(expect)))) {
    return { status: 400, data: { error: 'expect must be a sha1 or "absent"' } }
  }
  const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  if (expect !== undefined && (expect === 'absent' ? cur !== null : cur === null || textSha1(cur) !== expect)) {
    return { status: 409, data: { error: `${rel} changed since it was read`, exists: cur !== null } }
  }
  const top = rel.split('/')[0]
  if (top === 'projects' || top === 'people') {
    const why = top === 'projects' ? projectRefusal(root, rel, cur, body.text, expect, login) : peopleRefusal(rel, login)
    if (why) return { status: 403, data: { error: why } }
  }
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body.text)
  return { status: 200, data: { ok: true } }
}

export type LocalCommit = { sha: string; author: string; date: string; message: string; body: string }

/** Recent commits (of a file or a folder), newest first: subject + body (the app derives `actor` from it). */
export function localActivity(root: string, rel?: string | null): Promise<LocalCommit[]> {
  const abs = rel ? inside(root, rel) : null
  const only = rel && abs && fs.existsSync(abs) ? ['--', rel] : []
  return new Promise((resolve) =>
    execFile('git', ['log', '-n', '15', '--pretty=format:%H%x1f%an%x1f%aI%x1f%B%x1e', ...only], { cwd: root, maxBuffer: 16 << 20 }, (err, out) =>
      resolve(err ? [] : String(out).split('\x1e').map((r) => r.replace(/^\s+/, '')).filter(Boolean).map((r) => {
        const [sha = '', author = '', date = '', raw = ''] = r.split('\x1f')
        const [message = '', ...rest] = raw.split(/\r?\n/)
        return { sha, author, date, message, body: rest.join('\n').trim() }
      })),
    ),
  )
}

const readBody = (req: any) =>
  new Promise<any>((resolve, reject) => {
    let d = ''
    req.on('data', (c: any) => (d += c))
    req.on('end', () => {
      try { resolve(JSON.parse(d || '{}')) } catch (e) { reject(e) }
    })
  })

/** A request body as text, at most `max` bytes (`tooBig` = it was longer; the rest is drained, not kept). */
const readRawBody = (req: any, max: number) =>
  new Promise<{ text: string; bytes: number; tooBig: boolean }>((resolve, reject) => {
    const parts: Buffer[] = []
    let bytes = 0
    req.on('data', (c: any) => {
      const b = Buffer.isBuffer(c) ? c : Buffer.from(String(c))
      bytes += b.length
      if (bytes <= max) parts.push(b)
    })
    req.on('end', () => resolve({ text: Buffer.concat(parts).toString('utf8'), bytes, tooBig: bytes > max }))
    req.on('error', reject)
  })

type UiTweakResult = { status: number; body: unknown }
type UiTweakHandler = (body: unknown, ctx: Record<string, unknown>) => Promise<UiTweakResult> | UiTweakResult

/**
 * Local Adjust look (POST /__hq/ui-tweak): the same handler as the `ui-tweak` edge function
 * (supabase/functions/_shared/ui-tweak-handler.mjs → handleUiTweak(body, {login, env, fetch})), called with the local
 * login instead of a token and the Gemini key from .env.local (never logged). Also serves action "profile-draft"
 * (onboarding intake → profile draft). No repo access, no writes: the handler only returns {status, body}.
 * Exported for tests: `shared` = the folder holding the handler, `fetch` = the network the handler may use.
 */
export async function localUiTweak(
  raw: { text: string; bytes: number; tooBig: boolean },
  o: { envFile: string; shared?: string; fetch?: typeof fetch },
): Promise<UiTweakResult> {
  if (raw.tooBig) return { status: 413, body: { error: `Request too large (max ${UI_TWEAK_MAX_BODY / 1024} KB)` } }
  let body: unknown
  try {
    body = JSON.parse(raw.text || '{}')
  } catch {
    return { status: 400, body: { error: 'Bad JSON' } }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, body: { error: 'Bad request' } }
  const file = path.join(o.shared || SHARED, 'ui-tweak-handler.mjs')
  if (!fs.existsSync(file)) return { status: 501, body: { error: 'Adjust look is not built yet (ui-tweak-handler.mjs is missing)' } }
  // Imported per request (cache-busted by mtime), like the Ask AI core, so edits apply without a restart.
  const mod = await import(pathToFileURL(file).href + '?v=' + fs.statSync(file).mtimeMs)
  const handle: UiTweakHandler | undefined = mod.handleUiTweak
  if (typeof handle !== 'function') return { status: 501, body: { error: 'Adjust look is not built yet (no handleUiTweak export)' } }
  const all = readEnv(o.envFile)
  const env: Record<string, string> = {}
  for (const k of UI_TWEAK_ENV) if (all[k]) env[k] = all[k]
  const net = o.fetch || ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a))
  try {
    const shared = o.shared || SHARED
    const keyFor = (login: string) => localKeyFor(all, shared, login)
    const r = await handle(body, { login: localLogin(o.envFile), configured: !!configuredLogin(o.envFile), local: true, env, keyFor, fetch: net, bytes: raw.bytes })
    const status = Number.isInteger(r?.status) && r.status >= 200 && r.status <= 599 ? r.status : 502
    return { status, body: r?.body ?? {} }
  } catch {
    // never echo the error: it could carry a request URL
    return { status: 502, body: { error: 'Adjust look failed. Try again, or use the presets.' } }
  }
}

/** The Gemini key ring for `login` (supabase/functions/_shared/gemini-keys.mjs, imported per call like the AI core). */
async function localKeyFor(env: Record<string, string>, shared: string, login: string): Promise<unknown> {
  const f = path.join(shared, 'gemini-keys.mjs')
  if (!fs.existsSync(f)) return env.GEMINI_API_KEY || env.GOOGLE_API_KEY || ''
  const mod = await import(pathToFileURL(f).href + '?v=' + fs.statSync(f).mtimeMs)
  return mod.withKeys({ ...env, SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY }).keyFor(login)
}

function gitLog(root: string, p?: string): Promise<{ date: string; author: string; message: string }[]> {
  const args = ['log', '-n', '20', '--date=short', '--pretty=format:%ad%x1f%an%x1f%s', ...(p ? ['--', p] : [])]
  return new Promise((resolve) =>
    execFile('git', args, { cwd: root }, (err, out) =>
      resolve(err ? [] : String(out).split('\n').filter(Boolean).map((l) => {
        const [date, author, message] = l.split('\x1f')
        return { date, author, message }
      })),
    ),
  )
}

// ---- Server-Sent Events ----

function openSse(res: any) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  res.flushHeaders?.()
}
const sseSend = (res: any, event: string, data: unknown) => {
  if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

type SourceRef = { title?: string; url?: string; path?: string }
type Done = { model?: string; seconds?: number; tools?: string[]; sources?: SourceRef[]; text?: string }

/** Answer file body: the answer + a Sources section (same shape the worker writes). */
function answerBody(d: Done) {
  const lines: string[] = []
  for (const s of d.sources || []) {
    if (s.url) lines.push(`- 🌐 [${String(s.title || s.url).replace(/[[\]]/g, '')}](${s.url})`)
    else if (s.path) lines.push(`- 📄 [${s.path}](../../${s.path})`)
  }
  return String(d.text || '').trim() + (lines.length ? `\n\n---\n**Sources**\n${lines.join('\n')}` : '')
}

/**
 * Local Ask AI: the same SSE contract as the Supabase function, answered by the shared AI core
 * (supabase/functions/_shared/answer.mjs) with keys from .env.local. At the end it writes
 * ai/requests/<id>.md and ai/answers/<id>.md, then sends `done` (or `error`).
 */
async function askLocal(root: string, envFile: string, b: any, res: any, shared: string = SHARED) {
  const q = b.request || {}
  const started = Date.now()
  openSse(res)
  res.write(': ok\n\n')
  // `shared` = the AI core's folder: this workspace's, also when HQ_ROOT points the data at a fixture copy
  const env = readEnv(envFile)
  const kind = q.kind === 'summarize' ? 'summarize' : 'ask'
  const model = q.model === 'deep' ? 'deep' : 'fast'
  const connectors = Array.isArray(q.connectors) ? q.connectors.map(String) : []
  const question = String(q.question).trim()
  const me = localLogin(envFile)
  const history = (Array.isArray(b.history) ? b.history : [])
    .slice(-6)
    .map((t: any) => ({ q: String(t?.q || ''), a: String(t?.a || '').slice(0, 1500) }))
    .filter((t: any) => t.q)

  let final: Done | null = null
  let failure = ''
  // done/error are held back until the files are saved, so the app can reload right away.
  const emit = (event: string, data: any) => {
    if (event === 'done') final = data || {}
    else if (event === 'error') failure ||= String(data?.message || data || 'Unknown error')
    else sseSend(res, event, data)
  }
  try {
    const core = path.join(shared, 'answer.mjs')
    if (!fs.existsSync(core)) throw new Error('The AI core (supabase/functions/_shared/answer.mjs) is not there yet.')
    // Imported per request (cache-busted by mtime), so edits to answer.mjs apply without a restart.
    const { streamAnswer } = await import(pathToFileURL(core).href + '?v=' + fs.statSync(core).mtimeMs)
    // The person's own keys (Settings → AI keys) → the owner's free keys → GEMINI_API_KEY in .env.local
    const apiKey = await localKeyFor(env, shared, me)
    if (!apiKey || (typeof apiKey === 'object' && !(apiKey as { size: number }).size)) throw new Error('No Gemini key: add one in Settings → AI keys')
    const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY
    await streamAnswer(
      {
        apiKey,
        model,
        question: kind === 'summarize' && q.target ? `${question}\n(Focus file: ${q.target})` : question,
        history,
        connectors,
        me,
        focus: q.target || undefined,
        project: q.project || undefined,
        supabase: env.SUPABASE_URL && secret ? { url: env.SUPABASE_URL, key: secret } : undefined,
        // Lazy: only read when the RAG index is unavailable or a file is opened.
        // look settings (people/<slug>/ui.md) are app config, never AI context (readers-first gate)
        files: () => walk(root).filter((f) => !isUiPrefsPath(f.path)),
        recentChanges: (p?: string) => gitLog(root, p),
      },
      emit,
    )
    if (!final && !failure) failure = 'The AI finished without an answer.'
  } catch (e: any) {
    failure ||= String(e?.message || e)
  }

  const done: Done = final || {}
  const seconds = Math.round((Date.now() - started) / 1000)
  try {
    const { serialize, nowIso } = await import(pathToFileURL(path.join(shared, 'md.mjs')).href)
    const reqData = {
      id: q.id, author: me, created: nowIso(), kind, target: q.target, thread: q.thread, connectors,
      model, project: q.project, handled_by: 'local',
    }
    const ansData = {
      id: q.id, request: q.id, model: done.model, created: nowIso(), status: failure ? 'error' : 'done',
      seconds, tools: Array.isArray(done.tools) ? done.tools : [], handled_by: 'local',
    }
    const dir = path.join(root, 'ai')
    fs.mkdirSync(path.join(dir, 'requests'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'answers'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'requests', `${q.id}.md`), serialize(reqData, question))
    fs.writeFileSync(path.join(dir, 'answers', `${q.id}.md`), serialize(ansData, failure ? `⚠️ Could not answer: ${failure}` : answerBody(done)))
  } catch (e: any) {
    failure ||= 'Could not save the answer: ' + String(e?.message || e)
  }
  if (failure) sseSend(res, 'error', { message: failure })
  else sseSend(res, 'done', { ...done, seconds: done.seconds ?? seconds })
  if (!res.writableEnded) res.end()
}

/** Dev-only API so the app can read/write the local folder without GitHub. The folder is HQ_ROOT when set (e.g. a
 *  materialized test fixture), else the workspace above app/. */
export function hqLocal(opts: { root?: string; envFile?: string; shared?: string; fetch?: typeof fetch } = {}): Plugin {
  const root = path.resolve(opts.root || process.env.HQ_ROOT || ROOT)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`hq-local: HQ_ROOT is not a folder: ${root}`)
  if (!opts.root && process.env.HQ_ROOT) console.info(`[hq-local] HQ_ROOT=${root}`)
  const envFile = opts.envFile || path.join(root, '.env.local')
  return {
    name: 'hq-local',
    apply: 'serve',
    configureServer(server) {
      const send = (res: any, code: number, data: unknown) => {
        res.statusCode = code
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(data))
      }

      // Live file events: the dev server watches every workspace .md; /__hq/events streams them.
      const clients = new Set<any>()
      const pending = new Set<string>()
      let timer: ReturnType<typeof setTimeout> | undefined
      const onFile = (file: string) => {
        const rel = posix(path.relative(root, file))
        if (rel.startsWith('..') || path.isAbsolute(rel) || !rel.toLowerCase().endsWith('.md') || skip(rel)) return
        pending.add(rel)
        clearTimeout(timer)
        timer = setTimeout(() => {
          const paths = [...pending].slice(0, 50)
          pending.clear()
          for (const c of clients) sseSend(c, 'change', { paths })
        }, 300)
      }
      // Vite's watcher runs with disableGlobbing, so watch the folder itself (onFile keeps only .md files).
      server.watcher.add(root)
      server.watcher.on('add', onFile).on('change', onFile).on('unlink', onFile)
      const ping = setInterval(() => {
        for (const c of clients) if (!c.writableEnded) c.write(': ping\n\n')
      }, 25_000)
      server.httpServer?.once('close', () => {
        clearInterval(ping)
        clearTimeout(timer)
        for (const c of clients) c.end()
        clients.clear()
      })

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost')
        if (!url.pathname.startsWith('/__hq/')) return next()
        // These routes run before Vite's own host check: refuse other Host names (DNS rebinding would let a web
        // page read the notes), and accept writes only from this app's own origin (not other localhost ports).
        const host = req.headers.host || ''
        if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return send(res, 403, { error: 'Host not allowed' })
        if (req.method === 'POST') {
          const origin = req.headers.origin
          if (origin && origin !== `http://${host}`) return send(res, 403, { error: 'Cross-origin request refused' })
          if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'JSON only' })
        }
        try {
          switch (url.pathname) {
            case '/__hq/files':
              return send(res, 200, walk(root))
            case '/__hq/read': {
              const p = safePath(root, url.searchParams.get('path') || '')
              if (!p || !fs.existsSync(p)) return send(res, 404, { error: 'not found' })
              res.setHeader('content-type', 'text/plain; charset=utf-8')
              return res.end(fs.readFileSync(p, 'utf8'))
            }
            case '/__hq/write': {
              if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
              const r = localWrite(root, await readBody(req), configuredLogin(envFile))
              return send(res, r.status, r.data)
            }
            case '/__hq/me': {
              // The name comes from the profile, so a wrong HQ_LOCAL_LOGIN shows before anything is saved.
              // configured: false = no HQ_LOCAL_LOGIN, so "me" is the default owner login (the UI can say so).
              const login = localLogin(envFile)
              return send(res, 200, { login, name: profileName(root, login) || login, configured: !!configuredLogin(envFile) })
            }
            case '/__hq/activity':
              // A file or a folder (project folders show the history of everything inside).
              return send(res, 200, await localActivity(root, cleanRel(url.searchParams.get('path') || '')))
            case '/__hq/events': {
              openSse(res)
              res.write('retry: 3000\n: connected\n\n')
              clients.add(res)
              req.on('close', () => clients.delete(res))
              return
            }
            case '/__hq/realtime': {
              // Doorbell topic (capability-style secret, like on GitHub where only token holders can read it).
              const f = path.join(root, '.hq', 'realtime.json')
              if (!fs.existsSync(f)) return send(res, 404, { error: 'no .hq/realtime.json' })
              const j = JSON.parse(fs.readFileSync(f, 'utf8'))
              return send(res, 200, { topic: j.topic, project: j.project })
            }
            case '/__hq/ask': {
              if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
              const b = await readBody(req)
              const q = b.request || {}
              if (!/^[\w-]+$/.test(q.id || '') || !String(q.question || '').trim()) return send(res, 400, { error: 'Bad request' })
              if (q.thread !== undefined && !/^[\w-]+$/.test(String(q.thread))) return send(res, 400, { error: 'Bad thread' })
              if (fs.existsSync(path.join(root, 'ai', 'answers', `${q.id}.md`))) return send(res, 409, { error: 'Already answered' })
              return askLocal(root, envFile, b, res, opts.shared || SHARED)
            }
            case '/__hq/ui-tweak': {
              // Adjust look + onboarding profile draft (no writes). POST + JSON + same origin are checked above.
              if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
              const r = await localUiTweak(await readRawBody(req, UI_TWEAK_MAX_BODY), { envFile, shared: opts.shared, fetch: opts.fetch })
              return send(res, r.status, r.body)
            }
            case '/__hq/keys': {
              // Settings → AI keys for the local login. Same handler as the `keys` edge function; never returns a key.
              if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
              const b = await readBody(req)
              const f = path.join(opts.shared || SHARED, 'keys-handler.mjs')
              if (!fs.existsSync(f)) return send(res, 501, { error: 'AI keys are not built here' })
              const mod = await import(pathToFileURL(f).href + '?v=' + fs.statSync(f).mtimeMs)
              const all = readEnv(envFile)
              const r = await mod.handleKeys(b, { login: localLogin(envFile), env: { ...all, SUPABASE_SECRET_KEY: all.SUPABASE_SECRET_KEY || all.SUPABASE_SERVICE_ROLE_KEY } })
              return send(res, r.status, r.body)
            }
            case '/__hq/ai': {
              // Old non-streaming worker: the fallback when /__hq/ask fails before its first event.
              const b = await readBody(req)
              if (!/^[\w-]+$/.test(b.id || '')) return send(res, 400, { error: 'bad id' })
              return execFile(process.execPath, ['scripts/ai-worker.mjs', '--id', b.id], { cwd: root, timeout: 180000 }, (err, out, errOut) =>
                send(res, err ? 500 : 200, { ok: !err, log: String(out || '') + String(errOut || '') }),
              )
            }
          }
          next()
        } catch (e: any) {
          if (res.headersSent) return res.end()
          send(res, 500, { error: String(e?.message || e) })
        }
      })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), hqLocal()],
  server: { port: 5173, strictPort: true },
})
