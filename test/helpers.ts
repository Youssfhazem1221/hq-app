// Test helpers. Node runs the app's TypeScript as-is (type stripping); it only needs the '.ts' that Vite adds to
// extensionless imports ('./md' → './md.ts'). Also: temp folders, the synthetic team fixture (it lives in the
// private repo, so tests that need it skip in the public app repo), an in-memory Source, and the real dev-server
// middleware (hqLocal) on a random port.
import { registerHooks } from 'node:module'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const APP = path.resolve(HERE, '..')
const FIXTURES = path.resolve(APP, '..', 'scripts', 'test', 'fixtures')

let hooked = false
function hook() {
  if (hooked) return
  hooked = true
  registerHooks({
    resolve(specifier: string, context: any, nextResolve: any) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && String(context.parentURL || '').endsWith('.ts')) {
        try {
          return nextResolve(specifier + '.ts', context)
        } catch {
          /* not a .ts module: resolve as written */
        }
      }
      return nextResolve(specifier, context)
    },
  })
}

/** Import an app module by its path under src/ ('lib/hq'). */
export async function app(rel: string): Promise<any> {
  hook()
  return import(pathToFileURL(path.join(APP, 'src', rel + '.ts')).href)
}

/** The dev-server config module (exports hqLocal, localWrite, localActivity, textSha1). */
export async function viteConfig(): Promise<any> {
  hook()
  return import(pathToFileURL(path.join(APP, 'vite.config.ts')).href)
}

/** The synthetic team (alice, bob, carol) from the private repo, or null when this is the public app repo alone. */
export async function fixture(): Promise<{ FILES: { path: string; text: string }[]; NOW: string; materialize: (dir: string) => string } | null> {
  const f = path.join(FIXTURES, 'team.mjs')
  return fs.existsSync(f) ? import(pathToFileURL(f).href) : null
}

export const readFixtureJson = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'))

/** A new empty temp folder (under HQ_TEST_TMP when set, else the OS temp folder). */
export function tmpDir(name: string) {
  const base = process.env.HQ_TEST_TMP || os.tmpdir()
  fs.mkdirSync(base, { recursive: true })
  return fs.mkdtempSync(path.join(base, `hq-app-${name}-`))
}

export const rm = (dir: string) => fs.rmSync(dir, { recursive: true, force: true })

export type Put = { path: string; text: string; message: string }

/** An in-memory Source: `update` runs the real updateLoop; every saved file is recorded in `puts`. */
export async function memSource(files: Record<string, string>) {
  const { updateLoop } = await app('lib/sync')
  const data = new Map(Object.entries(files))
  const puts: Put[] = []
  const src: any = {
    kind: 'local',
    label: 'memory',
    async loadAll() {
      return [...data].map(([p, text]) => ({ path: p, text }))
    },
    async refresh() {
      return null
    },
    async read(p: string) {
      return data.get(p) ?? null
    },
    async write(p: string, text: string, message: string) {
      puts.push({ path: p, text, message })
      data.set(p, text)
    },
    update(p: string, fn: (cur: string | null) => string | null | undefined, message: string) {
      return updateLoop(() => data.get(p) ?? null, (next: string) => src.write(p, next, message), fn, 3, p)
    },
    async me() {
      return { login: 'alice', name: 'Alice' }
    },
    async activity() {
      return []
    },
    async latest() {
      return null
    },
    async realtime() {
      return null
    },
    webUrl() {
      return null
    },
  }
  return { src, data, puts }
}

/** The fixture as `{path: text}`. */
export const filesOf = (FILES: { path: string; text: string }[]) => Object.fromEntries(FILES.map((f) => [f.path, f.text]))

/**
 * The real hqLocal() middleware on 127.0.0.1:<random port>, serving `root`, as `login`. While it runs, relative
 * fetch('/__hq/…') calls (LocalSource) go to it. close() restores fetch and the env. `extra` goes to hqLocal (the
 * folder of the shared server code, the network the Adjust look handler may use).
 */
export async function startLocal(root: string, login: string, extra: { shared?: string; fetch?: typeof fetch } = {}) {
  const { hqLocal } = await viteConfig()
  const before = process.env.HQ_LOCAL_LOGIN
  process.env.HQ_LOCAL_LOGIN = login
  let handler: any
  let onClose: (() => void) | undefined
  const watcher: any = { add() {}, on() { return watcher } }
  hqLocal({ root, envFile: path.join(root, '.env.local'), ...extra }).configureServer({
    watcher,
    httpServer: { once: (_: string, fn: () => void) => (onClose = fn) },
    middlewares: { use: (fn: any) => (handler = fn) },
  })
  const server = http.createServer((req, res) => handler(req, res, () => {
    res.statusCode = 404
    res.end('no route')
  }))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as any).port}`
  const realFetch = globalThis.fetch
  const posts: { path: string; expect?: string }[] = []
  globalThis.fetch = ((input: any, init?: any) => {
    if (typeof input === 'string' && input.startsWith('/')) {
      if (input === '/__hq/write' && init?.body) {
        const b = JSON.parse(init.body)
        posts.push({ path: b.path, expect: b.expect })
      }
      const { cache, ...rest } = init || {}
      return realFetch(base + input, rest)
    }
    return realFetch(input, init)
  }) as typeof fetch
  return {
    base,
    posts,
    async close() {
      globalThis.fetch = realFetch
      if (before === undefined) delete process.env.HQ_LOCAL_LOGIN
      else process.env.HQ_LOCAL_LOGIN = before
      onClose?.()
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    },
  }
}
