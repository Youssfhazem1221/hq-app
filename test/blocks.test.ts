// Module B (wave 2): rich blocks in markdown (BLOCKS, splitBlocks), the chart parser + renderers, the visuals
// (journey, beads, scatter, goal meter, week dots, heatmap, status board) and the contrast of their quiet marks.
// React parts load through a throwaway Vite server (test/tsx.ts) and render with react-dom/server. Synthetic data only.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createElement as h, Fragment } from 'react'
import { renderToString } from 'react-dom/server'
import { APP, app } from './helpers.ts'
import { loadTsx } from './tsx.ts'

const [B, C, J, BE, S, G, W, HM, SB] = await loadTsx([
  'components/blocks.tsx', 'components/charts.tsx', 'components/visuals/Journey.tsx', 'components/visuals/Beads.tsx',
  'components/visuals/Scatter.tsx', 'components/visuals/GoalMeter.tsx', 'components/visuals/WeekDots.tsx',
  'components/visuals/Heatmap.tsx', 'components/visuals/StatusBoard.tsx',
])
/** Server HTML without React's text separators (<!-- -->), so text reads as on screen. */
const html = (node: any) => renderToString(h('div', null, node)).replace(/<!-- -->/g, '')
const count = (s: string, re: RegExp) => (s.match(re) || []).length
const isCode = (s: string) => s.includes('code-fb')

// ---- splitBlocks ----

test('splitBlocks: chart + explainer fences in order, CRLF ok, other languages and unclosed fences stay markdown', () => {
  const md = 'Intro\r\n\r\n```chart\r\n{"a":1}\r\n```\r\n\r\nMiddle\n\n```js\nconst x = 1\n```\n\n```explainer  title\n{"b":2}\n```\nEnd\n\n```chart\n{"never closed"'
  const parts = B.splitBlocks(md)
  assert.deepEqual(parts.map((p: any) => p.kind), ['md', 'chart', 'md', 'explainer', 'md'])
  assert.equal(parts[1].src.trim(), '{"a":1}')
  assert.equal(parts[3].src.trim(), '{"b":2}')
  assert.ok(parts[2].text.includes('```js'), 'a js fence stays markdown')
  assert.ok(parts[4].text.includes('never closed'), 'an unclosed fence stays markdown')
  assert.deepEqual(B.splitBlocks(''), [])
  assert.deepEqual(B.splitBlocks('plain'), [{ kind: 'md', text: 'plain' }])
})

// ---- BLOCKS: budget, fallbacks ----

const GOOD_CHART = '{"type":"bar","title":"Hours","labels":["Mon","Tue"],"series":[{"name":"demo","data":[2,3]}]}'
const GOOD_EX = '{"type":"cards","title":"Ideas","cards":[{"title":"A"}]}'

test('(B1) BLOCKS: ≤4 rich blocks per ctx (charts + explainers share it); blocks that fail to parse show as code and do not count', () => {
  const ctx = B.newBlockCtx('notes/x.md')
  const out = [
    B.BLOCKS.chart(GOOD_CHART, ctx), // 1
    B.BLOCKS.explainer('{"type":"flow","steps":"abc"}', ctx), // code, not counted
    B.BLOCKS.explainer(GOOD_EX, ctx), // 2
    B.BLOCKS.chart('{not json', ctx), // code, not counted
    B.BLOCKS.explainer(JSON.stringify({ type: 'flow', steps: [{ title: 'x'.repeat(13000) }] }), ctx), // 13 KB → code
    B.BLOCKS.chart(GOOD_CHART, ctx), // 3
    B.BLOCKS.explainer(GOOD_EX, ctx), // 4
    B.BLOCKS.chart(GOOD_CHART, ctx), // 5th → code
    B.BLOCKS.explainer(GOOD_EX, ctx), // 6th → code
  ].map((n) => html(n))
  assert.deepEqual(out.map(isCode), [false, true, false, true, true, false, false, true, true])
  assert.equal(ctx.rich.n, 6, 'six blocks parsed; the last two were over budget')
  // a fresh ctx per render gives the same answer every render (StrictMode-safe)
  const again = B.newBlockCtx()
  assert.equal(isCode(html(B.BLOCKS.chart(GOOD_CHART, again))), false)
  // the code fallback is text, clipped
  const big = html(B.BLOCKS.chart('<script>alert(1)</script>' + 'x'.repeat(5000), B.newBlockCtx()))
  assert.ok(!big.includes('<script>'), 'escaped')
  assert.ok(big.length < 2600, 'clipped to 2,000 characters')
})

test('BLOCKS.explainer loads the renderer on demand (Suspense placeholder on the server), never the code', () => {
  const s = html(B.BLOCKS.explainer(GOOD_EX, B.newBlockCtx()))
  assert.ok(!isCode(s))
  assert.ok(s.includes('ex-loading') || s.includes('ex ex-cards'))
})

test('A throwing chart renderer stays inside its block: the Boundary fallback is the code (client), the parser rejects the known crash shapes', () => {
  // The A6 crash shape (rows [null]) and friends no longer reach the renderer at all.
  for (const bad of ['{"type":"table","columns":["a"],"rows":[null]}', '{"type":"bar","labels":"x","series":[]}', '{"type":"stat","stats":"x"}', '{"type":"progress","items":[{"label":"a"}]}', '{"type":"pie"}']) {
    assert.equal(C.parseChart(bad), null, bad)
    assert.ok(isCode(html(B.BLOCKS.chart(bad, B.newBlockCtx()))), bad)
  }
})

// ---- charts ----

test('parseChart: total, JSON contract kept, new keys validated (stacked, goal, min/max, colour slots)', () => {
  const spec = C.parseChart(JSON.stringify({
    type: 'bar', stacked: 'yes', title: 'T', html: '<b>x</b>', labels: Array.from({ length: 80 }, (_, i) => 'L' + i),
    series: [{ name: 'a', data: [1, '2', 'x', null, Infinity], color: 3 }, { name: 'b', data: [1], color: 9 }, { name: 'c', data: [1], color: 'red' }, null],
  }))
  assert.equal(spec.stacked, undefined, 'stacked only when true')
  assert.equal(spec.labels.length, 60)
  assert.deepEqual(spec.series[0].data.slice(0, 5), [1, 2, null, null, null])
  assert.equal(spec.series[0].color, 3)
  assert.equal(spec.series[1].color, undefined)
  assert.equal(spec.series[2].color, undefined)
  assert.equal(spec.series.length, 3)
  assert.equal((spec as any).html, undefined, 'unknown keys dropped')
  const line = C.parseChart({ type: 'line', labels: ['a', 'b'], series: [{ name: 's', data: [1, 2] }], goal: '10', min: 5, max: 1 })
  assert.equal(line.goal, 10)
  assert.equal(line.min, undefined, 'min/max only when max > min')
  assert.equal(C.parseChart('x'.repeat(20000)), null)
  for (const raw of [undefined, null, '', '[]', 5, true, Symbol('x'), 10n, () => 1]) assert.equal(C.parseChart(raw as any), null)
  const st = C.stacked({ labels: ['w1'], series: [{ name: 'demo', color: 2, data: [3] }], unit: 'h' })
  assert.equal(st.type, 'bar')
  assert.equal(st.stacked, true)
})

const CHARTS = [
  { type: 'bar', title: 'Grouped', labels: ['a', 'b', 'c'], series: [{ name: 'x', data: [1, -2, 3] }, { name: 'y', data: [2, null, 1] }] },
  { type: 'bar', stacked: true, title: 'Stacked', unit: 'h', labels: ['w1', 'w2'], series: [{ name: 'demo', color: 2, data: [3, 4] }, { name: 'solo', color: 3, data: [1, 0] }] },
  { type: 'bar', horizontal: true, labels: ['long label here', 'b'], series: [{ name: 'x', data: [5, 2] }] },
  { type: 'line', labels: ['a', 'b', 'c'], series: [{ name: 'one', data: [800, 850, 881] }], goal: 1000 },
  { type: 'line', labels: ['a', 'b', 'c'], series: [{ name: 'e', data: [3, 4, 3.5] }], min: 1, max: 5 },
  { type: 'line', labels: ['a'], series: [{ name: 'x', data: [1] }, { name: 'y', data: [null] }] },
  { type: 'stat', stats: [{ label: 'a', value: 3, delta: '+1' }, { label: 'b', value: 'ok', delta: '-2', good: false }] },
  { type: 'progress', items: [{ label: 'demo', value: 8, max: 10, color: 2 }, { label: 'zero', value: 0, max: 0 }] },
  { type: 'table', columns: ['a', 'b'], rows: [['x', 1], ['y', null]] },
]

test('every chart type draws: a Table toggle on plots, legend only for 2+ series, one tab stop per plot, colour = slot variable', () => {
  for (const raw of CHARTS) {
    const spec = C.parseChart(JSON.stringify(raw))
    assert.ok(spec, raw.type)
    const s = html(h(C.Chart, { spec }))
    assert.ok(s.startsWith('<div><figure class="viz'), raw.type)
    const plotted = raw.type === 'bar' || raw.type === 'line'
    assert.equal(s.includes('class="vtoggle"'), plotted, 'table toggle: ' + raw.type)
    if (plotted) {
      assert.equal(count(s, /tabindex="0"/g), 1, 'one tab stop: ' + raw.title)
      assert.equal(s.includes('class="legend"'), (raw.series as any[]).length >= 2, 'legend: ' + raw.title)
      assert.ok(!/fill="(?!var\(--viz-[1-8]\)|none|transparent)[^"]*"/.test(s.replace(/fill="currentColor"/g, '')), 'fills are slot variables only')
    }
  }
  const stackedHtml = html(h(C.Chart, { spec: C.parseChart(JSON.stringify(CHARTS[1])) }))
  assert.ok(stackedHtml.includes('var(--viz-2)') && stackedHtml.includes('var(--viz-3)'), 'series use their own slots')
  assert.ok(stackedHtml.includes('demo · 7 h'), 'stacked legend carries totals')
  assert.ok(html(h(C.Chart, { spec: C.parseChart(JSON.stringify(CHARTS[3])) })).includes('goal 1,000'))
})

test('chart fuzz: 600 random specs → parseChart never throws; every parsed spec renders', () => {
  let seed = 11
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]
  const val = (): any => pick([null, 0, -3, 1.5, 1e9, NaN, 'x', '<b>', '', true, [], {}, [1, 'a', null], 'NaN', '7'])
  const arr = (n: number, f: () => any) => Array.from({ length: Math.floor(rnd() * n) }, f)
  let drawn = 0
  const fails: string[] = []
  for (let i = 0; i < 600; i++) {
    const o: any = { type: pick(['bar', 'line', 'stat', 'progress', 'table', 'pie', null]) }
    if (rnd() < 0.8) o.labels = arr(30, () => pick(['a', 'b', 5, null, '']))
    if (rnd() < 0.8) o.series = arr(10, () => (rnd() < 0.9 ? { name: val(), data: arr(30, val), color: val() } : val()))
    if (rnd() < 0.3) o.stacked = rnd() < 0.5 ? true : val()
    if (rnd() < 0.3) o.horizontal = true
    if (rnd() < 0.3) Object.assign(o, { goal: val(), min: val(), max: val(), unit: pick(['h', '%', '$', 'followers', val()]) })
    if (rnd() < 0.5) o.stats = arr(10, () => ({ label: val(), value: val(), delta: pick(['+1', '-2', '0', val()]), good: val() }))
    if (rnd() < 0.5) o.items = arr(14, () => ({ label: val(), value: val(), max: val(), color: val() }))
    if (rnd() < 0.5) Object.assign(o, { columns: arr(14, val), rows: arr(20, () => (rnd() < 0.8 ? arr(14, val) : val())) })
    let spec: any
    try {
      spec = C.parseChart(rnd() < 0.5 ? JSON.stringify(o) : o)
    } catch (e: any) {
      fails.push('parse threw ' + e.message)
      continue
    }
    if (!spec) continue
    drawn++
    try {
      html(h(C.Chart, { spec }))
    } catch (e: any) {
      fails.push(`render threw (${spec.type}): ${e.message}`)
    }
  }
  assert.ok(drawn >= 100, 'drawn ' + drawn)
  assert.deepEqual(fails.slice(0, 5), [], fails.length + ' failures')
})

// ---- journey + beads ----

const DEMO = {
  path: 'projects/demo/project.md',
  data: {
    title: 'Demo', color: 2, owner: 'alice', members: ['bob'], started: '2026-10-01', goal: 'Ten weekly users',
    milestones: [
      ...Array.from({ length: 8 }, (_, i) => ({ text: 'Step ' + (i + 1), done: true, date: `2026-10-0${i + 1}` })),
      { text: 'Ask one tester a question' }, { text: 'Public page' },
    ],
    metrics: [{ date: '2026-10-14', followers: 881 }],
  },
}
const NEXT = { kind: 'milestone', id: 'ms:demo', text: 'Ask one tester a question', project: 'demo' }

test('Journey: done → NOW → later, one tab stop, NOW card = the Next bar (data-next, one button), goal, chips, colour slot', () => {
  const s = html(h(J.Journey, { project: DEMO, next: NEXT }))
  assert.equal(count(s, /class="jn done"/g), 8)
  assert.equal(count(s, /class="jn now"/g), 1)
  assert.equal(count(s, /class="jn later"/g), 1)
  assert.equal(count(s, /class="jn [a-z]+" style="[^"]*" tabindex="0"/g), 1, 'roving focus: one tab stop')
  assert.ok(/class="jn now"[^>]*tabindex="0"/.test(s), 'NOW holds the tab stop')
  assert.equal(count(s, /data-next="ms:demo"/g), 1)
  assert.ok(s.includes('Make it a to-do'), 'milestone → its one button')
  assert.equal(count(s, /class="btn primary/g), 1, 'one primary button')
  assert.ok(s.includes('journey pc2'), 'colour = validated slot class')
  assert.ok(s.includes('8 done') && s.includes('of 10 done'))
  assert.ok(s.includes('881') && s.includes('followers'), 'numbers chip')
  assert.ok(s.includes('alice · owner') && s.includes('+1'), 'people chip')
  assert.ok(s.includes('Ten weekly users'))
  assert.ok(s.includes('All 10 milestones'))
  assert.ok(s.includes('aria-label="Done · 1 Oct: Step 1"'), 'node label = state · date: text')
  // all done, no next → goal reached; no milestones → no track
  const done = { path: 'projects/solo/project.md', data: { title: 'Solo', color: 'x', goal: 'One page', milestones: [{ text: 'a', done: true }] } }
  const sd = html(h(J.Journey, { project: done, next: null }))
  assert.ok(sd.includes('Goal reached') && sd.includes('journey pc1'), 'bad colour → slot 1')
  const empty = html(h(J.Journey, { project: { path: 'projects/e/project.md', data: {} }, next: null }))
  assert.ok(!empty.includes('j-track') && !empty.includes('All 0'))
  assert.doesNotThrow(() => html(h(J.Journey, { project: null as any, next: undefined })))
})

test('Beads: ONE picture (role=img, spoken label), never buttons', () => {
  const s = html(h(BE.Beads, { project: DEMO, count: true }))
  assert.equal(count(s, /role="img"/g), 1)
  assert.ok(s.includes('aria-label="8 of 10 milestones done, next: Ask one tester a question"'))
  assert.equal(count(s, /class="bead done"/g), 8)
  assert.equal(count(s, /class="bead next"/g), 1)
  assert.ok(!/<button|tabindex/.test(s))
  assert.equal(html(h(BE.Beads, { project: { path: 'p', data: {} } })), '<div></div>', 'no milestones → nothing')
})

// ---- scatter ----

const OPTIONS = [
  { name: 'Support audits for online stores', paid_in: 'USD', first_money: '2–4 weeks', speed: 4, recommended: true, evidence: '✅ case study' },
  { name: 'Template packs', paid_in: 'USD', first_money: 'Jan–Feb 2027', evidence: '✅ signal · ⚠️ payouts' },
  { name: 'Small-business websites', first_money: '2–4 weeks', evidence: '💭 not researched' },
  { name: 'Order checks for sellers', first_money: '1–2 months', evidence: '✅ competitors · ⚠️ size' },
  { name: 'A cheap-food map site', first_money: 'months', speed: 1, evidence: '✅ peers earn $0' },
  { name: 'No data yet' },
]

test('Scatter: pick in accent, numbered dots, one tab stop, estimated speeds marked, missing options counted, Table twin', () => {
  const s = html(h(S.Scatter, { options: OPTIONS }))
  assert.equal(count(s, /class="spt[^"]*"/g), 5)
  assert.equal(count(s, /class="spt pick"/g), 1)
  assert.equal(count(s, /class="spt[^"]*est/g), 3, 'speeds parsed from first_money are marked estimated')
  assert.equal(count(s, /class="hit"[^>]*tabindex="0"/g), 1)
  assert.ok(s.includes('1 option has no speed or evidence yet.'))
  assert.ok(s.includes('Recommended') && s.includes('Other options') && s.includes('estimated speed'))
  assert.ok(s.includes('class="vtoggle"'))
  const picked = html(h(S.Scatter, { options: OPTIONS, pick: 2, onPick: () => {} }))
  assert.ok(/class="spt[^"]*picked/.test(picked) && picked.includes('your pick') && picked.includes('role="button"'))
  assert.ok(html(h(S.Scatter, { options: [] })).includes('No option has both a speed and evidence yet.'))
})

test('(B4) scatter labels never collide or leave the plot, from 300 to 1,400 px; under 480 px only the pick is labelled', async () => {
  const { scatterPoints } = await app('lib/auto-visuals')
  const sets = [
    scatterPoints(OPTIONS),
    // crowded: every option in the top-right cell and its neighbours
    scatterPoints(Array.from({ length: 8 }, (_, i) => ({ name: 'Option number ' + i + ' with a long name', speed: 3 + (i % 2), evidence: '✅ a', recommended: i === 3 }))),
  ]
  const charW = (s: string, bold: boolean) => s.length * (bold ? 7.1 : 6.7)
  for (const [si, points] of sets.entries()) {
    for (let W = 300; W <= 1400; W += 20) {
      const H = Math.max(230, Math.min(300, Math.round(W * 0.32)))
      const lay = S.layoutScatter(points, W, H)
      const boxes: { k: string; l: number; r: number; y: number }[] = []
      for (const d of lay.placed) {
        boxes.push({ k: 'dot' + d.p.rank, l: d.cx - d.r, r: d.cx + d.r, y: d.cy })
        if (d.label) {
          const w = charW(d.p.short, d.p.pick)
          const l = d.label.anchor === 'start' ? d.label.x : d.label.x - w
          boxes.push({ k: 'label' + d.p.rank, l, r: l + w, y: d.cy })
          assert.ok(l >= 0 && l + w <= W, `label inside the plot at ${W}px`)
          if (W < 480) assert.ok(d.p.pick, `only the pick is labelled at ${W}px`)
        }
      }
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]
          const b = boxes[j]
          if (a.k.startsWith('dot') && b.k.startsWith('dot')) continue // same-cell dots are spread, not labels
          if (Math.abs(a.y - b.y) < 14 && a.l < b.r && a.r > b.l) assert.fail(`${a.k} overlaps ${b.k} at ${W}px`)
        }
      // the real-shaped set always labels its pick; the crowded set may drop any label (tooltip + Table still say it)
      if (W >= 300 && si === 0) assert.ok(lay.placed.some((d: any) => d.p.pick && d.label), `the pick keeps its label at ${W}px`)
    }
  }
})

// ---- goal meter, week dots, heatmap, status board ----

test('GoalMeter: no goal = dashed "no goal yet" + Set a goal; with a goal = % of goal + meter; Set/Edit only with onSetGoal', () => {
  const none = html(h(G.GoalMeter, { value: 881, label: 'followers', onSetGoal: () => {} }))
  assert.ok(none.includes('goal-track none') && none.includes('no goal yet') && none.includes('Set a goal'))
  assert.ok(none.includes('No goal set yet'))
  const has = html(h(G.GoalMeter, { value: 881, label: 'followers', goal: 1000, color: 2 }))
  assert.ok(has.includes('88% of 1,000') && has.includes('width:88%') && has.includes('has-pc pc2'))
  assert.ok(!has.includes('<button'), 'read-only without onSetGoal')
  assert.ok(html(h(G.GoalMeter, { value: 1500, label: 'x', goal: 1000 })).includes('width:100%'), 'the bar caps at 100%')
  assert.ok(!html(h(G.GoalMeter, { value: 1, label: 'x', color: 12 })).includes('has-pc'), 'bad slot ignored')
})

test('WeekDots: 7 days, today ringed (default = last day so far), future dimmed, week start honoured, one spoken label', () => {
  const s = html(h(W.WeekDots, { counts: [0, 1, 0, 2, 3, null, null] }))
  assert.equal(count(s, /class="d[ "]/g), 7)
  assert.ok(/class="d today"[^>]*data-tipt="Thu · today: 3 check-ins"/.test(s))
  assert.equal(count(s, /dot fut/g), 2)
  assert.ok(s.includes('role="img"') && s.includes('Thu (today) 3'))
  assert.ok(html(h(W.WeekDots, { counts: [1, 0, 0, 0, 0, 0, 0], start: 'mon' })).includes('Mon (today)') === false)
  assert.ok(html(h(W.WeekDots, { counts: [1, null, null, null, null, null, null], start: 'mon' })).includes('Mon (today) 1'))
})

test('Heatmap: levels 0–4 from counts, future cells marked, dates in tooltips, spoken summary (no streaks)', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9, null, -1].map((c) => HM.heatLevel(c)), [0, 1, 2, 3, 4, 4, 0, 0])
  const s = html(h(HM.Heatmap, { cells: [0, 1, 2, 3, 4, 5, null], start: '2026-10-11', sample: true }))
  assert.equal(count(s, /<i data-l=/g), 7 + 5, '7 cells + 5 key swatches')
  assert.ok(s.includes('data-l="f"') && s.includes('11 Oct: no check-in') && s.includes('12 Oct: 1 check-in'))
  assert.ok(s.includes('1 weeks of check-ins, sample data: 5 days with a check-in, 15 in all') || s.includes('sample data: 5 days with a check-in, 15 in all'))
  assert.ok(!/streak/i.test(s))
})

test('StatusBoard: icon · name · line · state chip (icon + word); compact drops the line; statusFromText reads marks and words', () => {
  const items = [{ name: 'Index', line: 'Notes → search', icon: 'db', status: 'ok' }, { name: 'Bridge', line: 'Not tried', status: 'warn' }, { name: '' }]
  const s = html(h(SB.StatusBoard, { items }))
  assert.equal(count(s, /class="sb-i"/g), 2, 'nameless items dropped')
  assert.ok(s.includes('live') && s.includes('to check') && s.includes('Notes → search'))
  assert.ok(!html(h(SB.StatusBoard, { items, compact: true })).includes('Notes → search'))
  assert.deepEqual(['✅ live', '⚠️ check', '❌', '💭', 'done', 'todo', 'blocked', '', 'whatever', 5].map(SB.statusFromText), ['ok', 'warn', 'bad', 'idea', 'ok', 'warn', 'bad', null, null, null])
})

// ---- (B5) contrast of the quiet marks ----

test('(B5) later beads/nodes and context points (--mark-empty/--mark-ctx) are ≥3:1 on --raise and --pane, light and dark, under every accent tint', () => {
  const css = fs.readFileSync(path.join(APP, 'src', 'styles', 'tokens.css'), 'utf8')
  const block = (sel: RegExp) => (css.match(sel) || [])[1] || ''
  const light = block(/:root\{([\s\S]*?)\n\}/)
  const dark = block(/:root\[data-theme="dark"\]\{([\s\S]*?)\n\}/)
  // a surface is a hex, or color-mix(in oklab,#hex P%,var(--tint)) = that grey leaning toward the accent's hue
  const tints = [(light.match(/--accent:(#[0-9a-f]{6})/i) || [])[1], ...[...css.matchAll(/:root\[data-accent="\w+"\]\{--accent:(#[0-9a-f]{6})/gi)].map((m) => m[1])]
  assert.equal(tints.filter(Boolean).length, 6, 'six accent fills found')
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const toLab = (hex: string) => {
    const [r, g, b] = rgb(hex).map(lin)
    const [l, m, q] = [0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b].map(Math.cbrt)
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * q, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * q, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * q]
  }
  const fromLab = ([L, A, B]: number[]) => {
    const [l, m, q] = [L + 0.3963377774 * A + 0.2158037573 * B, L - 0.1055613458 * A - 0.0638541728 * B, L - 0.0894841775 * A - 1.291485548 * B].map((v) => v ** 3)
    const out = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * q, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * q, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * q]
    return '#' + out.map((v) => Math.round(Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)) * 255).toString(16).padStart(2, '0')).join('')
  }
  const values = (b: string, name: string): string[] => {
    const v = ((b.match(new RegExp('--' + name + ':([^;]+);')) || [])[1] || '').trim()
    if (/^#[0-9a-f]{6}$/i.test(v)) return [v]
    const m = v.match(/^color-mix\(in oklab,(#[0-9a-f]{6}) (\d+)%,var\(--tint\)\)$/i)
    if (!m) return []
    const [a, keep] = [toLab(m[1]), +m[2] / 100]
    return tints.map((t) => fromLab(a.map((x, i) => x * keep + toLab(t)[i] * (1 - keep))))
  }
  const get = (b: string, name: string) => values(b, name)[0]
  const lum = (hex: string) => {
    const c = rgb(hex).map(lin)
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }
  const rows: string[] = []
  for (const [theme, b] of [['light', light], ['dark', dark]] as const) {
    for (const mark of ['mark-empty', 'mark-ctx']) {
      for (const bg of ['raise', 'pane']) {
        const m = get(b, mark)
        const gs = values(b, bg)
        assert.ok(m && gs.length, `${theme} --${mark} / --${bg} found`)
        const r = Math.min(...gs.map((g) => ratio(m, g)))
        rows.push(`${theme} ${mark} on ${bg}: ${r.toFixed(2)}`)
        assert.ok(r >= 3, `${theme} --${mark} on --${bg} = ${r.toFixed(2)}:1`)
      }
    }
  }
  // today: light 3.36 (raise) / 3.13 (pane); dark 3.53 (raise) / 3.57 (pane)
  assert.equal(rows.length, 8)
})

test('Fragments of BLOCKS render side by side (keys belong to the caller)', () => {
  const ctx = B.newBlockCtx()
  const parts = B.splitBlocks('a\n\n```chart\n' + GOOD_CHART + '\n```\n\nb')
  const s = html(h(Fragment, null, parts.map((p: any, i: number) => (p.kind === 'md' ? h('p', { key: i }, p.text.trim()) : h(Fragment, { key: i }, B.BLOCKS[p.kind](p.src, ctx))))))
  assert.ok(s.includes('<p>a</p>') && s.includes('figure') && s.includes('<p>b</p>'))
})
