// Acceptance test E-2 (build plan, module E): the inline pre-paint script in index.html carries the SAME enum
// lists as ui-prefs-core (ENUM), and whatever cache it reads, it only ever paints enum members on <html>.
// Skips until the v3 pre-paint lands in index.html (module A). HQ_PREPAINT_HTML=<file> checks another page.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { APP, app } from './helpers.ts'

const core = await app('lib/ui-prefs-core')
const ENUM: Record<string, readonly string[]> = core.ENUM
const HTML = fs.readFileSync(process.env.HQ_PREPAINT_HTML || path.join(APP, 'index.html'), 'utf8')
/** Inline classic scripts (no src, not modules). */
const INLINE = [...HTML.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter((m) => !/\bsrc\s*=/.test(m[1]) && !/type\s*=\s*["']?module/i.test(m[1]))
  .map((m) => m[2])
/** The pre-paint = the inline script that knows the font enum. */
const PRE = INLINE.find((s) => /['"]lexend['"]/.test(s) && /['"]atkinson['"]/.test(s)) || null
const skip = !PRE && 'the v3 pre-paint is not in index.html yet (module A)'
/** The look keys the pre-paint must know (everything that becomes a data-* attribute). `keys` is optional. */
const REQUIRED = ['theme', ...core.DATA_ATTRS] as string[]

function listIn(src: string, key: string): string[] | null {
  const m = new RegExp('(?:^|[^\\w$])["\']?' + key + '["\']?\\s*:\\s*\\[([^\\]]*)\\]').exec(src)
  return m ? [...m[1].matchAll(/["']([^"']*)["']/g)].map((x) => x[1]) : null
}

test('E-2 pre-paint enum lists = ui-prefs-core ENUM', { skip }, () => {
  for (const k of REQUIRED) {
    const got = listIn(PRE!, k)
    assert.ok(got, `pre-paint has no list for "${k}"`)
    assert.deepEqual(got, [...ENUM[k]], k)
  }
  const keys = listIn(PRE!, 'keys')
  if (keys) assert.deepEqual(keys, [...ENUM.keys], 'keys')
})

/** Runs the pre-paint script against a fake page whose storage returns `cached` for ANY key. */
function paint(cached: string | null, dark: boolean, search = '') {
  const attrs = new Map<string, string>()
  const el = (): any => ({ setAttribute() {}, getAttribute: () => null, removeAttribute() {}, appendChild() {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, dataset: {} })
  const kebab = (k: string) => 'data-' + k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
  const root: any = {
    setAttribute: (k: string, v: unknown) => attrs.set(String(k).toLowerCase(), String(v)),
    getAttribute: (k: string) => attrs.get(String(k).toLowerCase()) ?? null,
    removeAttribute: (k: string) => attrs.delete(String(k).toLowerCase()),
    hasAttribute: (k: string) => attrs.has(String(k).toLowerCase()),
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  }
  root.dataset = new Proxy({}, {
    set: (_t, k, v) => (attrs.set(kebab(String(k)), String(v)), true),
    get: (_t, k) => attrs.get(kebab(String(k))),
    deleteProperty: (_t, k) => (attrs.delete(kebab(String(k))), true),
  })
  const store = { getItem: () => cached, setItem() {}, removeItem() {}, key: () => null, length: 1 }
  const mm = () => ({ matches: dark, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  const doc = { documentElement: root, head: el(), body: el(), querySelector: () => el(), querySelectorAll: () => [], getElementById: () => null, createElement: () => el(), addEventListener() {} }
  const ctx: any = { document: doc, localStorage: store, sessionStorage: store, matchMedia: mm, location: { search, hash: '', href: 'http://localhost/' + search, pathname: '/' }, navigator: { userAgent: 'test' }, URLSearchParams, JSON, console: { log() {}, warn() {}, error() {} }, addEventListener() {}, setTimeout: () => 0 }
  ctx.window = ctx
  ctx.self = ctx
  ctx.globalThis = ctx
  vm.createContext(ctx)
  vm.runInContext(PRE!, ctx, { timeout: 1000 })
  return attrs
}

test('E-2 pre-paint paints only enum members, whatever the cache holds', { skip }, () => {
  const poison = [
    JSON.stringify({ theme: 'url(https://evil.example/x)', size: 'xl;background:red', accent: '<b>', font: '"><script>', motion: 'expression(1)', calm: 'on', density: 'spacious' }),
    JSON.stringify({ theme: 'dark', size: 'xl', font: 'lexend' }),
    '"dark"',
    'not json {',
    '{"__proto__":{"theme":"dark","size":"xxl"}}',
    'null',
    '[]',
    null,
  ]
  for (const cached of poison) {
    for (const dark of [false, true]) {
      let attrs: Map<string, string>
      assert.doesNotThrow(() => { attrs = paint(cached, dark, '?theme=url(x)') }, `pre-paint threw on ${cached}`)
      for (const [name, value] of attrs!) {
        assert.doesNotMatch(value, /[()<>;"'`\\]|url|script|expression/i, `${name}="${value}" from ${cached}`)
        const key = name.replace(/^data-/, '').replace(/^theme-pref$/, 'theme')
        if (name === 'data-theme') assert.ok(value === 'light' || value === 'dark', `data-theme="${value}"`)
        else if (name.startsWith('data-') && ENUM[key]) assert.ok(ENUM[key].includes(value), `${name}="${value}" from ${cached}`)
      }
    }
  }
})
