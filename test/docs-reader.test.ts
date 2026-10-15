// Module C2 · Docs reader + Explain panel: long-doc outline (first 3 sections open, the rest collapsed with a one-line
// summary), tables (✅/⚠️ State tables → status board, 3+ columns = "wide" → phone cards), the auto compare with ONE
// Decide when my open decision links the doc, and the Explain panel's layout. The page is rendered to completion
// (lazy explainer chunks resolved) on the synthetic team plus synthetic notes. Synthetic data only.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createElement as h } from 'react'
import { app, fixture } from './helpers.ts'
import { testServer } from './tsx.ts'

const rc = await app('lib/read-core')
const hq = await app('lib/hq')
const fx = await fixture()

const MAP = '{"type":"map","title":"How demo works","subtitle":"Notes feed the app.","nodes":[{"id":"a","label":"Notes","col":0,"row":0},{"id":"b","label":"App","col":2,"row":0},{"id":"c","label":"Search","col":4,"row":0}],"edges":[{"from":"a","to":"b","label":"reads"},{"from":"b","to":"c","label":"asks"}]}'
const LONG = [
  '---', 'title: Long reference', 'status: active', 'summary: A long synthetic page.', 'updated: 2026-10-16', '---', '',
  '# Long reference', '',
  '**The short version.** Everything below is made up for the test.', '',
  '## 🚦 At a glance', '',
  '| Piece | What it does | State |', '|---|---|---|',
  '| 🧠 Index | finds notes | ✅ live: 3 files |',
  '| ⚡ Stream | first words fast | ✅ live |',
  '| 🤖 Bridge | flagged posts | ✅ trusted · ⚠️ no real post yet |', '',
  '## Steps', '',
  'Who does what, in order.', '',
  '| # | Who | Step | How |', '|---|---|---|---|',
  '| 1 | alice | Ship the demo | push |',
  '| 2 | bob | Test on a phone | the Android build |', '',
  '## How it flows', '',
  '```explainer', MAP, '```', '',
  ...Array.from({ length: 9 }, (_, i) => [`## Part ${i + 4}`, '', `Text for part ${i + 4}. More words follow here.`, '', '| Key | Value |', '|---|---|', '| a | b |', '']).flat(),
].join('\n')

const OPTIONS_DOC = [
  '---', 'title: Ways to earn', 'options:',
  '  - name: Audits for small shops', '    paid_in: USD', '    first_money: 2–4 weeks', '    evidence: ✅ own case study', '    recommended: true',
  '  - name: Template packs', '    paid_in: USD', '    first_money: Jan–Feb 2027', '    evidence: ✅ marketplace signal · ⚠️ payouts',
  '  - name: Local websites', '    paid_in: EUR', '    first_money: months', '    evidence: 💭 not researched yet',
  '---', '', '# Ways to earn', '', 'Three made-up options.', '',
].join('\n')
const DECISION = ['---', 'id: 20261017-090000-bob-d1x', 'title: "Pick an option for demo"', 'status: todo', 'owner: alice', 'created: 2026-10-17T09:00:00Z', 'by: bob',
  'project: demo', 'link: notes/options.md', '---', ''].join('\n')
const EXPLAIN_Q = ['---', 'id: 20261017-100000-alice-e1x', 'author: alice', 'created: 2026-10-17T10:00:00Z', 'kind: summarize', 'target: notes/long.md', '---', '',
  rc.explainQuestion('Long reference', 'notes/long.md')].join('\n')
const EXPLAIN_A = ['---', 'id: 20261017-100000-alice-e1x', 'request: 20261017-100000-alice-e1x', 'created: 2026-10-17T10:00:09Z', 'status: done', 'seconds: 9', '---', '',
  'The demo is three parts that hand notes to each other.', '', '```explainer', MAP, '```', '',
  '- Notes are plain files.', '- The app reads them.', '- Search answers questions.', '- A fourth bullet waits behind "1 more".', '',
  '**Next:** Read the Steps section.', '', '---', '**Sources**', '- 📄 [notes/long.md](../../notes/long.md)', ''].join('\n')

// ---- pure rules ----

test('docOutline: intro, ## sections with unique ids and one-line summaries, long from 6 sections', () => {
  const o = rc.docOutline(LONG.replace(/^---[\s\S]*?\n---\n/, '').replace(/^\s*#\s+.*\n/, ''))
  assert.match(o.intro, /^\*\*The short version\.\*\*/)
  assert.equal(o.sections.length, 12)
  assert.equal(o.long, true)
  assert.equal(new Set(o.sections.map((s: any) => s.id)).size, 12)
  assert.equal(o.sections[0].id, 'sec-at-a-glance')
  assert.equal(o.sections[1].summary, 'Who does what, in order.')
  assert.equal(o.sections[0].summary, '', 'a table-only section has no prose summary')
  assert.equal(o.sections[5].summary, 'Text for part 6.')
  assert.equal(rc.docOutline('## a\n\n## b\n').long, false)
  assert.equal(rc.docOutline('```\n## not a heading\n```\n').sections.length, 0, 'fenced code is not split')
  assert.equal(rc.headingText('🚦 v2 **at** a glance'), 'v2 at a glance')
  assert.equal(rc.OPEN_SECTIONS, 3)
})

test('tables: State columns with marks → status rows (worst mark wins); evidence and plain tables stay tables', () => {
  const parts = rc.splitTables(LONG)
  const tables = parts.filter((p: any) => p.kind === 'table')
  assert.equal(tables.length, 11)
  const rows = rc.statusRows(tables[0].table)
  assert.deepEqual(rows.map((r: any) => [r.name, r.word, r.worst]), [['Index', 'live', 'ok'], ['Stream', 'live', 'ok'], ['Bridge', '', 'warn']])
  assert.equal(rows[0].line, 'finds notes')
  assert.equal(rc.statusRows(tables[1].table), null, 'no State column')
  assert.equal(rc.isWide(tables[1].table), true)
  assert.equal(rc.isWide(tables[2].table), false)
  const evidence = rc.splitTables('| Parameter | Value | Source |\n|---|---|---|\n| Place | X | ✅ a profile |\n| Tools | Y | ✅ chat |')[0].table
  assert.equal(rc.statusRows(evidence), null, 'a "Source" column of ✅ marks is evidence, not status')
  const halfMarked = rc.splitTables('| Piece | State |\n|---|---|\n| A | ✅ ok |\n| B | soon |')[0].table
  assert.equal(rc.statusRows(halfMarked), null, 'every State cell needs a mark')
  assert.deepEqual(rc.tableCells('| a | b \\| c |'), ['a', 'b | c'])
  assert.equal(rc.splitTables('```\n| a | b |\n|---|---|\n```').filter((p: any) => p.kind === 'table').length, 0, 'tables in code stay code')
})

test('explain question: the first line names the new chat after the page', () => {
  const q = rc.explainQuestion('Ways **to** earn', 'notes/options.md')
  assert.equal(rc.firstLine(q), 'About “Ways to earn”')
  assert.match(q, /notes\/options\.md/)
  assert.match(q, /at most 3 bullets/)
  assert.equal(rc.isExplainQuestion(q), true, 'its bubble shows only the first line')
  assert.equal(rc.isExplainQuestion('About “X”'), false)
  assert.equal(rc.isExplainQuestion('How far along is demo?'), false)
})

// ---- the page, rendered to completion ----

const DP: any = (await import('dompurify')).default
if (typeof DP.sanitize !== 'function') DP.sanitize = (s: string) => s // node has no DOM; synthetic markdown only

// The shared test server (test/tsx.ts) stays open until the process ends, so lazy imports inside the pages resolve.
const server = await testServer()
const load = (rel: string) => server.ssrLoadModule('/src/' + rel)
const [Docs, Ctx, XP] = fx ? await Promise.all([load('pages/Docs.tsx'), load('lib/hq-context.tsx'), load('components/ExplainPanel.tsx')]) : []

function modelWith(extra: Record<string, string>) {
  return hq.buildModel([...fx!.FILES, ...Object.entries(extra).map(([p, text]) => ({ path: p, text }))])
}
async function renderAll(el: any) {
  const { prerenderToNodeStream } = await import('react-dom/static')
  const { prelude } = await prerenderToNodeStream(el)
  let s = ''
  for await (const c of prelude) s += c
  return s.replace(/<!-- -->/g, '')
}
function page(model: any, login: string, doc: string) {
  const value = { model, me: { login, name: hq.displayName(model, login) }, source: { kind: 'local', webUrl: () => null }, reload: async () => {}, refresh: async () => {}, busy: false, loadedAt: 0, bell: null }
  return h(Ctx.HQContext.Provider, { value }, h(Docs.default, { route: { page: 'Docs', nav: 'docs', path: '/docs/' + doc, doc } }))
}

test('long doc: props, Explain + Open .md, 12 collapsible sections (3 open), summaries, TOC, status board, map', { skip: !fx && 'fixture' }, async () => {
  assert.equal(Docs.v3, true)
  const html = await renderAll(page(modelWith({ 'notes/long.md': LONG }), 'alice', 'notes/long.md'))
  assert.match(html, /<h1 tabindex="-1">Long reference<\/h1>/)
  assert.match(html, /<dt>.*?Status<\/dt><dd><span class="st active">/)
  assert.match(html, /A long synthetic page\./)
  assert.match(html, /aria-pressed="false"[^>]*>.*?Explain this page/)
  assert.match(html, /href="\/__hq\/read\?path=notes%2Flong.md"/, 'local mode: Open .md shows the raw file')
  assert.equal((html.match(/<details class="tg sec dsec"/g) || []).length, 12)
  assert.equal((html.match(/<details class="tg sec dsec" open=""/g) || []).length, 3, 'the first 3 sections open')
  assert.equal((html.match(/class="hint sec-sum"/g) || []).length, 9, 'each collapsed section shows its one-line summary')
  assert.match(html, /class="hint sec-sum">Text for part 6\.</)
  assert.match(html, /<nav class="toc2" aria-label="On this page"><div class="rprog" role="progressbar"/)
  // a long doc's TOC lists the open sections + one "Everything else · N" (the page already folds the rest away)
  assert.equal((html.match(/class="toc-a"/g) || []).length, 3)
  assert.match(html, /class="toc-a toc-more"[^>]*>Everything else · 9</)
  assert.match(html, /<h2 id="sec-at-a-glance">At a glance<\/h2>/, 'emoji dropped from headings')
  assert.match(html, /<ul class="sboard">/)
  assert.equal((html.match(/class="sb-i"/g) || []).length, 3)
  assert.match(html, /<span class="chip warn">.*?to check<\/span>/, 'mixed marks → to check')
  assert.match(html, /Show as a table/)
  assert.match(html, /class="ex ex-map"/, 'the ```explainer map renders')
  assert.doesNotMatch(html, /code-fb/, 'no block fell back to code')
  assert.match(html, /<table>/, 'other tables stay tables (phone cards come from data-label in the browser)')
  assert.match(html, /class="doc-intro"/)
})

test('options doc: auto compare + ONE Decide for my open decision (the shared resolver\'s item); others see no Decide', { skip: !fx && 'fixture' }, async () => {
  const model = modelWith({ 'notes/options.md': OPTIONS_DOC, 'todos/20261017-090000-bob-d1x.md': DECISION })
  const alice = await renderAll(page(model, 'alice', 'notes/options.md'))
  assert.match(alice, /class="ex ex-compare"/)
  assert.equal((alice.match(/data-next=/g) || []).length, 1, 'exactly one Next bar')
  assert.match(alice, /data-next="todo:todos\/20261017-090000-bob-d1x.md"/)
  assert.match(alice, /data-kind="decision"[^>]*>Decide/)
  const bob = await renderAll(page(model, 'bob', 'notes/options.md'))
  assert.match(bob, /class="ex ex-compare"/)
  assert.doesNotMatch(bob, /data-next=/, "not bob's decision")
  const done = modelWith({ 'notes/options.md': OPTIONS_DOC, 'todos/20261017-090000-bob-d1x.md': DECISION.replace('status: todo', 'status: done') })
  assert.doesNotMatch(await renderAll(page(done, 'alice', 'notes/options.md')), /data-next=/, 'a done decision → no Decide')
})

test('missing page → a not-found state; #/docs alone → the pages index', { skip: !fx && 'fixture' }, async () => {
  const model = modelWith({ 'notes/long.md': LONG })
  assert.match(await renderAll(page(model, 'alice', 'notes/nope.md')), /There’s no page at notes\/nope\.md|There&#x27;s no page at notes\/nope\.md/)
  const value = { model, me: { login: 'alice', name: 'Alice' }, source: { kind: 'local', webUrl: () => null }, reload: async () => {}, refresh: async () => {}, busy: false, loadedAt: 0, bell: null }
  const idx = await renderAll(h(Ctx.HQContext.Provider, { value }, h(Docs.default, { route: { page: 'Docs', nav: 'docs', path: '/docs' } })))
  assert.match(idx, /<h1 tabindex="-1">Pages<\/h1>/)
  assert.match(idx, /href="#\/docs\/notes\/long.md"/)
  assert.doesNotMatch(idx, /href="#\/docs\/(people|board|todos|ai)\//, 'people, board, to-dos and AI files are never listed')
})

test('Explain panel: "Reading …" before the answer; then lead → picture → ≤3 bullets → source → Keep asking (no Next)', { skip: !fx && 'fixture' }, async () => {
  const value = (model: any) => ({ model, me: { login: 'alice', name: 'Alice' }, source: { kind: 'local' }, reload: async () => {}, refresh: async () => {}, busy: false, loadedAt: 0, bell: null })
  const fresh = modelWith({ 'notes/long.md': LONG })
  const before = await renderAll(h(Ctx.HQContext.Provider, { value: value(fresh) }, h(XP.ExplainPanel, { path: 'notes/long.md', onClose() {} })))
  assert.match(before, /<aside class="xpanel" aria-labelledby="xp-title">/)
  assert.match(before, /About this page/)
  assert.match(before, /class="statusline" role="status">.*Reading Long reference…/)
  const saved = modelWith({ 'notes/long.md': LONG, 'ai/requests/20261017-100000-alice-e1x.md': EXPLAIN_Q, 'ai/answers/20261017-100000-alice-e1x.md': EXPLAIN_A })
  const html = await renderAll(h(Ctx.HQContext.Provider, { value: value(saved) }, h(XP.ExplainPanel, { path: 'notes/long.md', onClose() {} })))
  const at = (re: RegExp) => html.search(re)
  assert.ok(at(/class="lead"/) > 0 && at(/class="lead"/) < at(/class="ex ex-map"/), 'lead before the picture')
  assert.ok(at(/class="ex ex-map"/) < at(/class="blist"/), 'picture before the bullets')
  const shown = html.slice(0, at(/class="tg a-more"/))
  assert.equal((shown.match(/<li><div class="md">/g) || []).length, 3, '3 bullets shown')
  assert.match(html, /<details class="tg a-more"><summary>.*?<span>1 more<\/span>/, 'the 4th waits behind "1 more" (collapsed)')
  assert.doesNotMatch(html, /class="nextbar/, 'the panel has no Next bar')
  assert.match(html, /class="srcchip" href="#\/docs\/notes\/long.md" data-tipt="notes\/long.md"><b>1<\/b><span>Long reference<\/span>/)
  assert.match(html, /Keep asking in a new chat/)
})
