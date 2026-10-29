// Module C2 · Ask AI: the answer anatomy (lead → one visual → ≤3 bullets → Next → numbered sources), the status line
// per stream stage (a stubbed SSE stream through the real ask()), Save to project (owner-only, create-only: refused in
// the app AND 403 from the local dev server's /__hq/write for a non-owner; a second save never overwrites), and the
// page rendered on the synthetic team. Synthetic data only.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { app, fixture, rm, startLocal, tmpDir } from './helpers.ts'
import { loadTsx } from './tsx.ts'

const rc = await app('lib/read-core')
const hq = await app('lib/hq')
const AS = await app('lib/askStream')
const { LocalSource } = await app('lib/source')
const fx = await fixture()

const ANSWER = [
  'Demo is nearly done: **2 of 3** milestones [projects/demo/project.md].', '',
  '```chart', '{"type":"progress","title":"Milestones","items":[{"label":"Demo app","value":2,"max":3}]}', '```', '',
  '### Key takeaways', '- Login works [projects/demo/project.md].', '- The map screen is in review.', '- Android build is blocked.', '- Screenshots are fresh.', '',
  '| Item | State |', '|---|---|', '| Map | review |', '',
  '**Next:** Review the map screen [todos/20261015-090000-bob-r4m.md].', '',
  '---', '**Sources**', '- 📄 [projects/demo/project.md](../../projects/demo/project.md)', '- 🌐 [A web page](https://example.com/page)',
  '- 📄 [projects/demo/project.md](../../projects/demo/project.md)', '',
].join('\n')

test('answerParts: lead, the first chart, bullets (heading label dropped), rest, Next and sources', () => {
  const p = rc.answerParts(ANSWER)
  assert.equal(p.lead, 'Demo is nearly done: **2 of 3** milestones [projects/demo/project.md].')
  assert.equal(p.visual.lang, 'chart')
  assert.match(p.visual.src, /"type":"progress"/)
  assert.deepEqual(p.bullets, ['Login works [projects/demo/project.md].', 'The map screen is in review.', 'Android build is blocked.', 'Screenshots are fresh.'])
  assert.equal(p.next, 'Review the map screen [todos/20261015-090000-bob-r4m.md].')
  assert.deepEqual(p.sources, [{ path: 'projects/demo/project.md' }, { url: 'https://example.com/page', title: 'A web page' }], 'deduped, in order')
  assert.match(p.rest, /^\| Item \| State \|/, 'the table is kept')
  assert.doesNotMatch(p.rest, /Key takeaways/, 'the label above the bullets goes with them')
  assert.equal(rc.SHOWN_BULLETS, 3)
})

test('answerParts: greetings, CRLF, no sources, explainer visual, junk', () => {
  const hi = rc.answerParts('Hi! I can chart your projects or find a helper.')
  assert.equal(hi.lead, 'Hi! I can chart your projects or find a helper.')
  assert.deepEqual([hi.visual, hi.bullets, hi.next, hi.sources, hi.rest], [null, [], '', [], ''])
  const ex = rc.answerParts('Three steps.\r\n\r\n```explainer\r\n{"type":"flow","title":"T","steps":[{"title":"A"},{"title":"B"}]}\r\n```\r\n\r\n- one\r\n- two\r\n\r\nNext: try it')
  assert.equal(ex.visual.lang, 'explainer')
  assert.deepEqual(ex.bullets, ['one', 'two'])
  assert.equal(ex.next, 'try it')
  const unclosed = rc.answerParts('Lead.\n\n```chart\n{"type":"bar"')
  assert.equal(unclosed.visual, null, 'an unclosed block is not a visual')
  for (const junk of [null, undefined, 42, {}, [], '```', '---\n**Sources**\n']) assert.doesNotThrow(() => rc.answerParts(junk))
  const list = rc.answerParts('- a\n- b')
  assert.deepEqual([list.lead, list.bullets], ['', []], 'no lead and no visual → plain markdown (rest)')
  assert.equal(list.rest, '- a\n- b')
})

test('status line per stage: server stage text, paths as titles, "Writing the answer" once words arrive', () => {
  const titleOf = (p: string) => (p === 'notes/long.md' ? 'Long reference' : '')
  assert.equal(rc.stageText('streaming', 'Connecting', false), 'Connecting')
  assert.equal(rc.stageText('streaming', '', false), 'Connecting')
  assert.equal(rc.stageText('streaming', 'Searching your notes', false), 'Searching your notes')
  assert.equal(rc.stageText('streaming', 'Reading notes/long.md', false, titleOf), 'Reading Long reference')
  assert.equal(rc.stageText('streaming', 'Reading other/x.md', false, titleOf), 'Reading other/x.md', 'unknown page keeps its path')
  assert.equal(rc.stageText('streaming', 'Thinking', true), 'Writing the answer')
  assert.equal(rc.stageText('streaming', 'Searching the web', true), 'Searching the web', 'a tool mid-answer keeps its stage')
  assert.equal(rc.stageText('done', 'x', true), '')
  assert.equal(rc.stageText('error', 'x', false), '')
  assert.match(rc.stageText('waiting', '', false), /GitHub Actions/)
})

test('Save to project path: projects/<slug>/explainer-<topic>.md; bad slugs refused', () => {
  assert.equal(rc.topicSlug('Compare the 5 money options visually.'), 'compare-5-money-options-visually')
  assert.equal(rc.topicSlug('???'), 'answer')
  assert.ok(rc.topicSlug('word '.repeat(40)).length <= 40)
  assert.equal(rc.explainerPath('demo', 'How far along is each project?'), 'projects/demo/explainer-far-along-each-project.md')
  for (const bad of ['', '../x', 'a/b', '-x', 'x'.repeat(70), null]) assert.equal(rc.explainerPath(bad, 'q'), null)
})

test('liveMarkdown hides an unclosed chart or explainer block while streaming', () => {
  assert.equal(AS.liveMarkdown('Lead.\n\n```explainer\n{"type":'), 'Lead.\n\n*Drawing a picture…*')
  assert.equal(AS.liveMarkdown('Lead.\n\n```chart\n{"type":'), 'Lead.\n\n*Drawing a chart…*')
  assert.equal(AS.liveMarkdown('Lead.\n\n```js\nx'), 'Lead.\n\n```js\nx', 'other code shows as it streams')
})

test('stubbed stream: the status line changes per stage, then the answer lands with its sources', async () => {
  const enc = new TextEncoder()
  let push!: (s: string) => void
  let end!: () => void
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      push = (s) => c.enqueue(enc.encode(s))
      end = () => c.close()
    },
  })
  const real = globalThis.fetch
  globalThis.fetch = (async (url: any) => {
    assert.equal(url, '/__hq/ask')
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch
  const tick = () => new Promise((r) => setTimeout(r, 15))
  const stage = () => {
    const l = AS.liveList().find((x: any) => x.id === 'stub-1')
    return rc.stageText(l.state, l.status, !!l.text, (p: string) => (p === 'notes/long.md' ? 'Long reference' : ''))
  }
  const seen: string[] = []
  let refreshed = 0
  try {
    const done = AS.ask({ kind: 'local' }, { login: 'alice', name: 'Alice' }, { id: 'stub-1', thread: 'stub-1', question: 'What is demo?', kind: 'ask' }, [], async () => {
      refreshed++
    })
    await tick()
    seen.push(stage())
    push('event: status\ndata: {"text":"Searching your notes"}\n\n')
    await tick()
    seen.push(stage())
    push('event: status\ndata: {"text":"Reading notes/long.md"}\n\n')
    await tick()
    seen.push(stage())
    push('event: status\ndata: {"text":"Thinking"}\n\nevent: delta\ndata: {"text":"Demo is three parts."}\n\n')
    await tick()
    seen.push(stage())
    push('event: sources\ndata: {"items":[{"path":"notes/long.md"}]}\n\nevent: done\ndata: {"seconds":4}\n\n')
    end()
    await done
    const l = AS.liveList().find((x: any) => x.id === 'stub-1')
    assert.deepEqual(seen, ['Connecting', 'Searching your notes', 'Reading Long reference', 'Writing the answer'])
    assert.equal(l.state, 'done')
    assert.equal(l.text, 'Demo is three parts.')
    assert.deepEqual(l.sources, [{ path: 'notes/long.md' }])
    assert.equal(l.seconds, 4)
    assert.equal(stage(), '', 'no status line once done')
    assert.equal(refreshed, 1, 'files reload once so the saved answer replaces the live one')
  } finally {
    globalThis.fetch = real
    AS.dropLive('stub-1')
  }
})

test('Save to project (C2-3): bob on alice\'s demo → refused in the app and 403 from /__hq/write; alice → created once, never overwritten', { skip: !fx && 'fixture' }, async () => {
  const root = fx!.materialize(tmpDir('c2-save'))
  const model = hq.buildModel(fx!.FILES)
  const q = 'How far along is each project?'
  const target = path.join(root, 'projects', 'demo', 'explainer-far-along-each-project.md')
  const bob = await startLocal(root, 'bob')
  try {
    assert.deepEqual(AS.ownedProjects(model, { login: 'bob' }), [], 'bob owns no project → the UI offers Post to board')
    assert.equal(AS.saveRefusal(model, { login: 'bob' }, 'demo'), 'Only Alice can add pages to Demo app')
    await assert.rejects(AS.saveToProject(new LocalSource(), { login: 'bob', name: 'Bob' }, model, { slug: 'demo', question: q, answer: ANSWER }), /Only Alice can add pages to Demo app/)
    assert.equal(bob.posts.length, 0, 'refused before any write')
    const r = await fetch('/__hq/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'projects/demo/explainer-x.md', text: 'x\n', expect: 'absent' }) })
    assert.equal(r.status, 403, 'the dev server refuses it too')
    assert.equal(fs.existsSync(path.join(root, 'projects', 'demo', 'explainer-x.md')), false)
  } finally {
    await bob.close()
  }
  const alice = await startLocal(root, 'alice')
  try {
    assert.deepEqual(AS.ownedProjects(model, { login: 'alice' }).map((p: any) => p.slug), ['demo', 'solo'])
    const me = { login: 'alice', name: 'Alice' }
    const first = await AS.saveToProject(new LocalSource(), me, model, { slug: 'demo', question: q, answer: ANSWER, answerPath: 'ai/answers/a1.md' }, '2026-10-17T10:00:00Z')
    assert.deepEqual(first, { path: 'projects/demo/explainer-far-along-each-project.md', written: true })
    assert.deepEqual(alice.posts, [{ path: 'projects/demo/explainer-far-along-each-project.md', expect: 'absent' }], 'one create-only write')
    const text = fs.readFileSync(target, 'utf8')
    const { parse } = await app('lib/md')
    const d = parse('x.md', text)
    assert.deepEqual(d.data, { title: q, type: 'explainer', project: 'demo', source: 'ai/answers/a1.md', created: '2026-10-17T10:00:00Z', by: 'alice' })
    assert.match(d.body, /^\s*# How far along is each project\?\n\nDemo is nearly done/)
    assert.match(d.body, /```chart/, 'the picture travels with the page')
    const second = await AS.saveToProject(new LocalSource(), me, model, { slug: 'demo', question: q, answer: 'something else' })
    assert.equal(second.written, false, 'exists → refused, nothing overwritten')
    assert.equal(fs.readFileSync(target, 'utf8'), text)
    await assert.rejects(AS.saveToProject(new LocalSource(), me, model, { slug: 'nope', question: q, answer: 'x' }), /No such project/)
  } finally {
    await alice.close()
    rm(root)
  }
})

// ---- the page, server-rendered ----

const DP: any = (await import('dompurify')).default
if (typeof DP.sanitize !== 'function') DP.sanitize = (s: string) => s // node has no DOM; synthetic markdown only

const RENDER = fx && (await loadTsx(['pages/Ask.tsx', 'lib/hq-context.tsx']))
const Q = ['---', 'id: 20261017-110000-alice-k2m', 'author: alice', 'created: 2026-10-17T11:00:00Z', 'kind: ask', 'project: demo', '---', '', 'How far along is demo?'].join('\n')
const A = ['---', 'id: 20261017-110000-alice-k2m', 'request: 20261017-110000-alice-k2m', 'created: 2026-10-17T11:00:07Z', 'status: done', 'seconds: 7', '---', '', ANSWER].join('\n')

function renderAsk(login: string, chat: string) {
  const mem = new Map<string, string>([['hq.chat', JSON.stringify(chat)]])
  const had = 'localStorage' in globalThis
  const before = (globalThis as any).localStorage
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
  })
  try {
    const [P, ctx] = RENDER!
    const model = hq.buildModel([...fx!.FILES, { path: 'ai/requests/20261017-110000-alice-k2m.md', text: Q }, { path: 'ai/answers/20261017-110000-alice-k2m.md', text: A }])
    const value = { model, me: { login, name: hq.displayName(model, login) }, source: { kind: 'local' }, reload: async () => {}, refresh: async () => {}, busy: false, loadedAt: 0, bell: null }
    return renderToString(h(ctx.HQContext.Provider, { value }, h(P.default, { route: { page: 'Ask', nav: 'ask', path: '/ask' } }))).replace(/<!-- -->/g, '')
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: before })
    else delete (globalThis as any).localStorage
  }
}

test('Ask page: answer anatomy in order, numbered source titles, Sources · 3, Fast/Deep tips, Save to project for the owner', { skip: !fx && 'fixture' }, () => {
  assert.equal(RENDER![0].v3, true)
  const html = renderAsk('alice', '20261017-110000-alice-k2m')
  assert.match(html, /<h1 class="sr" tabindex="-1">Ask AI: How far along is demo\?<\/h1>/)
  assert.match(html, /<button class="thr" type="button" aria-current="true"><b>How far along is demo\?<\/b>/)
  const at = (re: RegExp) => html.search(re)
  const order = [/class="q">How far along is demo\?/, /class="lead"/, /class="a-vis"/, /class="blist"/, /class="nextbar slim"/, /class="src"/, /class="acts"/].map(at)
  assert.ok(order.every((v) => v > 0), 'every part is there')
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'question → lead → visual → bullets → Next → sources → actions')
  assert.match(html, /Pinwheel AI · Fast · 7 s/)
  assert.match(html, /<span>3 more|<span>1 more/)
  assert.match(html, /class="srcchip" href="#\/projects\/demo" data-tipt="projects\/demo\/project.md"><b>1<\/b><span>Demo app<\/span>/)
  assert.match(html, /class="srcchip" href="https:\/\/example.com\/page" target="_blank" rel="noopener noreferrer"[^>]*><b>2<\/b><span>A web page<\/span>/)
  assert.match(html, /Sources · 3/, 'notes + the web + links by default')
  assert.match(html, /data-tipt="Fast · first words in about 5 s"/)
  assert.match(html, /data-tipt="Deep · thinks longer, about 30 s"/)
  assert.match(html, />Make it a to-do</)
  assert.match(html, /data-tipt="Adds a new page to Demo app"[^>]*>.*?Save to project/, 'alice owns demo: save straight there')
  assert.doesNotMatch(html, /Post to board/)
})

test("Ask page as bob on alice's demo answer: Post to board instead, with the owner rule in the tooltip", { skip: !fx && 'fixture' }, () => {
  const html = renderAsk('bob', '20261017-110000-alice-k2m')
  assert.doesNotMatch(html, /Save to project/)
  assert.match(html, /data-tipt="Only Alice can add pages to Demo app"[^>]*>.*?Post to board/)
  assert.match(html, /<div class="q-meta">Alice/, "someone else's question shows who asked")
})

test('Ask page, new chat: empty state with 4 suggestions, no answer parts', { skip: !fx && 'fixture' }, () => {
  const html = renderAsk('alice', 'new')
  assert.match(html, /What do you want to know\?/)
  assert.equal((html.match(/class="qchip" type="button"/g) || []).length, 4)
  assert.doesNotMatch(html, /class="turn"/)
  assert.match(html, /placeholder="Ask anything…"/)
})
