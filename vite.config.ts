import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

// The workspace (private data repo) is the folder above app/.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// The app may only write into these folders.
const WRITABLE = ['board', 'todos', 'people', 'ai']

const skip = (rel: string) =>
  rel.split('/').some((s) => s.startsWith('.') || s === 'node_modules') || rel === 'app' || rel.startsWith('app/')

function walk(dir: string, out: { path: string; text: string }[] = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    const rel = path.relative(ROOT, abs).split(path.sep).join('/')
    if (skip(rel)) continue
    if (e.isDirectory()) walk(abs, out)
    else if (e.name.toLowerCase().endsWith('.md')) out.push({ path: rel, text: fs.readFileSync(abs, 'utf8') })
  }
  return out
}

function safePath(rel: string, write = false) {
  const norm = path.posix.normalize(String(rel || '')).replace(/^\/+/, '')
  if (!norm.endsWith('.md') || norm.startsWith('..') || skip(norm)) return null
  if (write && !WRITABLE.includes(norm.split('/')[0])) return null
  return path.join(ROOT, ...norm.split('/'))
}

const readBody = (req: any) =>
  new Promise<any>((resolve, reject) => {
    let d = ''
    req.on('data', (c: any) => (d += c))
    req.on('end', () => {
      try { resolve(JSON.parse(d || '{}')) } catch (e) { reject(e) }
    })
  })

// Dev-only API so the app can read/write the local folder without GitHub.
function hqLocal(): Plugin {
  return {
    name: 'hq-local',
    apply: 'serve',
    configureServer(server) {
      const send = (res: any, code: number, data: unknown) => {
        res.statusCode = code
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(data))
      }
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost')
        if (!url.pathname.startsWith('/__hq/')) return next()
        try {
          switch (url.pathname) {
            case '/__hq/files':
              return send(res, 200, walk(ROOT))
            case '/__hq/read': {
              const p = safePath(url.searchParams.get('path') || '')
              if (!p || !fs.existsSync(p)) return send(res, 404, { error: 'not found' })
              res.setHeader('content-type', 'text/plain; charset=utf-8')
              return res.end(fs.readFileSync(p, 'utf8'))
            }
            case '/__hq/write': {
              if (req.method !== 'POST') return send(res, 405, { error: 'POST only' })
              const b = await readBody(req)
              const p = safePath(b.path, true)
              if (!p) return send(res, 400, { error: 'path not allowed' })
              fs.mkdirSync(path.dirname(p), { recursive: true })
              fs.writeFileSync(p, String(b.text))
              return send(res, 200, { ok: true })
            }
            case '/__hq/me':
              return send(res, 200, { login: process.env.HQ_LOCAL_LOGIN || 'Youssfhazem1221', name: 'Youssf (local)' })
            case '/__hq/activity': {
              const only = safePath(url.searchParams.get('path') || '') ? ['--', url.searchParams.get('path') as string] : []
              return execFile('git', ['log', '-n', '15', '--pretty=format:%H%x1f%an%x1f%aI%x1f%s', ...only], { cwd: ROOT }, (err, out) =>
                send(res, 200, err ? [] : String(out).split('\n').filter(Boolean).map((l) => {
                  const [sha, author, date, message] = l.split('\x1f')
                  return { sha, author, date, message }
                })),
              )
            }
            case '/__hq/ai': {
              const b = await readBody(req)
              if (!/^[\w-]+$/.test(b.id || '')) return send(res, 400, { error: 'bad id' })
              return execFile(process.execPath, ['scripts/ai-worker.mjs', '--id', b.id], { cwd: ROOT, timeout: 180000 }, (err, out, errOut) =>
                send(res, err ? 500 : 200, { ok: !err, log: String(out || '') + String(errOut || '') }),
              )
            }
          }
          next()
        } catch (e: any) {
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
