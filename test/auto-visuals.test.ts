// B3: auto visuals. `options:` → compare spec + scatter points (speed from `speed:` or parsed from first_money,
// evidence from the ✅ ⚠️ 💭 marks), project.md → journey strip model. Synthetic data always; the real private
// workspace (a string copy read in memory, never written) only when this runs inside it, so the public app repo
// holds no real content. Everything is total: junk in, safe result out.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { APP, app } from './helpers.ts'

const V = await app('lib/auto-visuals')
const { parse } = await app('lib/md')
const { EX_LIMITS } = await app('components/explainers/parse')

const doc = (data: unknown, p = 'notes/options.md') => ({ path: p, data, body: '' })
const OPTIONS = [
  { name: 'Audits for small shops', paid_in: 'USD', first_money: '2–4 weeks', evidence: '✅ own case study + public pricing', recommended: true },
  { name: 'Template packs for a holiday season', paid_in: 'USD', first_money: 'Jan–Feb 2027', evidence: '✅ marketplace signal · ⚠️ supply & payouts' },
  { name: 'Websites for local businesses', paid_in: 'EUR', first_money: '2–4 weeks', evidence: '💭 not researched yet' },
  { name: 'Order confirmation bots for sellers', paid_in: 'EUR', first_money: '1–2 months', evidence: '✅ competitors exist · ⚠️ problem size' },
  { name: 'A community price map', short: 'Price map', paid_in: 'EUR (slow)', first_money: 'months', evidence: '✅ 3 peer maps earn $0' },
]

// ---- speed ----

test('speedFromText: weeks → 4 · 1–2 months → 3 · a named month/date → 2 · months → 1 · nothing → null', () => {
  const cases: [unknown, number | null][] = [
    ['2–4 weeks', 4], ['3 weeks', 4], ['10 days', 4], ['6-8 wks', 4],
    ['1–2 months', 3], ['1-2 months', 3], ['1 to 2 months', 3], ['a month', 3], ['2 months', 3], ['2 mo', 3],
    ['Jan–Feb 2027', 2], ['by March', 2], ['Sept.', 2], ['Q3', 2], ['2027', 2],
    ['months', 1], ['3–6 months', 1], ['12 months', 1], ['a few months', 1], ['over a year', 1],
    ['Market dependent', null], ['Decide later', null], ['unknown', null], ['', null], [null, null], [42, null], [{}, null],
  ]
  for (const [text, want] of cases) assert.equal(V.speedFromText(text), want, String(text))
})

test('speedOf: explicit speed 1–4 wins (not estimated); otherwise parsed from first_money and flagged estimated', () => {
  assert.deepEqual(V.speedOf({ speed: 2, first_money: '2 weeks' }), { speed: 2, estimated: false })
  assert.deepEqual(V.speedOf({ speed: '3' }), { speed: 3, estimated: false })
  assert.deepEqual(V.speedOf({ speed: 7, first_money: '2 weeks' }), { speed: 4, estimated: true }, 'out-of-range speed ignored')
  assert.deepEqual(V.speedOf({ speed: 2.5, first_money: 'months' }), { speed: 1, estimated: true })
  assert.equal(V.speedOf({ first_money: 'someday' }), null)
  assert.equal(V.speedOf(null), null)
  assert.equal(V.speedOf('2 weeks'), null)
})

// ---- evidence ----

test('evidenceParts: split at ✅ ⚠️ 💭 into icon + words; a mark without words gets the default word', () => {
  assert.deepEqual(V.evidenceParts('✅ own case study + public pricing'), [{ text: 'own case study + public pricing', tone: 'ok' }])
  assert.deepEqual(V.evidenceParts('✅ marketplace signal · ⚠️ supply & payouts'), [{ text: 'marketplace signal', tone: 'ok' }, { text: 'supply & payouts', tone: 'warn' }])
  assert.deepEqual(V.evidenceParts('💭 not researched yet'), [{ text: 'not researched yet', tone: 'idea' }])
  assert.deepEqual(V.evidenceParts(['✅ a', '⚠ b (no VS16)']), [{ text: 'a', tone: 'ok' }, { text: 'b (no VS16)', tone: 'warn' }])
  assert.deepEqual(V.evidenceParts('✅'), [{ text: 'verified', tone: 'ok' }])
  assert.deepEqual(V.evidenceParts('mostly ✅ fine'), [{ text: 'mostly', tone: null }, { text: 'fine', tone: 'ok' }])
  assert.deepEqual(V.evidenceParts('plain note'), [{ text: 'plain note', tone: null }])
  for (const junk of [null, undefined, 5.5, {}, [null, {}], true]) assert.ok(Array.isArray(V.evidenceParts(junk)))
  assert.ok(V.evidenceParts('✅ x'.repeat(500)).length <= 6)
})

test('evidenceLevel: ✅ only = verified (3) · 💭 only = untested (1) · any mix = mixed (2) · no marks = null', () => {
  const lvl = (s: unknown) => V.evidenceLevel(V.evidenceParts(s))
  assert.equal(lvl('✅ a'), 3)
  assert.equal(lvl('✅ a · ✅ b'), 3)
  assert.equal(lvl('✅ a · ⚠️ b'), 2)
  assert.equal(lvl('⚠️ b'), 2)
  assert.equal(lvl('✅ a · 💭 b'), 2, '✅ + 💭 is not "✅ only"')
  assert.equal(lvl('💭 b'), 1)
  assert.equal(lvl('plain'), null)
  assert.equal(V.evidenceLevel(null), null)
  assert.deepEqual([V.EVIDENCE_LABEL[1], V.EVIDENCE_LABEL[2], V.EVIDENCE_LABEL[3]], ['untested', 'mixed', 'verified'])
})

// ---- scatter ----

test('scatterPoints: one point per placeable option, rank = position in the doc, pick = recommended', () => {
  const pts = V.scatterPoints(OPTIONS)
  assert.deepEqual(pts.map((p: any) => [p.rank, p.speed, p.evidence, p.pick, p.estimated]), [
    [1, 4, 3, true, true], [2, 2, 2, false, true], [3, 4, 1, false, true], [4, 3, 2, false, true], [5, 1, 3, false, true],
  ])
  assert.deepEqual(pts.map((p: any) => p.short), ['Audits', 'Template packs', 'Websites', 'Order confirmation', 'Price map'])
  assert.equal(pts[0].label, '#1 Audits for small shops: first money 2–4 weeks (estimated), evidence verified, recommended')
  assert.deepEqual([pts[1].paidIn, pts[1].firstMoney], ['USD', 'Jan–Feb 2027'])
  const explicit = V.scatterPoints(OPTIONS.map((o, i) => ({ ...o, speed: [4, 2, 4, 3, 1][i] })))
  assert.ok(explicit.every((p: any) => !p.estimated), 'explicit speed: is not an estimate')
  assert.deepEqual(explicit.map((p: any) => p.speed), [4, 2, 4, 3, 1])
})

test('scatterPoints: unplaceable options are left out but keep everyone\'s rank; ≤8; junk → []', () => {
  const pts = V.scatterPoints([
    { name: 'A', first_money: '2 weeks', evidence: '✅ x' },
    { name: 'B', first_money: '2 weeks', evidence: 'no marks' },
    { name: 'C', first_money: 'someday', evidence: '✅ x' },
    { name: 'D', first_money: 'months', evidence: '💭' },
  ])
  assert.deepEqual(pts.map((p: any) => [p.rank, p.name]), [[1, 'A'], [4, 'D']])
  const many = Array.from({ length: 12 }, (_, i) => ({ name: 'O' + i, first_money: '2 weeks', evidence: '✅' }))
  assert.equal(V.scatterPoints(many).length, V.MAX_OPTIONS)
  assert.deepEqual(V.scatterPoints([null, { first_money: '2 weeks', evidence: '✅' }]).map((p: any) => [p.rank, p.name]), [[1, 'Option 1']], 'junk entries skipped before ranking; nameless → "Option n"')
  for (const junk of [null, undefined, 'x', 5, {}, [null, 5, true, []]]) assert.deepEqual(V.scatterPoints(junk), [])
})

// ---- compare ----

test('optionsSpec: the auto compare block (rank order, recommended pick, speed meter, evidence chips, source)', () => {
  const spec = V.optionsSpec(doc({ title: 'Ways to earn', next: 'Pick one: #1, #2, both, or other', options: OPTIONS }))
  assert.equal(spec.type, 'compare')
  assert.equal(spec.title, '5 options, side by side')
  assert.equal(spec.source, 'notes/options.md')
  assert.equal(spec.next, 'Pick one: #1, #2, both, or other')
  assert.equal(spec.meter_note, 'longer bar = money sooner')
  assert.deepEqual(spec.columns, ['Paid in', 'First money', 'Evidence'])
  assert.deepEqual(spec.rows.map((r: any) => [r.name, r.pick]), OPTIONS.map((o, i) => [o.name, i === 0]))
  assert.deepEqual(spec.rows[0].cells[0], { text: 'USD', tone: null, meter: null, parts: null })
  assert.deepEqual(spec.rows.map((r: any) => r.cells[1].meter), [1, 0.5, 1, 0.75, 0.25])
  assert.deepEqual(spec.rows[1].cells[2].parts, [{ text: 'marketplace signal', tone: 'ok' }, { text: 'supply & payouts', tone: 'warn' }])
})

test('optionsSpec: other scalar fields become columns (≤5, evidence kept last); ≤8 rows; bare names or junk → null', () => {
  const opts = [
    { name: 'A', paid_in: 'USD', first_money: '2 weeks', cost: 'low', risk: 'medium', team: 2, evidence: '✅ x', flag: true, notes: ['a'] },
    { name: 'B', paid_in: 'USD', first_money: 'someday', cost: 'high' },
  ]
  const spec = V.optionsSpec(doc({ options: opts }))
  assert.deepEqual(spec.columns, ['Paid in', 'First money', 'Cost', 'Risk', 'Evidence'])
  assert.deepEqual(spec.rows[1].cells.map((c: any) => c.text), ['USD', 'someday', 'high', '', ''])
  assert.equal(spec.rows[1].cells[1].meter, null, 'unknown speed → no meter')
  assert.equal(spec.title, '2 options, side by side')
  const twelve = V.optionsSpec(doc({ options: Array.from({ length: 12 }, (_, i) => ({ name: 'O' + i, paid_in: 'USD' })) }))
  assert.equal(twelve.rows.length, EX_LIMITS.rows)
  assert.equal(twelve.title, '8 options, side by side')
  const one = V.optionsSpec(doc({ options: [{ name: 'Solo', first_money: '2 weeks' }] }))
  assert.deepEqual([one.title, one.columns, one.rows[0].cells[0].meter], ['1 option, side by side', ['First money'], 1])
  assert.equal(V.optionsSpec(doc({ options: ['Bare name', 'Other'] })), null)
  for (const junk of [null, undefined, {}, { data: null }, doc('x'), doc({ options: 'x' }), doc({ options: [null, 5, true] }), doc({ options: [] })]) {
    assert.equal(V.optionsSpec(junk as any), null)
  }
  assert.equal(V.optionsSpec({ path: 5, data: { options: OPTIONS } }).source, '', 'no path → no source link')
})

// ---- journey ----

/** 10 milestones: 6 done, 1 open, 2 done, 1 open (the same shape as a real project with two gaps). */
const PROJECT = {
  path: 'projects/demo/project.md',
  body: '',
  data: {
    title: 'Demo', owner: 'alice', members: ['alice', 'bob', 'Bob', 'carol', null], color: 2, started: '2026-10-01', goal: 'Shipped to a friend',
    metrics: [{ date: '2026-10-01', followers: 800 }, { date: '2026-10-14', source: 'manual', followers: 881, views_7d: 27 }],
    metric_labels: { followers: 'Followers' },
    milestones: [
      ...['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map((t) => ({ text: t, date: '2026-10-14', done: true })),
      { text: 'Ship the beta', done: false },
      { text: 'Eight', date: '2026-10-14', done: true },
      { text: 'Nine', date: '2026-10-15', done: true },
      { text: 'Friend accepts', done: false },
    ],
  },
}

test('journeyModel: done (file order) → NOW (first open) → later; fill, label spot, caret, roving focus, chips', () => {
  const next = { kind: 'milestone', id: 'ms:demo', text: 'Ship the beta to one friend', project: 'demo' }
  const j = V.journeyModel(PROJECT, next)
  assert.equal(j.slug, 'demo')
  assert.equal(j.title, 'Demo')
  assert.deepEqual([j.total, j.done, j.nowK, j.focusK], [10, 8, 8, 8])
  assert.deepEqual(j.nodes.map((n: any) => n.index), [0, 1, 2, 3, 4, 5, 7, 8, 6, 9])
  assert.deepEqual(j.nodes.map((n: any) => n.kind), ['done', 'done', 'done', 'done', 'done', 'done', 'done', 'done', 'now', 'later'])
  assert.equal(j.nodes[8].text, 'Ship the beta')
  assert.deepEqual([j.nodes[0].pos, j.nodes[9].pos, j.fill, j.doneAt, j.nowX], [4, 96, 85.78, 39.78, 85.78])
  assert.deepEqual([j.nodes[7].tip, j.nodes[8].tip, j.nodes[9].tip], ['Done · 15 Oct', 'Now', 'Later'])
  assert.equal(j.nodes[8].label, 'Now: Ship the beta')
  assert.equal(j.next, next, 'the NOW card item is passed through untouched')
  assert.equal(j.goalReached, false)
  assert.deepEqual(j.beads, ['done', 'done', 'done', 'done', 'done', 'done', 'next', 'done', 'done', 'later'])
  assert.equal(j.beadsLabel, '8 of 10 milestones done, next: Ship the beta')
  assert.equal(j.trackLabel, '8 of 10 milestones done. Use arrow keys to read them.')
  assert.deepEqual(j.milestones[6], { index: 6, text: 'Ship the beta', date: null, dateLabel: null, state: 'next' })
  assert.deepEqual([j.color, j.goal, j.started, j.startedLabel], [2, 'Shipped to a friend', '2026-10-01', '1 Oct'])
  assert.deepEqual([j.owner, j.members], ['alice', ['bob', 'carol']])
  assert.deepEqual(j.metric, { key: 'followers', value: 881, label: 'Followers', goal: null })
  const withGoal = V.journeyModel({ ...PROJECT, data: { ...PROJECT.data, goal_views_7d: 50 } })
  assert.deepEqual(withGoal.metric, { key: 'views_7d', value: 27, label: 'Views 7d', goal: 50 }, 'a metric with a goal wins')
})

test('journeyModel: all done, one milestone, none, legacy path; goal reached only with nothing next', () => {
  const allDone = { path: 'projects/solo.md', data: { milestones: ['a', 'b', 'c'].map((t) => ({ text: t, done: true })) } }
  const j = V.journeyModel(allDone, null)
  assert.deepEqual([j.slug, j.nowK, j.fill, j.focusK, j.nowX, j.doneAt, j.goalReached], ['solo', -1, 100, 2, 92, 50, true])
  assert.equal(j.beadsLabel, '3 of 3 milestones done')
  assert.equal(V.journeyModel(allDone, { kind: 'milestone', id: 'x', text: 'keep going' }).goalReached, false)
  const one = V.journeyModel({ path: 'projects/x/project.md', data: { milestones: [{ text: 'Only', done: false }] } })
  assert.deepEqual([one.nodes[0].pos, one.nowK, one.fill, one.doneAt, one.nowX], [50, 0, 50, null, 50])
  assert.equal(one.beadsLabel, '0 of 1 milestone done, next: Only')
  const none = V.journeyModel({ path: 'notes/x.md', data: {} })
  assert.deepEqual([none.slug, none.total, none.nodes, none.fill, none.focusK, none.nowX, none.goalReached], ['', 0, [], 0, -1, 50, false])
})

test('journeyModel: total on junk; strict done; dates; colour slot only 1–8', () => {
  for (const junk of [null, undefined, 5, 'x', {}, { data: null }, { data: 5 }, { path: 5, data: { milestones: 'x', metrics: 5, members: 'x', color: {} } }]) {
    const j = V.journeyModel(junk as any)
    assert.ok(Array.isArray(j.nodes) && Array.isArray(j.beads) && Array.isArray(j.members))
  }
  const j = V.journeyModel({ path: 'projects/p/project.md', data: { milestones: [null, 5, {}, { text: {} }, 'plain', { text: 'x', done: 'false' }, { text: 'y', done: 'yes' }, { text: 'z', date: new Date('2026-01-05T00:00:00Z'), done: true }, { text: 'w', date: '2026-13-01' }] } })
  assert.deepEqual(j.milestones.map((m: any) => [m.index, m.text, m.state, m.dateLabel]), [
    [1, '5', 'next', null], [4, 'plain', 'later', null], [5, 'x', 'later', null], [6, 'y', 'done', null], [7, 'z', 'done', '5 Jan'], [8, 'w', 'later', null],
  ])
  const getter = { path: 'projects/p/project.md', get data(): any { throw new Error('boom') } }
  assert.equal(V.journeyModel(getter, null).total, 0, 'a throwing doc still gives the empty model')
  assert.deepEqual([1, 8, '3', 9, 0, 2.5, -1, 'x', null].map(V.colorSlot), [1, 8, 3, 1, 1, 1, 1, 1, 1])
  assert.deepEqual(['2026-10-14', '2026-01-05T10:00:00Z', '2026-02-30', 'x', 5].map(V.dateLabel), ['14 Oct', '5 Jan', '30 Feb', null, null])
})

// ---- fuzz: every auto visual is total ----

test('500 random shapes: optionsSpec, scatterPoints, journeyModel never throw and keep their caps', () => {
  let seed = 11
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)]
  const val = (d = 0): any => {
    const r = rnd()
    if (d > 3 || r < 0.15) return pick([null, undefined, 'x', 0, -1, 9, true, '2–4 weeks', '✅ a · ⚠️ b', '💭', 'Jan 2027', 'months', '2026-10-14', 'a'.repeat(300)])
    if (r < 0.45) return Array.from({ length: Math.floor(rnd() * 14) }, () => val(d + 1))
    const o: any = {}
    for (const k of ['name', 'title', 'text', 'done', 'date', 'speed', 'first_money', 'paid_in', 'evidence', 'recommended', 'pick', 'short', 'cost', 'milestones', 'metrics', 'members', 'owner', 'color', 'goal', 'started', 'followers', 'metric_labels', '__proto__', 'constructor']) if (rnd() < 0.35) o[k] = val(d + 1)
    return o
  }
  const fails: string[] = []
  for (let i = 0; i < 500; i++) {
    const data = rnd() < 0.7 ? { options: val(1), milestones: val(1), metrics: val(1), members: val(1), color: val(2), owner: val(2) } : val()
    const d = { path: pick(['projects/a/project.md', 'x.md', 5, undefined]), data }
    try {
      const spec = V.optionsSpec(d)
      if (spec && (spec.rows.length > EX_LIMITS.rows || spec.columns.length > EX_LIMITS.columns || spec.rows.some((r: any) => r.cells.length > spec.columns.length))) fails.push('compare caps')
      const pts = V.scatterPoints(data && data.options)
      if (pts.some((p: any) => p.rank < 1 || p.rank > V.MAX_OPTIONS || ![1, 2, 3, 4].includes(p.speed) || ![1, 2, 3].includes(p.evidence))) fails.push('scatter ranges')
      const j = V.journeyModel(d, rnd() < 0.5 ? null : { id: 'n' })
      if (j.nodes.length !== j.total || j.beads.length !== j.total || j.done > j.total) fails.push('journey counts')
      if (![j.fill, j.nowX, ...j.nodes.map((n: any) => n.pos)].every((x) => Number.isFinite(x) && x >= 0 && x <= 100)) fails.push('journey positions')
      if (j.color < 1 || j.color > 8) fails.push('colour slot')
    } catch (e: any) {
      fails.push('threw: ' + e.message)
    }
  }
  assert.deepEqual(fails.slice(0, 5), [], `${fails.length} failures`)
})

// ---- the real workspace (B3), read-only string copies; skipped outside the private repo ----

const ROOT = path.resolve(APP, '..')
function realDoc(dir: string, file: (name: string) => string, keep: (d: any) => boolean) {
  const full = path.join(ROOT, dir)
  if (!fs.existsSync(full)) return null
  for (const name of fs.readdirSync(full).sort()) {
    const rel = `${dir}/${file(name)}`
    const abs = path.join(ROOT, rel)
    if (!rel.endsWith('.md') || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue
    const d = parse(rel, fs.readFileSync(abs, 'utf8'))
    if (keep(d)) return d
  }
  return null
}
// The one investigation whose frontmatter lists options, and the HQ app's own project (found by content, so no
// private names or paths are written here).
const money = realDoc('investigations', (n) => n, (d) => Array.isArray(d.data.options) && d.data.options.length >= 5)
const hq = realDoc('projects', (n) => `${n}/project.md`, (d) => d.data.title === 'HQ dashboard')

test('(B3) real options frontmatter: 5 points; #1 = fast + verified + recommended, #3 = fast + untested, #5 = slow + verified', { skip: !money && 'private workspace not available' }, () => {
  const pts = V.scatterPoints(money!.data.options)
  assert.equal(pts.length, 5)
  assert.deepEqual([pts[0].rank, pts[0].speed, pts[0].evidence, pts[0].pick], [1, 4, 3, true])
  assert.deepEqual([pts[2].rank, pts[2].speed, pts[2].evidence, pts[2].pick], [3, 4, 1, false])
  assert.deepEqual([pts[4].rank, pts[4].speed, pts[4].evidence], [5, 1, 3])
  // with or without explicit `speed:` keys, the parsed first_money agrees with them
  const parsed = V.scatterPoints(money!.data.options.map(({ speed, ...o }: any) => o))
  assert.deepEqual(parsed.map((p: any) => p.speed), pts.map((p: any) => p.speed))
  assert.ok(parsed.every((p: any) => p.estimated))
  const spec = V.optionsSpec(money)
  assert.equal(spec.rows.length, 5)
  assert.deepEqual(spec.columns, ['Paid in', 'First money', 'Evidence'])
  assert.equal(spec.source, money!.path)
  assert.equal(spec.rows.filter((r: any) => r.pick).length, 1)
})

// Real data changes (milestones get ticked), so the expectations come from the file itself.
test('(B3) real HQ project.md: done / NOW / later match its milestones', { skip: !hq && 'private workspace not available' }, () => {
  const j = V.journeyModel(hq, null)
  const ms: any[] = (hq as any).data.milestones || []
  const open = ms.filter((m) => !m.done)
  assert.equal(j.total, ms.length)
  assert.equal(j.done, ms.length - open.length)
  if (open.length) {
    assert.equal(j.nodes[j.nowK].text, String(open[0].text))
    assert.equal(j.nodes.filter((n: any) => n.kind === 'later').length, open.length - 1)
  }
})
