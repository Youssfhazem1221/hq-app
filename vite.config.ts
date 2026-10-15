import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'

// The workspace (private data repo) is the folder above app/.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// The app may only write into these folders.
const WRITABLE = ['board', 'todos', 'people', 'ai']

const skip = (rel: string) =>
  rel.split('/').some((s) => s.startsWith('.') || s === 'node_modules') || rel === 'app' || rel.startsWith('app/')
const posix = (p: string) => p.split(path.sep).join('/')

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

const readBody = (req: any) =>
  new Promise<any>((resolve, reject) => {
    let d = ''
    req.on('data', (c: any) => (d += c))
    req.on('end', () => {
      try { resolve(JSON.parse(d || '{}')) } catch (e) { reject(e) }
    })
  })

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
async function askLocal(root: string, envFile: string, b: any, res: any) {
  const q = b.request || {}
  const started = Date.now()
  openSse(res)
  res.write(': ok\n\n')
  const shared = path.join(root, 'supabase', 'functions', '_shared')
  const env = readEnv(envFile)
  const kind = q.kind === 'summarize' ? 'summarize' : 'ask'
  const model = q.model === 'deep' ? 'deep' : 'fast'
  const connectors = Array.isArray(q.connectors) ? q.connectors.map(String) : []
  const question = String(q.question).trim()
  const me = env.HQ_LOCAL_LOGIN || process.env.HQ_LOCAL_LOGIN || 'Youssfhazem1221'
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
    const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY
    if (!apiKey) throw new Error('No GEMINI_API_KEY in .env.local')
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
        files: () => walk(root),
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

/** Dev-only API so the app can read/write the local folder without GitHub. */
export function hqLocal(opts: { root?: string; envFile?: string } = {}): Plugin {
  const root = opts.root || ROOT
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
              const b = await readBody(req)
              const p = safePath(root, b.path, true)
              if (!p) return send(res, 400, { error: 'path not allowed' })
              fs.mkdirSync(path.dirname(p), { recursive: true })
              fs.writeFileSync(p, String(b.text))
              return send(res, 200, { ok: true })
            }
            case '/__hq/me':
              return send(res, 200, { login: process.env.HQ_LOCAL_LOGIN || 'Youssfhazem1221', name: 'Youssf (local)' })
            case '/__hq/activity': {
              // A file or a folder (project folders show the history of everything inside).
              const rel = cleanRel(url.searchParams.get('path') || '')
              const abs = rel && inside(root, rel)
              const only = rel && abs && fs.existsSync(abs) ? ['--', rel] : []
              return execFile('git', ['log', '-n', '15', '--pretty=format:%H%x1f%an%x1f%aI%x1f%s', ...only], { cwd: root }, (err, out) =>
                send(res, 200, err ? [] : String(out).split('\n').filter(Boolean).map((l) => {
                  const [sha, author, date, message] = l.split('\x1f')
                  return { sha, author, date, message }
                })),
              )
            }
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
              return askLocal(root, envFile, b, res)
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
