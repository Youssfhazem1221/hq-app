// B1 + B2: the ```explainer parser is TOTAL. Port of the design mock's fuzz (tools/fuzz-explainer.mjs, same seeded
// generator): 1,400 shapes (60% near-valid), parse never throws, every cap holds, no html survives, the map
// geometry and the code fallback never throw, a 13 KB block → null, and the 5th rich block → code. Plus the
// critique's crash inputs and the hardenings over the mock (prototype-named ids, source segments, control chars).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { app } from './helpers.ts'
import { loadTsx } from './tsx.ts'

const X = await app('components/explainers/parse')
const G = await app('components/explainers/graph-layout')
const L = X.EX_LIMITS
// Like the mock's srcExists: known pages + any file inside a project folder.
const exists = (p: string) => p === 'technical.md' || /^projects\/[a-z0-9-]+\/[\w.-]+\.md$/.test(p)
const parse = (raw: unknown) => X.parseExplainer(raw, { exists })

// ---- the mock's generator, with an exact RNG ----
// The mock used `(seed * 1103515245 + 12345) & 0x7fffffff`: that product passes 2^53, so the double loses its low
// bits and the sequence is so structured that its 1,000 shapes drew 0 random maps, 3 compares and 1 timeline.
// mulberry32 (Math.imul, exact 32-bit) keeps the same shapes but reaches every type; the test asserts that it does.
let seed = 7
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)]
const TYPES = ['map', 'flow', 'steps', 'cards', 'timeline', 'compare', 'statemachine', 'network', 'bogus', '', null, 3]
function val(d = 0): any {
  const r = rnd()
  if (d > 3) return pick([null, 'x', 1, true])
  if (r < 0.12) return null
  if (r < 0.22) return Math.floor(rnd() * 20) - 5
  if (r < 0.32) return pick(['<script>alert(1)</script>', 'javascript:alert(1)', 'a'.repeat(Math.floor(rnd() * 600)), 'ok', 'flag', 'done', 'dashed', 'n1', 'n2', 'n1'])
  if (r < 0.42) return rnd() < 0.5
  if (r < 0.7) return Array.from({ length: Math.floor(rnd() * 25) }, () => val(d + 1))
  const o: any = {}
  for (const k of ['id', 'label', 'title', 'text', 'col', 'row', 'from', 'to', 'cells', 'steps', 'nodes', 'edges', 'bullets', 'meter', 'parts', 'tone', 'status', 'icon', 'html', 'style', 'both', 'name', 'pick', 'date', 'done', 'more', 'states', 'transitions', 'initial', 'terminal', 'group', 'size', 'weight', 'bidirectional']) if (rnd() < 0.45) o[k] = val(d + 1)
  return o
}
const mess = (good: any) => (rnd() < 0.8 ? good : val(2))
const many = (n: number, f: (i: number) => any) => Array.from({ length: Math.floor(rnd() * n) }, (_, i) => (rnd() < 0.9 ? f(i) : val(2)))
function nearValid() {
  const type = pick(['map', 'flow', 'steps', 'cards', 'timeline', 'compare', 'statemachine', 'network'])
  const o: any = { type, title: mess('T ' + 'x'.repeat(Math.floor(rnd() * 120))), subtitle: mess('s'), source: mess(pick(['technical.md', 'nope.md', '../x.md', 'projects/a/b.md'])), html: '<b>x</b>' }
  if (type === 'flow' || type === 'steps') o.steps = many(16, (i) => ({ title: mess('Step ' + i), text: mess('t'.repeat(Math.floor(rnd() * 400))), icon: mess(pick(['flag', 'evil'])), status: mess(pick(['done', 'x'])), bullets: many(8, () => 'b'), html: '<img onerror=1>' }))
  if (type === 'map') {
    o.nodes = many(20, (i) => ({ id: mess('n' + (i % 9)), label: mess('Node ' + i), col: mess(Math.floor(rnd() * 8) - 1), row: mess(Math.floor(rnd() * 6)), status: mess('now') }))
    o.edges = many(24, () => ({ from: mess('n' + Math.floor(rnd() * 9)), to: mess('n' + Math.floor(rnd() * 9)), style: mess('dashed'), both: mess(true) }))
  }
  if (type === 'statemachine') {
    o.initial = mess('s' + Math.floor(rnd() * 9))
    o.states = many(16, (i) => ({ id: mess('s' + (i % 9)), label: mess('State ' + i), sub: mess('x'.repeat(Math.floor(rnd() * 40))), icon: mess(pick(['flag', 'evil'])), terminal: mess(rnd() < 0.3) }))
    o.transitions = many(22, () => ({ from: mess('s' + Math.floor(rnd() * 9)), to: mess('s' + Math.floor(rnd() * 9)), label: mess('go '.repeat(Math.floor(rnd() * 12))), style: mess(pick(['dashed', 'solid', 'wavy'])) }))
  }
  if (type === 'network') {
    o.nodes = many(22, (i) => ({ id: mess('n' + (i % 18)), label: mess('Node ' + 'x'.repeat(i)), group: mess(pick(['A', 'B', 'C', 'g' + (i % 11), ''])), icon: mess(pick(['db', 'evil'])), size: mess(pick(['sm', 'md', 'lg', 'xl'])) }))
    o.edges = many(30, () => ({ from: mess('n' + Math.floor(rnd() * 18)), to: mess('n' + Math.floor(rnd() * 18)), label: mess('l'), bidirectional: mess(rnd() < 0.3), both: mess(rnd() < 0.2), weight: mess(pick([0, 1, 2.5, 9, -3, Number.NaN])) }))
  }
  if (type === 'cards') o.cards = many(12, (i) => ({ title: mess('C' + i), text: mess('t'), more: many(6, () => 'm') }))
  if (type === 'timeline') o.items = many(16, (i) => ({ date: mess('d' + i), title: mess('I' + i), done: mess(true) }))
  if (type === 'compare') {
    o.columns = many(8, (i) => mess('col' + i))
    o.rows = many(12, (i) => ({ name: mess('R' + i), pick: mess(true), cells: many(8, () => pick<any>([{ text: 'a', meter: rnd() * 3 - 1 }, { parts: [{ text: 'p', tone: 'ok' }, null, 5] }, 'plain', null, { text: 'x', tone: 'evil' }])) }))
  }
  return o
}
let near = 0
function shape() {
  if (rnd() < 0.6) {
    near++
    return nearValid()
  }
  const o: any = { type: pick(TYPES) }
  for (const k of ['title', 'subtitle', 'source', 'next', 'steps', 'nodes', 'edges', 'cards', 'items', 'columns', 'rows', 'meter_note', 'html', 'states', 'transitions', 'initial']) if (rnd() < 0.6) o[k] = val(1)
  if (rnd() < 0.3) o.nodes = Array.from({ length: 20 }, (_, i) => ({ id: 'n' + (i % 7), label: 'L' + i, col: i % 3, row: i % 2 }))
  if (rnd() < 0.3) o.edges = [{ from: 'n1', to: 'n1' }, { from: 'n1', to: 'n2' }, { from: 'n2', to: 'n1' }, { from: 'n1', to: 'zz' }]
  return o
}

const ICONS = new Set<string>(X.EX_ICONS)
const STATUS = new Set<string>(X.EX_STATUS)
const TONES = new Set<string>(X.EX_TONES)
const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n)

/** Every invariant a drawn spec must keep; returns the broken ones. */
function check(out: any): string[] {
  const fails: string[] = []
  const cap = (s: unknown, n: number, where: string) => {
    if (typeof s !== 'string' || s.length > n) fails.push(`${where} over cap: ${String(s).slice(0, 40)}`)
  }
  const enumOk = (v: unknown, set: Set<string>, where: string) => {
    if (v !== null && !set.has(v as string)) fails.push(`${where} not in enum: ${v}`)
  }
  cap(out.title, L.title, 'title')
  if (!out.title) fails.push('empty title')
  cap(out.subtitle, L.subtitle, 'subtitle')
  cap(out.next, L.next, 'next')
  if (typeof out.source !== 'string') fails.push('source not a string')
  if (out.source && (!/^[\w./-]{1,120}\.md$/.test(out.source) || !exists(out.source))) fails.push('bad source ' + out.source)
  if (JSON.stringify(out).includes('"html"')) fails.push('html kept')
  if (out.steps) {
    if (!out.steps.length || out.steps.length > L.steps) fails.push('steps count ' + out.steps.length)
    for (const s of out.steps) {
      cap(s.title, L.stepTitle, 'step.title')
      cap(s.text, L.stepText, 'step.text')
      if (!Array.isArray(s.bullets) || s.bullets.length > L.bullets) fails.push('bullets>4')
      s.bullets.forEach((b: unknown) => cap(b, L.bullet, 'bullet'))
      enumOk(s.icon, ICONS, 'step.icon')
      enumOk(s.status, STATUS, 'step.status')
    }
  }
  if (out.type === 'map') {
    if (!out.nodes.length || out.nodes.length > L.nodes) fails.push('nodes count ' + out.nodes.length)
    const cells = new Set<string>()
    const ids = new Set<string>()
    for (const n of out.nodes) {
      const c = n.col + ',' + n.row
      if (cells.has(c)) fails.push('shared cell')
      cells.add(c)
      if (ids.has(n.id)) fails.push('duplicate id')
      ids.add(n.id)
      if (!Number.isInteger(n.col) || n.col < 0 || n.col > L.maxCol || !Number.isInteger(n.row) || n.row < 0 || n.row > L.maxRow) fails.push('cell out of grid')
      cap(n.label, L.label, 'label')
      cap(n.sub, L.sub, 'sub')
      cap(n.what, L.what, 'what')
      enumOk(n.status, STATUS, 'node.status')
    }
    if (out.edges.length > L.edges) fails.push('edges>16')
    const pairs = new Set<string>()
    for (const e of out.edges) {
      if (e.from === e.to) fails.push('self edge')
      if (!ids.has(e.from) || !ids.has(e.to)) fails.push('edge to a missing node')
      const k = [e.from, e.to].sort().join('>')
      if (pairs.has(k)) fails.push('dup edge')
      pairs.add(k)
      if (e.style !== 'solid' && e.style !== 'dashed') fails.push('edge style ' + e.style)
      if (typeof e.both !== 'boolean') fails.push('edge both')
    }
  }
  if (out.type === 'statemachine') {
    if (!out.states.length || out.states.length > L.states) fails.push('states count ' + out.states.length)
    const ids = new Set<string>()
    for (const st of out.states) {
      if (ids.has(st.id) || !/^[a-z0-9_-]{1,24}$/i.test(st.id)) fails.push('bad or duplicate state id ' + st.id)
      ids.add(st.id)
      cap(st.label, L.label, 'state.label')
      if (!st.label) fails.push('empty state label')
      cap(st.sub, L.sub, 'state.sub')
      enumOk(st.icon, ICONS, 'state.icon')
      if (typeof st.terminal !== 'boolean') fails.push('terminal not boolean')
    }
    if (!ids.has(out.initial)) fails.push('initial is not a state: ' + out.initial)
    if (out.transitions.length > L.transitions) fails.push('transitions>16')
    const seen = new Set<string>()
    for (const t of out.transitions) {
      if (!ids.has(t.from) || !ids.has(t.to)) fails.push('transition to a missing state')
      if (seen.has(t.from + '>' + t.to)) fails.push('duplicate transition')
      seen.add(t.from + '>' + t.to)
      cap(t.label, L.edgeLabel, 'transition.label')
      if (t.style !== 'solid' && t.style !== 'dashed') fails.push('transition style ' + t.style)
    }
  }
  if (out.type === 'network') {
    if (!out.nodes.length || out.nodes.length > L.netNodes) fails.push('network nodes count ' + out.nodes.length)
    const ids = new Set<string>()
    const groups = new Set<string>()
    for (const n of out.nodes) {
      if (ids.has(n.id) || !/^[a-z0-9_-]{1,24}$/i.test(n.id)) fails.push('bad or duplicate node id ' + n.id)
      ids.add(n.id)
      cap(n.label, L.label, 'node.label')
      cap(n.group, L.group, 'node.group')
      if (n.group) groups.add(n.group)
      enumOk(n.icon, ICONS, 'node.icon')
      if (!['sm', 'md', 'lg'].includes(n.size)) fails.push('node size ' + n.size)
    }
    if (groups.size > L.groups) fails.push('groups>8')
    if (out.edges.length > L.netEdges) fails.push('network edges>24')
    const pairs = new Set<string>()
    for (const e of out.edges) {
      if (e.from === e.to) fails.push('network self edge')
      if (!ids.has(e.from) || !ids.has(e.to)) fails.push('network edge to a missing node')
      const k = [e.from, e.to].sort().join('>')
      if (pairs.has(k)) fails.push('network dup edge')
      pairs.add(k)
      cap(e.label, L.edgeLabel, 'edge.label')
      if (typeof e.both !== 'boolean') fails.push('edge both')
      if (!finite(e.weight) || e.weight < 1 || e.weight > 5) fails.push('weight ' + e.weight)
    }
  }
  if (out.cards && (!out.cards.length || out.cards.length > L.cards)) fails.push('cards count ' + out.cards.length)
  if (out.items && (!out.items.length || out.items.length > L.items)) fails.push('items count ' + out.items.length)
  if (out.rows) {
    if (!out.columns.length || out.columns.length > L.columns) fails.push('cols ' + out.columns.length)
    if (!out.rows.length || out.rows.length > L.rows) fails.push('rows ' + out.rows.length)
    cap(out.meter_note, L.meterNote, 'meter_note')
    for (const r of out.rows) {
      if (r.cells.length > out.columns.length) fails.push('cells>cols')
      for (const c of r.cells) {
        cap(c.text, L.cell, 'cell')
        enumOk(c.tone, TONES, 'cell.tone')
        if (c.meter !== null && (!finite(c.meter) || c.meter < 0 || c.meter > 1)) fails.push('meter ' + c.meter)
        if (c.parts !== null && (!Array.isArray(c.parts) || c.parts.length > L.parts)) fails.push('parts')
      }
    }
  }
  return fails
}

/** A graph layout (statemachine · network): a finite size, one box per node and one path per edge, every box and path
 *  point inside the drawing, no two boxes overlapping, paths made of M/L/Q/C only, bands of elliptic arcs. */
function graphCheck(lay: any, nodes: number, edges: number): string[] {
  const fails: string[] = []
  if (!finite(lay.width) || !finite(lay.height) || lay.width <= 0 || lay.height <= 0) fails.push('graph size')
  if (lay.nodes.length !== nodes) fails.push('graph dropped a node')
  if (lay.edges.length !== edges) fails.push('graph dropped an edge')
  for (const n of lay.nodes) {
    if (![n.x, n.y, n.w, n.h].every(finite) || n.x < 0 || n.y < 0 || n.x + n.w > lay.width + 0.5 || n.y + n.h > lay.height + 0.5) fails.push('box outside the drawing ' + n.id)
  }
  for (let i = 0; i < lay.nodes.length; i++)
    for (let j = i + 1; j < lay.nodes.length; j++) {
      const a = lay.nodes[i], b = lay.nodes[j]
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) fails.push('boxes overlap: ' + a.id + ' ' + b.id)
    }
  for (const e of lay.edges) {
    if (!/^M[\d. LQC-]+$/.test(e.d) || !finite(e.lx) || !finite(e.ly)) fails.push('graph edge path ' + e.d)
    for (const v of e.d.match(/-?[\d.]+/g) || []) if (+v < -0.5 || +v > Math.max(lay.width, lay.height) + 0.5) fails.push('edge point outside the drawing ' + v)
  }
  for (const b of lay.bands) if (!/^M[\d. AL-]+$/.test(b.d)) fails.push('band path ' + b.d)
  return fails
}

/** Every spec the B1 fuzz drew; the render test below draws each one with the real React renderers. */
const DRAWN: { spec: any; raw?: string }[] = []

test('(B1) 1,400 fuzzed shapes: parse never throws, all caps hold, map geometry + code fallback never throw', () => {
  const fails: string[] = []
  let drawn = 0
  const byType: Record<string, number> = {}
  let mapEdges = 0
  let graphs = 0
  for (let i = 0; i < 1400; i++) {
    const sh = shape()
    const raw = rnd() < 0.5 ? JSON.stringify(sh) : sh
    let out: any
    try {
      out = parse(raw)
    } catch (e: any) {
      fails.push('parse threw: ' + e.message)
      continue
    }
    try {
      if (typeof X.codeFallback(raw) !== 'string') fails.push('fallback not a string')
    } catch (e: any) {
      fails.push('fallback threw: ' + e.message)
    }
    if (out === null) continue
    drawn++
    DRAWN.push({ spec: out, raw: typeof raw === 'string' ? raw : undefined })
    byType[out.type] = (byType[out.type] || 0) + 1
    fails.push(...check(out))
    if (out.type === 'statemachine' || out.type === 'network') {
      try {
        const net = out.type === 'network'
        const lay = net ? G.netLayout(out) : G.smLayout(out)
        graphs++
        fails.push(...graphCheck(lay, net ? out.nodes.length : out.states.length, net ? out.edges.length : out.transitions.length))
      } catch (e: any) {
        fails.push(out.type + ' layout threw: ' + e.message)
      }
    }
    if (out.type === 'map') {
      mapEdges += out.edges.length
      try {
        const lay = X.mapLayout(out)
        if (!finite(lay.width) || !finite(lay.height) || lay.width <= 0 || lay.height <= 0) fails.push('map size')
        if (lay.edges.length !== out.edges.length) fails.push('layout dropped a valid edge')
        for (const { geom } of lay.edges) if (!/^M[\d. HVC-]+$/.test(geom.d) || !finite(geom.mx) || !finite(geom.my)) fails.push('edge path ' + geom.d)
      } catch (e: any) {
        fails.push('mapLayout threw: ' + e.message)
      }
    }
  }
  assert.ok(near >= 300, `near-valid shapes: ${near} of 1,400 (need ≥30%)`)
  assert.ok(drawn >= 300, `drawn: ${drawn} (the parser must still accept most near-valid shapes)`)
  for (const t of X.EX_TYPES) assert.ok((byType[t] || 0) >= 20, `every type is exercised: ${JSON.stringify(byType)}`)
  // today: 577 near-valid, 514 drawn (map 97 · flow 155 · timeline 116 · cards 79 · compare 67), 97 map edges
  assert.ok(mapEdges >= 50, `map edges exercised: ${mapEdges}`)
  assert.ok(graphs >= 40, `statemachine + network layouts exercised: ${graphs}`)
  assert.deepEqual(fails.slice(0, 5), [], `${fails.length} failures`)
})

test('(B1) byte cap: a 13 KB block → null; exactly 12,288 UTF-8 bytes still parses; multibyte text counts in bytes', () => {
  assert.equal(parse(JSON.stringify({ type: 'flow', steps: [{ title: 'x'.repeat(13000) }] })), null)
  const shell = JSON.stringify({ type: 'flow', steps: [{ title: 'ok' }], subtitle: '' })
  const pad = (n: number) => shell.replace('"subtitle":""', `"subtitle":"${'s'.repeat(n)}"`)
  const exact = pad(X.EX_MAX_BYTES - shell.length)
  assert.equal(new TextEncoder().encode(exact).length, X.EX_MAX_BYTES)
  assert.ok(parse(exact), '12,288 bytes is allowed')
  assert.equal(parse(pad(X.EX_MAX_BYTES - shell.length + 1)), null, '12,289 bytes is not')
  // 6,200 × "é" (2 bytes each) is under 12,288 UTF-16 units but over the byte cap
  assert.equal(parse(JSON.stringify({ type: 'flow', steps: [{ title: 'é'.repeat(6200) }] })), null)
})

test('(B1) rich-block budget: the 5th rich block on one page falls back to code', () => {
  const ctx = { rich: { n: 0 } }
  const drawn: boolean[] = []
  for (let i = 0; i < 5; i++) {
    const spec = parse({ type: 'cards', cards: [{ title: 'a', text: 'b' }] })
    assert.ok(spec)
    drawn.push(X.claimRich(ctx))
  }
  assert.deepEqual(drawn, [true, true, true, true, false])
  assert.equal(X.EX_MAX_RICH, 4)
  // a separate doc gets its own budget; a ctx without a counter never blocks
  assert.equal(X.claimRich({ rich: { n: 0 } }), true)
  assert.equal(X.claimRich(null), true)
  assert.equal(X.claimRich({ rich: { n: Number.NaN } }), true, 'a broken counter restarts at 0')
})

test('(B2) the critique\'s crash inputs → null or safe', () => {
  assert.equal(parse('{"type":"flow","steps":"abc"}'), null)
  assert.equal(parse({ type: 'flow', steps: [null] }), null)
  assert.deepEqual(parse({ type: 'flow', steps: [{ title: 'a', bullets: 'x' }] }).steps[0].bullets, [])
  assert.equal(parse({ type: 'map', nodes: [null] }), null)
  for (const raw of [undefined, null, '', 'null', '[]', '"x"', '{', '{"type":"map"}', 5, true, [], () => 1, Symbol('x'), 10n, new Date(0)]) {
    assert.equal(parse(raw as any), null, String(typeof raw))
  }
})

test('total even for hostile objects: throwing getters, BigInt/Symbol fields, cycles', () => {
  const getter = { type: 'flow', get steps() { throw new Error('boom') } }
  assert.equal(parse(getter), null)
  assert.equal(parse({ type: 'map', nodes: [{ id: 'a', label: 'A', col: 10n }] }).nodes[0].col, 0, 'BigInt col → cell 0')
  assert.equal(parse({ type: 'map', nodes: [{ id: 'a', label: 'A', col: Symbol('c'), row: '2' }] }).nodes[0].row, 2, 'Symbol col → 0; "2" row → 2')
  const cyc: any = { type: 'cards', cards: [{ title: 'a' }] }
  cyc.self = cyc
  assert.ok(parse(cyc))
  assert.equal(X.codeFallback(cyc), '', 'a cycle cannot be shown as code; no throw')
  assert.equal(X.parseExplainer('{"type":"cards","cards":[{"title":"a"}],"source":"technical.md"}', { exists: () => { throw new Error('x') } }).source, '')
})

test('no html, unknown keys dropped, enums enforced, "steps" is an alias of flow, BOM tolerated', () => {
  const out = parse('\u{feff}' + JSON.stringify({ type: 'steps', html: '<b>x</b>', extra: 1, steps: [{ title: 'A', html: '<img>', icon: 'evil', status: 'x' }, { title: 'B', icon: 'flag', status: 'done' }] }))
  assert.equal(out.type, 'flow')
  assert.deepEqual(Object.keys(out), ['type', 'title', 'subtitle', 'source', 'next', 'steps'])
  assert.deepEqual(out.steps.map((s: any) => [s.icon, s.status]), [[null, null], ['flag', 'done']])
  assert.deepEqual(Object.keys(out.steps[0]), ['title', 'text', 'icon', 'status', 'bullets'])
  assert.equal(out.title, 'Explainer', 'missing title → "Explainer"')
})

test('source: kept only when it is a safe .md path that exists', () => {
  const src = (source: unknown) => parse({ type: 'cards', cards: [{ title: 'a' }], source }).source
  assert.equal(src('technical.md'), 'technical.md')
  assert.equal(src('projects/demo/notes.md'), 'projects/demo/notes.md')
  assert.equal(src('nope.md'), '', 'does not exist')
  for (const bad of ['../x.md', 'projects/../technical.md', './technical.md', '/technical.md', 'projects//a.md', 'technical.md ', 'technical.txt', 'a'.repeat(121) + '.md', 'javascript:x.md', 5, null]) {
    assert.equal(src(bad), '', String(bad))
  }
  assert.equal(X.parseExplainer({ type: 'cards', cards: [{ title: 'a' }], source: 'technical.md' }).source, '', 'no exists() → no source')
})

test('map: self edges, duplicate edges (either direction), shared cells and bad ids dropped; prototype-named ids are safe', () => {
  const out = parse({
    type: 'map',
    nodes: [
      { id: 'a', label: 'A', col: 0, row: 0 },
      { id: 'b', label: 'B', col: 1, row: 0, status: 'wait' },
      { id: 'c', label: 'C', col: 1, row: 0 }, // shares b's cell
      { id: 'a', label: 'A again', col: 2, row: 0 }, // duplicate id
      { id: 'bad id', label: 'X', col: 3, row: 0 },
      { id: 'd', label: '', col: 4, row: 0 }, // no label
      { id: 'constructor', label: 'Proto', col: 0, row: 1 },
      { id: 'big', label: 'Clamped', col: 99, row: -4 },
    ],
    edges: [
      { from: 'a', to: 'a' }, { from: 'a', to: 'b', label: 'sends' }, { from: 'b', to: 'a' }, { from: 'a', to: 'zz' },
      { from: 'toString', to: 'valueOf' }, { from: 'constructor', to: 'a', style: 'dashed', both: true }, { from: 'big', to: 'b' },
    ],
  })
  assert.deepEqual(out.nodes.map((n: any) => [n.id, n.col, n.row]), [['a', 0, 0], ['b', 1, 0], ['constructor', 0, 1], ['big', 5, 0]])
  assert.deepEqual(out.edges.map((e: any) => `${e.from}>${e.to}`), ['a>b', 'constructor>a', 'big>b'])
  const lay = X.mapLayout(out)
  assert.deepEqual(lay.legend, { both: true, dashed: true, statuses: ['wait'] })
  assert.deepEqual(lay.rows.find((r: any) => r.id === 'a').to, ['B', 'Proto'], 'a sends to b, and gets both-ways from constructor')
  assert.deepEqual(lay.lines, ['A → B: sends', 'Proto → A', 'Clamped → B'])
  assert.equal(lay.nodes.find((n: any) => n.node.id === 'b').dot, 'warn')
  assert.equal(lay.nodes.find((n: any) => n.node.id === 'a').dot, null)
  assert.equal(lay.width, 18 * 2 + 5 * 236 + 178)
  assert.deepEqual(X.mapLayout({ title: 'x', nodes: [], edges: [{ from: 'a', to: 'b' }] }).edges, [], 'layout is total too')
})

test('text: clipped with "…" (no split surrogate pair), control and bidi characters removed, numbers only when finite', () => {
  const out = parse({
    type: 'cards',
    title: 'x'.repeat(78) + '😀' + 'yy',
    subtitle: 'line\u0000one\nline\ttwo \u{202e}evil\u{2066}',
    next: 7,
    cards: [{ title: '  padded  ', text: Number.POSITIVE_INFINITY }, { title: '   ' }, { title: 3 }],
  })
  assert.equal(out.title, 'x'.repeat(78) + '…', 'the cut lands inside the emoji pair, so the whole pair goes')
  assert.equal(out.subtitle, 'line one line two evil')
  assert.equal(out.next, '7')
  assert.deepEqual(out.cards.map((c: any) => [c.title, c.text]), [['padded', ''], ['3', '']], 'whitespace-only title dropped')
})

test('compare: columns ≤5, rows ≤8, cells ≤ columns, meter clamped to 0–1, tones enforced, parts ≤3', () => {
  const out = parse({
    type: 'compare',
    columns: ['A', 'B', 'C', 'D', 'E', 'F'],
    meter_note: 'longer bar = money sooner',
    rows: Array.from({ length: 10 }, (_, i) => ({
      name: 'R' + i,
      pick: i === 0 ? true : 'yes',
      cells: [{ text: 'x', meter: 2 }, { text: 'y', meter: -1 }, { parts: [{ text: 'p', tone: 'ok' }, { text: 'q', tone: 'evil' }, null, { text: 'r' }, { text: 's' }] }, 'plain', { text: 't', tone: 'warn' }, 'extra'],
    })),
  })
  assert.equal(out.columns.length, 5)
  assert.equal(out.rows.length, 8)
  assert.deepEqual(out.rows.map((r: any) => r.pick), [true, false, false, false, false, false, false, false])
  const c = out.rows[0].cells
  assert.equal(c.length, 5)
  assert.deepEqual([c[0].meter, c[1].meter], [1, 0])
  assert.deepEqual(c[2].parts, [{ text: 'p', tone: 'ok' }, { text: 'q', tone: null }])
  assert.deepEqual(c[3], { text: 'plain', tone: null, meter: null, parts: null })
  assert.equal(c[4].tone, 'warn')
  assert.equal(parse({ type: 'compare', columns: [], rows: [{ name: 'a' }] }), null)
  assert.equal(parse({ type: 'compare', columns: ['a'], rows: [{ name: '' }] }), null)
})

test('code fallback: raw text clipped to 2,000 characters, objects as JSON, never throws', () => {
  assert.equal(X.codeFallback('{"type":'), '{"type":')
  assert.equal(X.codeFallback('x'.repeat(5000)).length, 2000)
  assert.equal(X.codeFallback({ a: 1 }), '{"a":1}')
  assert.equal(X.codeFallback(undefined), '')
  assert.equal(X.codeFallback(10n), '')
})

test('(B1) render never throws: every fuzzed spec through <Explainer> (React, server render), with and without a decision', async () => {
  assert.ok(DRAWN.length >= 300, 'the B1 fuzz ran first and drew specs')
  const [{ Explainer }] = await loadTsx(['components/explainers/Explainer.tsx'])
  const decide = { kind: 'decision', id: 'fuzz:decide', text: 'Pick one', project: 'demo' }
  const fails: string[] = []
  let compares = 0
  for (const [i, { spec, raw }] of DRAWN.entries()) {
    try {
      const html = renderToString(h(Explainer, { spec, raw, ctx: spec.type === 'compare' && i % 2 ? { decide } : null }))
      if (!html.includes('class="ex ex-' + spec.type)) fails.push(`#${i} ${spec.type}: no explainer markup`)
      // Data is text: escaped "<script>" or "javascript:" in text is fine; a real tag, handler attribute or js: URL is not.
      if (/<script|<img|<[^>]*\son[a-z]+\s*=|(?:href|src)="\s*javascript:/i.test(html)) fails.push(`#${i}: live markup from data`)
      if (spec.type === 'compare' && i % 2) {
        compares++
        if ((html.match(/data-next="fuzz:decide"/g) || []).length !== 1) fails.push(`#${i}: compare + decision must show ONE Next bar`)
      }
    } catch (e: any) {
      fails.push(`#${i} ${spec.type} threw: ${e && e.message}`)
    }
  }
  assert.ok(compares >= 20, 'compare + decision exercised: ' + compares)
  assert.deepEqual(fails.slice(0, 5), [], `${fails.length} render failures of ${DRAWN.length}`)
})

test('statemachine: ids, labels and moves cleaned; self-loops kept; a repeated move dropped (its way back kept); initial falls back', () => {
  const out = parse({
    type: 'statemachine',
    title: 'Orders',
    initial: 'ghost',
    states: [
      { id: 'new', label: 'New', icon: 'file', sub: 'cart saved' },
      { id: 'paid', label: 'Paid', terminal: 'yes' },
      { id: 'new', label: 'New again' }, // duplicate id
      { id: 'bad id', label: 'X' },
      { id: 'blank', label: '   ' },
      { id: 'constructor', label: 'Proto', terminal: true },
    ],
    transitions: [
      { from: 'new', to: 'paid', label: 'pay', style: 'wavy' },
      { from: 'new', to: 'paid', label: 'pay twice' }, // same direction again
      { from: 'paid', to: 'new', label: 'refund', style: 'dashed' }, // the way back is its own move
      { from: 'paid', to: 'paid', label: 'retry' }, // self-loop
      { from: 'new', to: 'zz' }, { from: 'toString', to: 'new' }, { from: 'constructor', to: 'new' },
    ],
  })
  assert.equal(out.initial, 'new', 'unknown initial → the first state')
  assert.deepEqual(out.states.map((s: any) => [s.id, s.terminal]), [['new', false], ['paid', false], ['constructor', true]])
  assert.deepEqual(out.transitions.map((t: any) => `${t.from}>${t.to}:${t.style}`), ['new>paid:solid', 'paid>new:dashed', 'paid>paid:solid', 'constructor>new:solid'])
  assert.equal(parse({ type: 'statemachine', states: [{ id: 'a' }] }), null, 'no labelled state → null')
  const lay = G.smLayout(out)
  assert.ok(lay.start, 'a start marker')
  assert.equal(lay.nodes.find((n: any) => n.id === 'new').start, true)
  assert.deepEqual(lay.lines, ['New → Paid: pay', 'Paid → New: refund', 'Paid → itself: retry', 'Proto → New'])
  assert.deepEqual(G.smLayout({ title: 'x', initial: 'a', states: [], transitions: [{ from: 'a', to: 'b' }] }).edges, [], 'layout is total too')
})

test('statemachine layout: up to 4 layers run left → right, a longer chain runs top → bottom', () => {
  const chain = (n: number) => parse({
    type: 'statemachine',
    states: Array.from({ length: n }, (_, i) => ({ id: 's' + i, label: 'Step ' + i })),
    transitions: Array.from({ length: n - 1 }, (_, i) => ({ from: 's' + i, to: 's' + (i + 1) })),
  })
  const short = G.smLayout(chain(4)), long = G.smLayout(chain(7))
  assert.ok(short.width > short.height, `4 layers lie down: ${short.width}×${short.height}`)
  assert.ok(long.height > long.width, `7 layers stand up: ${long.width}×${long.height}`)
})

test('network: self and repeated links dropped (either direction), bidirectional = both, weight clamped 1–5, a 9th group drawn ungrouped', () => {
  const out = parse({
    type: 'network',
    nodes: [
      ...Array.from({ length: 9 }, (_, i) => ({ id: 'g' + i, label: 'G' + i, group: 'Group ' + i, size: i === 0 ? 'lg' : 'huge' })),
      { id: 'x', label: 'X' }, { id: 'x', label: 'dup' }, { id: 'y', label: '' },
    ],
    edges: [
      { from: 'g0', to: 'g0' }, { from: 'g0', to: 'g1', bidirectional: true, weight: 9 }, { from: 'g1', to: 'g0', label: 'again' },
      { from: 'g1', to: 'x', both: true, weight: -2 }, { from: 'x', to: 'g2', weight: Number.NaN }, { from: 'x', to: 'nope' },
    ],
  })
  assert.equal(out.nodes.length, 10)
  assert.deepEqual(out.nodes.map((n: any) => n.size).slice(0, 2), ['lg', 'md'])
  assert.equal(out.nodes.find((n: any) => n.id === 'g8').group, '', 'the 9th group → ungrouped')
  assert.deepEqual(out.edges.map((e: any) => [`${e.from}>${e.to}`, e.both, e.weight]), [['g0>g1', true, 5], ['g1>x', true, 1], ['x>g2', false, 1]])
  const lay = G.netLayout(out)
  assert.equal(lay.groups.length, 8)
  assert.equal(lay.bands.length, 8, 'one band per group')
  assert.equal(lay.labels, true, '≤ 8 links: every label drawn')
  assert.deepEqual(lay.lines, ['G0 ↔ G1', 'G1 ↔ X', 'X → G2'])
})
