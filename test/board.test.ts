// Module C2 · Board: type guess, Claude tracker (files + stubbed doorbell events), bridge chip (no "Checking…" phase),
// welcome 3-step picture, filter counts, join/leave cards and the Board's Next from the For-you rules. Then the page
// itself rendered on the synthetic team (alice, bob, carol). Synthetic data only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { app, fixture } from './helpers.ts'
import { loadTsx } from './tsx.ts'

const rc = await app('lib/read-core')
const hq = await app('lib/hq')
const people = await app('lib/people')
const fx = await fixture()

test('detectType: a "?" or a question word → question; idea openers win; update words; else thought', () => {
  assert.equal(rc.detectType('?'), 'question')
  assert.equal(rc.detectType('Can you summarize the blueprint?'), 'question')
  assert.equal(rc.detectType('where is the demo token'), 'question')
  assert.equal(rc.detectType('What if we add a dark mode?'), 'idea', '"what if" is an idea even with a question mark')
  assert.equal(rc.detectType("let's try the map on phones"), 'idea')
  assert.equal(rc.detectType('Shipped the map screen'), 'update')
  assert.equal(rc.detectType('Note to self: the API is slow'), 'thought')
  assert.equal(rc.detectType(''), 'thought')
  assert.equal(rc.detectType(null), 'thought')
})

test('tracker: posted → picked up → replied, from files and from stubbed doorbell bridge events', () => {
  const post = { id: 'p1', path: 'board/p1.md', status: 'open' }
  const seen = Date.now()
  assert.equal(rc.trackerStage(post, false, null, null), 1, 'no bridge news: posted, waiting to be picked up')
  assert.equal(rc.trackerStage(post, false, { state: 'online', seen }, null), 1, 'online heartbeat: still waiting')
  assert.equal(rc.trackerStage(post, false, { state: 'working', id: 'p1', seen }, { id: 'p1' }), 2, 'working on this post')
  assert.equal(rc.trackerStage(post, false, { state: 'working', id: 'other', seen }, { id: 'other' }), 1, 'working on another post')
  assert.equal(rc.trackerStage({ id: 'x9', path: 'board/p1.md' }, false, null, { id: 'p1' }), 2, 'the bridge names posts by file name')
  assert.equal(rc.trackerStage(post, false, { state: 'done', id: 'p1', seen }, null), 3, 'done event before the reply file arrives')
  assert.equal(rc.trackerStage(post, true, null, null), 3, 'a Claude reply exists')
  assert.equal(rc.trackerStage({ ...post, status: 'done', closedBy: 'claude' }, false, null, null), 3)
  assert.equal(rc.trackerStage({ ...post, status: 'done', closedBy: 'bob' }, false, null, null), 1, 'closed by a person is not a reply')
  assert.ok(rc.isClaudeReply({ author: 'claude' }) && rc.isClaudeReply({ author: 'alice', via: 'bridge' }) && !rc.isClaudeReply({ author: 'bob' }))
})

test('bridge chip: neutral until a heartbeat (never "Checking…"), then online / working / offline', () => {
  const now = 1_000_000_000
  assert.equal(rc.bridgeChipView(null, now), 'neutral', 'no doorbell')
  assert.equal(rc.bridgeChipView({ bridge: null, working: null }, now), 'neutral', 'a fresh connection with no heartbeat yet')
  assert.equal(rc.bridgeChipView({ bridge: { state: 'online', seen: now - 10_000 } }, now), 'online')
  assert.equal(rc.bridgeChipView({ bridge: { state: 'working', seen: now - 5_000 }, working: { since: now - 5_000 } }, now), 'working')
  assert.equal(rc.bridgeChipView({ bridge: { state: 'online', seen: now - 4 * 60_000 } }, now), 'offline', 'went quiet (> 3 min)')
  assert.equal(rc.bridgeChipView({ bridge: { state: 'offline', seen: now - 1000 } }, now), 'offline')
  assert.equal(rc.bridgeChipView({ bridge: { state: 'done', seen: now - 1000 } }, now), 'online', 'a finished job = online')
  const views = new Set<string>()
  for (let t = 0; t <= 80_000; t += 5_000) views.add(rc.bridgeChipView({ bridge: null }, now + t))
  assert.deepEqual([...views], ['neutral'], 'the first 70 s say "Claude bridge", nothing else')
})

test('welcome post → a 3-step picture; other bodies stay markdown', () => {
  const body = '👋 **Welcome to the board.** Drop ideas here.\n\n1. ✍️ **Write a post**: an idea or a question.\n2. 🚩 **Flag it for Claude** when Claude should act.\n3. 🤖 **Claude replies here**: in about a minute.\n'
  const how = rc.howSteps(body)
  assert.ok(how)
  assert.equal(how.lead, '**Welcome to the board.** Drop ideas here.')
  assert.deepEqual(how.steps.map((s: any) => s.title), ['Write a post', 'Flag it for Claude', 'Claude replies here'])
  assert.equal(how.steps[0].text, 'an idea or a question.')
  assert.equal(rc.howSteps('Just a normal post.'), null)
  assert.equal(rc.howSteps('1. only one step'), null)
  assert.equal(rc.howSteps('Intro\n\n1. **A**: a\n2. **B**: b\n\nA closing paragraph.'), null, 'text after the list → not a picture')
})

test('filter chips: All · n always; To me / For Claude count open posts only', { skip: !fx && 'fixture lives in the private repo' }, () => {
  const model = hq.buildModel(fx!.FILES)
  assert.deepEqual(rc.boardCounts(model.board, 'alice'), { all: 5, me: 1, claude: 0 }, 'alice: the join request; the flagged post is done')
  assert.deepEqual(rc.boardCounts(model.board, 'bob'), { all: 5, me: 1, claude: 0 })
  assert.deepEqual(rc.boardCounts(model.board, 'carol'), { all: 5, me: 0, claude: 0 })
  const flagged = [{ data: { for_claude: true, status: 'open' } }, { data: { for_claude: 'true' } }, { data: { for_claude: true, status: 'done' } }]
  assert.equal(rc.boardCounts(flagged, 'x').claude, 2)
})

test('join/leave cards: owner buttons only for the owner the request is addressed to', { skip: !fx && 'fixture' }, () => {
  const model = hq.buildModel(fx!.FILES)
  const owners = new Map(model.projects.map((p: any) => [hq.projectSlug(p), String(p.data.owner)]))
  const join = model.board.find((p: any) => p.data.request === 'join')
  assert.deepEqual(rc.requestCard(join, 'alice', owners), { kind: 'join', who: 'bob', project: 'solo', part: 'research help', open: true, mine: true })
  assert.equal(rc.requestCard(join, 'bob', owners).mine, false)
  assert.equal(rc.requestCard(join, 'carol', owners).mine, false)
  assert.equal(rc.requestCard({ data: { request: 'join', to: 'carol', project: 'solo', author: 'bob' } }, 'carol', owners).mine, false, 'addressed to me but not my project')
  assert.equal(rc.requestCard(model.board.find((p: any) => !p.data.request), 'alice', owners), null)
})

test("Board's Next = a real board item from the For-you rules, with the shared resolver's ids", { skip: !fx && 'fixture' }, () => {
  const model = hq.buildModel(fx!.FILES)
  const nameOf = (l: string) => hq.displayName(model, l)
  const title = (s: string) => String(model.projects.find((p: any) => hq.projectSlug(p) === s)?.data.title || s)
  const a = rc.boardNextItem(people.forYouFor(model, 'alice', fx!.NOW, { at: '', ack: [] }), nameOf, title)
  assert.equal(a.kind, 'join')
  assert.equal(a.id, 'post:board/20261016-071500-bob-q1z.md')
  assert.match(a.text, /^Bob asks to join Solo research as research help$/)
  const b = rc.boardNextItem(people.forYouFor(model, 'bob', fx!.NOW, { at: '', ack: [] }), nameOf, title)
  assert.equal(b.kind, 'help', 'a post to bob → Open')
  assert.equal(b.id, 'post:board/20261016-110000-alice-m2x.md')
  assert.match(b.text, /^Alice → you: Can you look at the onboarding text/)
  assert.equal(rc.boardNextItem([{ kind: 'assigned', path: 'todos/x.md' }, { kind: 'digest', path: 'people/x/digest/2026-10.md' }]), null, 'no board item → no Next')
})

// ---- the page, server-rendered on the fixture ----

// DOMPurify needs a DOM and node has none (no sanitize()). The markdown here is the synthetic fixture, so a pass-through
// keeps the test about the page; the browser build always uses the real sanitizer.
const DP: any = (await import('dompurify')).default
if (typeof DP.sanitize !== 'function') DP.sanitize = (s: string) => s

const RENDER = fx && (await loadTsx(['pages/Board.tsx', 'lib/hq-context.tsx']))

/** Run `fn` with the clock at the fixture's NOW (its posts are dated after today's real date). */
function atFixtureNow<T>(fn: () => T): T {
  const Real = Date
  const at = Date.parse(fx!.NOW)
  class Fixed extends Real {
    constructor(...a: any[]) {
      if (a.length) super(...(a as [any]))
      else super(at)
    }
    static now() {
      return at
    }
  }
  globalThis.Date = Fixed as DateConstructor
  try {
    return fn()
  } finally {
    globalThis.Date = Real
  }
}

function renderBoard(login: string) {
  const [B, ctx] = RENDER!
  const model = hq.buildModel(fx!.FILES)
  const me = { login, name: hq.displayName(model, login) }
  const value = { model, me, source: { kind: 'local' }, reload: async () => {}, refresh: async () => {}, busy: false, loadedAt: 0, bell: null }
  return atFixtureNow(() => renderToString(h(ctx.HQContext.Provider, { value }, h(B.default, { route: { page: 'Board', nav: 'board', path: '/board' } })))).replace(/<!-- -->/g, '')
}

test('Board page as alice: one-line composer, chips, request card with Add / Not now, Next = Review', { skip: !fx && 'fixture' }, () => {
  assert.equal(RENDER![0].v3, true, 'a v3 page (no legacy CSS scope)')
  const html = renderBoard('alice')
  assert.match(html, /class="compose-c"[^>]*>.*Write a post…/s, 'the composer starts as one line')
  assert.doesNotMatch(html, /<textarea/, 'not expanded')
  assert.match(html, /All · 5/)
  assert.match(html, /To me · 1/)
  assert.doesNotMatch(html, /For Claude · /, 'no open flagged post → no chip')
  assert.match(html, /data-next="post:board\/20261016-071500-bob-q1z.md"/)
  assert.match(html, /data-kind="join"[^>]*>Review/)
  assert.match(html, />Add</)
  assert.match(html, />Not now</)
  assert.doesNotMatch(html, /class="stat"/, 'no tiles on Board')
  assert.equal((html.match(/<article class="post/g) || []).length, 5)
  assert.match(html, /Claude bridge/, 'the bridge chip is neutral without a doorbell')
  assert.doesNotMatch(html, /Checking/)
  assert.match(html, /aria-label="Claude progress"/, 'the flagged post shows its tracker')
  assert.match(html, /class="on"[^>]*><i aria-hidden="true"><\/i>picked up/, 'the flagged post was picked up…')
  assert.match(html, /class="on"[^>]*><i aria-hidden="true"><\/i>replied/, '…and replied (bridge reply file)')
})

test('C2-2: a flagged post follows stubbed doorbell events, online → working → done; the bridge chip follows too', { skip: !fx && 'fixture' }, () => {
  const [B, ctx] = RENDER!
  const flagged = ['---', 'id: 20261017-120000-alice-f1g', 'author: alice', 'created: 2026-10-17T12:00:00Z', 'type: question', 'for_claude: true', 'status: open', '---', '', 'Claude: list the open demo to-dos.'].join('\n')
  const model = hq.buildModel([...fx!.FILES, { path: 'board/20261017-120000-alice-f1g.md', text: flagged }])
  const now = Date.parse(fx!.NOW)
  const bell = (bridge: any, working: any) => ({ bridge, working, version: 1, subscribe: () => () => {} })
  const render = (b: any) =>
    atFixtureNow(() =>
      renderToString(h(ctx.HQContext.Provider, { value: { model, me: { login: 'alice', name: 'Alice' }, source: { kind: 'local' }, reload: async () => {}, refresh: async () => {}, busy: false, loadedAt: 0, bell: b } },
        h(B.default, { route: { page: 'Board', nav: 'board', path: '/board' } })))).replace(/<!-- -->/g, '')
  const tracker = (html: string) => {
    const at = html.indexOf('id="post-20261017-120000-alice-f1g"')
    const ol = html.slice(html.indexOf('aria-label="Claude progress"', at), html.indexOf('</ol>', at))
    return ['posted', 'picked up', 'replied'].map((s) => (new RegExp(`class="on"[^>]*><i aria-hidden="true"></i>${s}`).test(ol) ? 'on' : new RegExp(`class="cur"[^>]*><i aria-hidden="true"></i>${s}`).test(ol) ? 'cur' : '-'))
  }
  const online = render(bell({ state: 'online', seen: now - 5_000 }, null))
  assert.deepEqual(tracker(online), ['on', 'cur', '-'], 'online: posted, waiting to be picked up')
  assert.match(online, /Claude bridge · online/)
  assert.match(online, /For Claude · 1/, 'the open flagged post gets its chip')
  const working = render(bell({ state: 'working', id: '20261017-120000-alice-f1g', seen: now - 2_000 }, { id: '20261017-120000-alice-f1g', since: now - 2_000 }))
  assert.deepEqual(tracker(working), ['on', 'on', 'cur'], 'working on this post: picked up')
  assert.match(working, /Claude is working/)
  assert.match(working, /aria-current="step"/)
  const done = render(bell({ state: 'done', id: '20261017-120000-alice-f1g', seen: now - 1_000 }, null))
  assert.deepEqual(tracker(done), ['on', 'on', 'on'], 'done event: replied, before the reply file arrives')
  assert.deepEqual(tracker(render(null)), ['on', 'cur', '-'], 'no doorbell: posted')
})

test('Board page as bob: no owner buttons on alice\'s project, the request waits on Alice', { skip: !fx && 'fixture' }, () => {
  const html = renderBoard('bob')
  assert.doesNotMatch(html, />Add</)
  assert.match(html, /Waiting on Alice/)
  assert.match(html, /data-kind="help"[^>]*>Open/, "bob's Next is alice's post to him")
})
