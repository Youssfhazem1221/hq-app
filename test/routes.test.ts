// Module A routes: hash → page, the wave 1–3 fallbacks to the old files, the retired design lab, dev-only previews.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { APP, app } from './helpers.ts'

const router = await app('lib/router')
const PAGES = fs.readdirSync(path.join(APP, 'src', 'pages')).filter((f) => f.endsWith('.tsx') && !f.startsWith('__') && f !== 'DesignLab.tsx').map((f) => f.slice(0, -4))

const r = (hash: string) => router.parseRoute(hash)

test('hash → route: every v3 page, people tabs, #/me, docs paths, old #/todos, unknown → Home', () => {
  assert.deepEqual(r('/'), { page: 'Home', nav: 'home', path: '/' })
  assert.equal(r('').page, 'Home')
  assert.equal(r('/home').page, 'Home')
  assert.deepEqual(r('/projects'), { page: 'Projects', nav: 'projects', path: '/projects' })
  assert.deepEqual(r('/projects/demo'), { page: 'Project', nav: 'projects', path: '/projects/demo', slug: 'demo' })
  assert.equal(r('/projects/demo/').slug, 'demo')
  assert.equal(r('/tasks').page, 'Tasks')
  assert.equal(r('/todos').page, 'Tasks', 'old links keep working')
  assert.equal(r('/board').page, 'Board')
  assert.equal(r('/ask').page, 'Ask')
  assert.deepEqual(r('/people'), { page: 'People', nav: 'people', path: '/people' })
  assert.deepEqual(r('/people/_team'), { page: 'People', nav: 'people', path: '/people/_team', tab: 'together' })
  assert.deepEqual(r('/people/bob'), { page: 'Person', nav: 'people', path: '/people/bob', person: 'bob' })
  assert.equal(r('/me').person, '@me')
  assert.deepEqual(r('/docs/notes/a b.md'), { page: 'Docs', nav: 'docs', path: '/docs/notes/a b.md', doc: 'notes/a b.md' })
  assert.equal(r('/docs').doc, undefined)
  assert.equal(r('/settings').page, 'Settings')
  assert.deepEqual(r('/design'), { page: 'Home', nav: 'home', path: '/' }, 'the design lab is retired')
  assert.deepEqual(r('/nope/x'), { page: 'Home', nav: 'home', path: '/' })
  assert.equal(r('/__preview/VisualsPreview').path, '/__preview/VisualsPreview', 'previews keep their path')
})

test('one page file per route: every page resolves to its own v3 file; the v2 pages and the design lab are deleted', () => {
  assert.equal(router.pickPage('Home', ['Dashboard']), null, 'no fallback to the old Dashboard')
  assert.equal(router.pickPage('Home', ['Home']), 'Home')
  assert.equal(router.pickPage('Board', []), null)
  assert.equal(router.PAGE_FALLBACK, undefined, 'the wave 1–3 fallback table is gone')
  for (const page of ['Home', 'Projects', 'Project', 'Tasks', 'Board', 'Ask', 'People', 'Person', 'Docs', 'Settings']) {
    assert.equal(router.pickPage(page, PAGES), page, `${page} has its own page file (have: ${PAGES.join(', ')})`)
  }
  for (const old of ['pages/Dashboard.tsx', 'pages/Todos.tsx', 'pages/DesignLab.tsx', 'nav.tsx', 'designs.ts', 'designs.css', 'styles.css']) {
    assert.ok(!fs.existsSync(path.join(APP, 'src', old)), `src/${old} is deleted`)
  }
  for (const p of PAGES) {
    const src = fs.readFileSync(path.join(APP, 'src', 'pages', p + '.tsx'), 'utf8')
    assert.match(src, /export const v3 = true/, `${p} is a v3 page`)
  }
})

test('routes.tsx: lazy glob over pages/*.tsx, previews only in dev, the design lab never bundled', () => {
  const src = fs.readFileSync(path.join(APP, 'src', 'routes.tsx'), 'utf8')
  assert.match(src, /import\.meta\.glob<PageModule>\(\['\.\/pages\/\*\.tsx', '!\.\/pages\/__\*\.tsx'\]\)/)
  assert.doesNotMatch(src, /className="legacy"/, 'no .legacy wrapper any more')
  assert.match(src, /import\.meta\.env\.DEV \? import\.meta\.glob<PageModule>\('\.\/pages\/__\*\.tsx'\) : \{\}/)
  assert.match(src, /\blazy\(/)
  const app = fs.readFileSync(path.join(APP, 'src', 'App.tsx'), 'utf8')
  assert.doesNotMatch(app, /from '\.\/pages\//, 'App imports no page statically')
  assert.doesNotMatch(app, /designs/, 'the design lab look is gone')
  assert.doesNotMatch(app, /useInterimPrefs/, 'App uses the real prefs store (lib/prefs.ts usePrefs)')
  assert.match(app, /usePrefs\(/)
})

test('dist (when built): one chunk per page, no preview or design-lab chunk', { skip: !fs.existsSync(path.join(APP, 'dist', 'assets')) && 'no build' }, () => {
  const files = fs.readdirSync(path.join(APP, 'dist', 'assets'))
  for (const p of PAGES) assert.ok(files.some((f) => f.startsWith(p + '-') && f.endsWith('.js')), `${p} is its own lazy chunk`)
  assert.ok(!files.some((f) => /^(__|DesignLab)/.test(f)), files.join(', '))
})

test('askAnywhere stores the prefill the Ask page reads', () => {
  assert.equal(router.ASK_PREFILL_KEY, 'hq.askPrefill')
  assert.equal(router.BOARD_PREFILL_KEY, 'hq.boardPrefill', 'same key the Board page reads (read-core)')
  assert.equal(router.docTitle('Projects'), 'Projects · HQ')
  assert.equal(router.docTitle(''), 'HQ')
})
