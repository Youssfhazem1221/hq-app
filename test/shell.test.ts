// Module A (shell) acceptance on the pure parts: header tiles (A5), keyboard gating (A4), palette ranking + registry,
// nav order, pins, the Pages tree, breadcrumbs, focus/Esc rules, initials, the Next button table and the pre-paint
// script in index.html (A2: enum-only cache, poisoned values ignored, v2 theme migrated once).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { APP, app } from './helpers.ts'

const core = await app('components/shell/shell-core')
const focus = await app('lib/focus')
const contracts = await app('lib/contracts')
const { buildModel } = await app('lib/hq')

const doc = (p: string, text: string) => ({ path: p, text })
const model = buildModel([
  doc('status.md', '---\ntitle: Status\n---\n# Status\n'),
  doc('notes/alpha.md', '---\ntitle: Alpha notes\nicon: idea\n---\n'),
  doc('notes/beta.md', '# Beta\n'),
  doc('guide.md', '---\ntitle: Guide\nicon: not-an-icon\n---\n'),
  doc('projects/demo/project.md', '---\ntitle: Demo\nstatus: active\nowner: alice\ncolor: 3\n---\n'),
  doc('projects/demo/notes.md', '# Demo notes\n'),
  doc('projects/solo/project.md', '---\ntitle: Solo\nstatus: active\nowner: bob\ncolor: 9\n---\n'),
  doc('projects/side/project.md', '---\ntitle: Side\nstatus: parked\nowner: alice\n---\n'),
  doc('projects/more/project.md', '---\ntitle: More\nstatus: active\nowner: carol\nmembers: [alice]\n---\n'),
  doc('people/alice.md', '---\nname: Alice A\ngithub: alice\n---\n'),
  doc('todos/t1.md', '---\ntitle: x\nowner: alice\nstatus: todo\n---\n'),
  doc('board/b1.md', '---\ntype: idea\n---\nhello\n'),
  doc('ai/requests/r1.md', '---\nid: r1\n---\nq\n'),
])
const alice = { login: 'alice', name: 'Alice A' }

test('A5 · PageHeader tiles [0, "0 h", null, 5] render exactly one tile; zeros and empties never show; max 3', () => {
  const t = (value: unknown, label = 'x') => ({ value, label })
  assert.equal(core.shownTiles([t(0), t('0 h'), null, t(5)]).length, 1)
  assert.equal(core.shownTiles([t(0), t('0 h'), null, t(5)])[0].value, 5)
  assert.deepEqual(core.shownTiles([t(''), t('0'), t('0%'), t('0.0 h'), false, t(undefined)]), [])
  assert.equal(core.shownTiles([t(1), t(2), t(3), t(4)]).length, 3)
  assert.equal(core.shownTiles([t('10 h'), t('12/27')]).length, 2, 'non-zero values stay')
  assert.deepEqual(core.shownTiles(undefined), [])
})

test('header tiles never repeat the sub line', () => {
  const tiles = [{ value: '8 of 10', label: 'done' }, { value: 3, label: 'members' }]
  assert.deepEqual(core.headerTiles(tiles, 'active · 8 of 10 done').map((t: any) => t.label), ['members'])
  assert.equal(core.headerTiles(tiles, '').length, 2)
})

test('A4 · keyboard: keys off blocks L and G H, never Ctrl/⌘ K; nothing fires while typing or with stray modifiers', () => {
  const on = { keys: 'on', typing: false, gPending: false }
  const off = { ...on, keys: 'off' }
  assert.deepEqual(core.keyAction({ key: 'l' }, on), { type: 'checkin' })
  assert.equal(core.keyAction({ key: 'l' }, off), null)
  assert.deepEqual(core.keyAction({ key: 'g' }, on), { type: 'g' })
  assert.equal(core.keyAction({ key: 'g' }, off), null)
  assert.deepEqual(core.keyAction({ key: 'h' }, { ...on, gPending: true }), { type: 'go', to: '/' })
  assert.equal(core.keyAction({ key: 'h' }, { ...off, gPending: true }), null)
  assert.deepEqual(core.keyAction({ key: 'e' }, { ...on, gPending: true }), { type: 'go', to: '/people' })
  assert.deepEqual(core.keyAction({ key: 'q' }, { ...on, gPending: true }), { type: 'gcancel' })
  for (const s of [on, off, { ...on, typing: true }]) {
    assert.deepEqual(core.keyAction({ key: 'k', ctrlKey: true }, s), { type: 'palette' })
    assert.deepEqual(core.keyAction({ key: 'K', metaKey: true }, s), { type: 'palette' })
    assert.deepEqual(core.keyAction({ key: '.', ctrlKey: true }, s), { type: 'adjust' })
    assert.deepEqual(core.keyAction({ key: '\\', metaKey: true }, s), { type: 'rail' })
    assert.deepEqual(core.keyAction({ key: 'Escape' }, s), { type: 'escape' })
  }
  assert.equal(core.keyAction({ key: 'l' }, { ...on, typing: true }), null, 'typing')
  assert.equal(core.keyAction({ key: 'l', altKey: true }, on), null, 'alt')
  assert.equal(core.keyAction({ key: 'l', ctrlKey: true }, on), null, 'ctrl+l is the browser\'s')
  assert.equal(core.keyAction({ key: 'L', shiftKey: true }, on), null, 'shift')
  assert.deepEqual(core.keyAction({ key: '?', shiftKey: true }, on), { type: 'help' })
  assert.equal(core.keyAction({ key: 'k', ctrlKey: true, shiftKey: true }, on), null, 'ctrl+shift+k is not the palette')
  assert.deepEqual(core.keyAction({ key: 'n' }, on), { type: 'new' })
  assert.deepEqual(core.keyAction({ key: 'x' }, on), { type: 'tick' })
})

test('isTyping: inputs, textareas, selects, contenteditable and ARIA text roles', () => {
  assert.equal(focus.isTyping({ tagName: 'INPUT' }), true)
  assert.equal(focus.isTyping({ tagName: 'TEXTAREA' }), true)
  assert.equal(focus.isTyping({ tagName: 'SELECT' }), true)
  assert.equal(focus.isTyping({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(focus.isTyping({ tagName: 'DIV', closest: (s: string) => (s.includes('[role="combobox"]') ? {} : null) }), true)
  assert.equal(focus.isTyping({ tagName: 'BUTTON', closest: () => null }), false)
  assert.equal(focus.isTyping(null), false)
})

test('Esc closes the newest surface first (popover → overlay → panel → sheet)', () => {
  const log: string[] = []
  const offSheet = focus.onEscape(() => void log.push('sheet'))
  const offPanel = focus.onEscape(() => void log.push('panel'))
  const offPop = focus.onEscape(() => void log.push('popover'))
  assert.equal(focus.runEscape(), true)
  offPop()
  focus.runEscape()
  offPanel()
  const offPass = focus.onEscape(() => false)
  focus.runEscape()
  offPass()
  offSheet()
  assert.deepEqual(log, ['popover', 'panel', 'sheet'])
  assert.equal(focus.runEscape(), false)
})

test('palette: suggestions first with no query; matches by score; `top` items jump first; Ask AI always last', () => {
  const it = (id: string, group: string, label: string, extra = {}) => ({ id, group, label, run() {}, ...extra })
  const items = [
    it('go:home', 'Go to', 'Home'),
    it('go:projects', 'Go to', 'Projects'),
    it('suggest:checkin', 'Suggested', 'Check in'),
    it('look:theme', 'Look', 'Switch to dark'),
    it('new:todo', 'Create', 'New to-do'),
    it('ask:q', 'Ask AI', 'Ask AI: “pro”'),
    it('look:tweak', 'Look', 'Adjust look: “pro”', { top: true }),
    it('go:home', 'Go to', 'Duplicate id'),
  ]
  const empty = core.rankPalette(items, '').map((x: any) => x.id)
  assert.equal(empty[0], 'suggest:checkin')
  assert.ok(!empty.includes('ask:q'), 'no "Ask AI: <query>" without a query')
  assert.equal(empty.filter((x: string) => x === 'go:home').length, 1, 'ids deduped')
  const withNext = core.rankPalette([...items, it('suggest:next', 'Suggested', 'Next: Pick a direction')], '').map((x: any) => x.id)
  assert.deepEqual(withNext.slice(0, 2), ['suggest:next', 'suggest:checkin'], 'the sourced Next item leads Suggested (spec §2.2)')
  const q = core.rankPalette(items, 'pro').map((x: any) => x.id)
  assert.equal(q[0], 'look:tweak')
  assert.equal(q[1], 'go:projects')
  assert.equal(q[q.length - 1], 'ask:q')
  assert.ok(!q.includes('suggest:checkin'), 'suggestions only on an empty query')
  assert.equal(core.fuzzy('prj', 'Projects'), 1)
  assert.equal(core.fuzzy('proj', 'Projects'), 2)
  assert.equal(core.fuzzy('zz', 'Projects'), 0)
})

test('registerPaletteSource: items join the palette; a throwing source is skipped; unregister removes it', () => {
  const off1 = core.registerPaletteSource((q: string) => [{ id: 'x:' + q, group: 'Create', label: 'From a module', run() {} }])
  const off2 = core.registerPaletteSource(() => {
    throw new Error('boom')
  })
  const ctx = { model: null, me: null, route: { page: 'Home', nav: 'home', path: '/' } }
  assert.deepEqual(core.sourcedItems('abc', ctx).map((x: any) => x.id), ['x:abc'])
  off1()
  off2()
  assert.deepEqual(core.sourcedItems('abc', ctx), [])
})

test('nav order + hidden from prefs; Home can never be hidden; unknown ids ignored', () => {
  assert.deepEqual(core.navList({ nav_order: [], nav_hidden: [] }), ['home', 'projects', 'tasks', 'board', 'ask', 'people'])
  assert.deepEqual(core.navList({ nav_order: ['ask', 'bogus', 'home'], nav_hidden: ['board', 'home'] }), ['ask', 'home', 'projects', 'tasks', 'people'])
})

test('pins: stored pins that exist; none stored → up to 2 of MY active projects; colour slot from color: 1–8 only', () => {
  const derived = core.pinnedNow({ pinned: [] }, model, alice)
  assert.deepEqual(derived.map((p: any) => p.id), ['project:demo', 'project:more'], 'owner or member, active only, max 2')
  assert.equal(derived[0].color, 3)
  const stored = core.pinnedNow({ pinned: ['project:solo', 'doc:notes/beta.md', 'project:gone', 'person:alice'] }, model, alice)
  assert.deepEqual(stored.map((p: any) => p.id), ['project:solo', 'doc:notes/beta.md', 'person:alice'], 'missing ones filtered at render')
  assert.equal(stored[0].color, 1, 'color: 9 is not a slot → 1')
  assert.deepEqual(core.pinnedNow({ pinned: [] }, null, alice), [])
  assert.equal(core.colorSlot('4'), 4)
  assert.equal(core.colorSlot('url(x)'), 1)
  assert.equal(core.colorSlot(2.5), 1)
})

test('Pages tree: model.knowledge only, titles + icons, folders with counts; no projects/, people/, ai/, board/, todos/', () => {
  const t = core.pagesTree(model)
  const all = [...t.files, ...t.dirs.flatMap((d: any) => d.items)].map((d: any) => d.path)
  assert.deepEqual(all.sort(), ['guide.md', 'notes/alpha.md', 'notes/beta.md', 'status.md'])
  assert.deepEqual(t.dirs.map((d: any) => [d.label, d.items.length]), [['Notes', 2]])
  const by = Object.fromEntries([...t.files, ...t.dirs[0].items].map((d: any) => [d.path, d]))
  assert.equal(by['notes/alpha.md'].title, 'Alpha notes')
  assert.equal(by['notes/alpha.md'].icon, 'idea')
  assert.equal(by['guide.md'].icon, 'file', 'unknown icon names fall back')
  assert.equal(by['status.md'].icon, 'flag')
  assert.equal(by['notes/beta.md'].title, 'Beta')
})

test('breadcrumbs: project title, doc folder + title, person name; phones show the last one only (CSS)', () => {
  assert.deepEqual(core.crumbsFor({ page: 'Project', nav: 'projects', path: '/projects/demo', slug: 'demo' }, model).map((c: any) => c.label), ['Projects', 'Demo'])
  assert.deepEqual(core.crumbsFor({ page: 'Docs', nav: 'docs', path: '/docs/notes/alpha.md', doc: 'notes/alpha.md' }, model).map((c: any) => c.label), ['Notes', 'Alpha notes'])
  assert.deepEqual(core.crumbsFor({ page: 'Docs', nav: 'docs', path: '/docs/status.md', doc: 'status.md' }, model).map((c: any) => c.label), ['Pages', 'Status'])
  assert.deepEqual(core.crumbsFor({ page: 'Person', nav: 'people', path: '/people/alice', person: 'alice' }, model).map((c: any) => c.label), ['People', 'Alice A'])
  assert.deepEqual(core.crumbsFor({ page: 'Tasks', nav: 'tasks', path: '/tasks' }, model).map((c: any) => c.label), ['Tasks'])
})

test('Avatar initials: no "Y(" from a bracketed login; two words → two initials', () => {
  assert.equal(core.initials('Ada (ada99)'), 'AD')
  assert.equal(core.initials('Ada Lovelace'), 'AL')
  assert.equal(core.initials('bob'), 'BO')
  assert.equal(core.initials('  '), '?')
  assert.ok(!/[^\p{L}\p{N}?]/u.test(core.initials('Zed (z) [x] !')))
})

test('Next: exactly one fixed button per kind', () => {
  const B = contracts.NEXT_BUTTON
  assert.deepEqual(Object.keys(B).sort(), ['checkin', 'decision', 'help', 'join', 'milestone', 'status', 'todo'])
  assert.deepEqual(
    Object.fromEntries(Object.entries(B).map(([k, v]: any) => [k, v.label])),
    { help: 'Open', join: 'Review', decision: 'Decide', todo: 'Done', milestone: 'Make it a to-do', status: 'Make it a to-do', checkin: 'Check in' },
  )
  assert.equal(contracts.prefsCacheKey('Alice'), 'hq.ui.alice')
  assert.equal(contracts.prefsCacheKey(null), 'hq.ui.@local')
})

// ---- pre-paint (index.html inline script) ----

const INDEX = fs.readFileSync(path.join(APP, 'index.html'), 'utf8')
const SPEC_ENUM = {
  theme: ['system', 'light', 'dark'], accent: ['violet', 'blue', 'green', 'amber', 'rose', 'slate'], density: ['compact', 'comfy', 'spacious'],
  size: ['s', 'm', 'l', 'xl', 'xxl'], font: ['inter', 'lexend', 'atkinson', 'system'], lh: ['normal', 'relaxed', 'loose'], ls: ['normal', 'wide'],
  motion: ['system', 'reduced', 'full'], contrast: ['normal', 'high'], calm: ['off', 'on'], focus: ['off', 'on'], keys: ['on', 'off'],
}

function prepaint(storage: Record<string, string>, osDark = false) {
  const script = INDEX.match(/<script>([\s\S]*?)<\/script>/)![1]
  const attrs: Record<string, string> = {}
  const links: string[] = []
  const store = { ...storage }
  const ctx: any = {
    document: {
      documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = String(v)), getAttribute: (k: string) => attrs[k] ?? null },
      createElement: () => ({}),
      head: { appendChild: (l: any) => links.push(l.href) },
    },
    localStorage: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => (store[k] = String(v)),
      removeItem: (k: string) => delete store[k],
    },
    matchMedia: () => ({ matches: osDark, addEventListener() {} }),
  }
  ctx.window = ctx
  vm.runInNewContext(script, ctx)
  return { attrs, store, links }
}

test('pre-paint: enum lists in index.html (between the markers) equal the spec §7.1 lists', () => {
  const s = INDEX.indexOf(contracts.PREPAINT_ENUM_START)
  const e = INDEX.indexOf(contracts.PREPAINT_ENUM_END)
  assert.ok(s > 0 && e > s, 'markers present')
  assert.deepEqual(JSON.parse(INDEX.slice(s + contracts.PREPAINT_ENUM_START.length, e)), SPEC_ENUM)
  assert.match(INDEX, /<meta name="color-scheme" content="light dark"/)
  const fonts = [...INDEX.matchAll(/<link[^>]+href="https:\/\/fonts\.googleapis\.com\/css2\?family=([^"&:]+)/g)].map((m) => m[1])
  assert.deepEqual(fonts, ['Bricolage+Grotesque'], 'one font link up front (Bricolage Grotesque + Figtree + JetBrains Mono)')
})

test('A2 · pre-paint: cached {theme: dark, size: xl} → data-theme=dark + data-size=xl; defaults leave no attribute', () => {
  const r = prepaint({ 'hq.ui.@last': '"alice"', 'hq.ui.alice': JSON.stringify({ theme: 'dark', size: 'xl', font: 'lexend' }) })
  assert.equal(r.attrs['data-theme'], 'dark')
  assert.equal(r.attrs['data-size'], 'xl')
  assert.equal(r.attrs['data-font'], 'lexend')
  assert.equal(r.links.length, 1, 'Lexend injected on use')
  assert.equal(r.attrs['data-accent'], undefined)
  assert.equal(r.attrs['data-theme-pref'], 'dark')
})

test('A2 · pre-paint: a poisoned cache paints the default (system → OS), nothing outside the enums reaches the DOM', () => {
  const bad = { theme: 'url(x)', size: 'xl;background:red', accent: '<b>', motion: { x: 1 }, focus: 'on' }
  const light = prepaint({ 'hq.ui.@last': '"alice"', 'hq.ui.alice': JSON.stringify(bad) })
  assert.equal(light.attrs['data-theme'], 'light')
  assert.equal(light.attrs['data-theme-pref'], 'system')
  assert.equal(light.attrs['data-size'], undefined)
  assert.equal(light.attrs['data-accent'], undefined)
  assert.equal(light.attrs['data-focus'], 'on', 'valid keys survive next to bad ones')
  assert.equal(light.attrs['data-sb'], 'rail', 'focus mode = rail sidebar')
  assert.equal(prepaint({ 'hq.ui.@last': '"alice"', 'hq.ui.alice': JSON.stringify(bad) }, true).attrs['data-theme'], 'dark')
  for (const junk of ['not json', '[1,2]', 'null', '"x"']) assert.equal(prepaint({ 'hq.ui.@last': '"alice"', 'hq.ui.alice': junk }).attrs['data-theme'], 'light')
  assert.equal(prepaint({ 'hq.ui.@last': '"../../x"', 'hq.ui.@local': '{"theme":"dark"}' }).attrs['data-theme'], 'dark', 'a bad @last falls back to @local')
  const values = Object.entries(light.attrs).filter(([k]) => k.startsWith('data-')).map(([, v]) => v)
  assert.ok(values.every((v) => /^[a-z]+$/.test(v)))
})

test('pre-paint: migrates the v2 hq.theme once and drops hq.design', () => {
  const r = prepaint({ 'hq.theme': '"dark"', 'hq.design': '"metro"' })
  assert.equal(r.attrs['data-theme'], 'dark')
  assert.equal(r.store['hq.theme'], undefined)
  assert.equal(r.store['hq.design'], undefined)
  assert.deepEqual(JSON.parse(r.store['hq.ui.@local']), { theme: 'dark' })
  const again = prepaint(r.store)
  assert.equal(again.attrs['data-theme'], 'dark', 'second load reads the migrated cache')
  const keep = prepaint({ 'hq.theme': '"dark"', 'hq.ui.@last': '"alice"', 'hq.ui.alice': '{"theme":"light"}' })
  assert.equal(keep.attrs['data-theme'], 'light', 'an existing v3 choice wins over the old key')
})
