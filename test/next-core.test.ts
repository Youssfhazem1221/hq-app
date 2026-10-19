// C1-1 · C1-2 · one Next (lib/next-core.ts): the queue, the project scope, "same item", decisions, the byte-exact
// writers and their undo. Synthetic data always; the real private workspace (string copies read in memory, never
// written) only when this runs inside it, so the public app repo holds no real content.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { APP, app, fixture, filesOf, memSource } from './helpers.ts'

const N = await app('lib/next-core')
const { parse } = await app('lib/md')
const core = await app('lib/people-core')

// ---- a small synthetic workspace (same shapes as the real one) ----

const fm = (lines: string[], body = '') => ['---', ...lines, '---', '', body].join('\n')
const OPTIONS_DOC = fm([
  'title: "Ways to earn"', 'type: investigation', 'options:',
  '  - name: Audits for small shops', '    first_money: 2–4 weeks', '    evidence: "✅ own case study"', '    recommended: true',
  '  - name: Template packs', '    first_money: Jan–Feb', '    evidence: "✅ signal · ⚠️ payouts"',
  '  - name: Websites for cafes', '    first_money: 2–4 weeks', '    evidence: "💭 not researched yet"',
])
const PRICING = fm([
  'title: Pricing', 'type: project', 'owner: alice', 'status: waiting', 'started: 2026-10-01', 'updated: 2026-10-14', 'color: 4',
  'next: "Pick a pricing direction (#1, #2, both, other)"', 'hub: notes/earn.md', 'docs: [notes/earn.md, notes/other.md]',
  'milestones:',
  '  - text: "Research 3 options"', '    date: 2026-10-14', '    done: true',
  '  - text: "Pick a direction"', '    done: false',
  '  - text: "Check the contract for side work"', '    done: false',
  '  - text: "First paid audit"', '    done: false',
])
const APPP = fm([
  'title: The app', 'type: project', 'owner: alice', 'status: active', 'updated: 2026-10-14', 'color: 2',
  'next: "Paste a token in Settings, then ask one question"', 'hub: notes/tech.md', 'docs: [notes/tech.md]',
  'milestones:', '  - text: "v1 shipped"', '    date: 2026-10-14', '    done: true', '  - text: "Ask one question live"', '    done: false',
])
const SOCIAL = fm([
  'title: Social', 'type: project', 'owner: alice', 'status: active', 'updated: 2026-10-14', 'color: 3', 'hub: notes/social.md',
  'docs: [notes/social.md, notes/earn.md]', 'next: "Say what the profile is for"',
  'milestones:', '  - text: "Decide what the profile is for"', '    done: false',
])
const todo = (id: string, title: string, extra: string[] = []) =>
  fm([`id: ${id}`, `title: ${JSON.stringify(title)}`, 'status: todo', 'owner: alice', `created: 2026-10-14T14:00:0${id.slice(-1)}Z`, 'by: claude', ...extra])
const STATUS = fm(['title: Status', 'type: status', 'updated: 2026-10-15', 'now:', '  - "Pick a pricing direction: #1 audits, #2 templates, both, or other"', '  - "Write the launch note for the app"'])

const BASE: Record<string, string> = {
  'status.md': STATUS,
  'notes/earn.md': OPTIONS_DOC,
  'notes/social.md': fm(['title: Social notes']),
  'notes/tech.md': fm(['title: Tech']),
  'projects/pricing/project.md': PRICING,
  'projects/app/project.md': APPP,
  'projects/social/project.md': SOCIAL,
  'todos/t1.md': todo('t1', 'Say what the profile is for: clients / job / brand', ['link: notes/social.md']),
  'todos/t2.md': todo('t2', 'Is the team of 3 still active?', ['link: notes/social.md']),
  'todos/t3.md': todo('t3', 'Check the contract for side work terms', ['link: notes/earn.md']),
  'todos/t4.md': todo('t4', 'Pick a pricing direction (#1, #2, both, other)', ['link: notes/earn.md']),
}
function modelOf(files: Record<string, string>) {
  const all = Object.entries(files).map(([p, t]) => parse(p, t))
  const byPath = new Map(all.map((d: any) => [d.path, d]))
  return {
    all, byPath,
    todos: all.filter((d: any) => d.path.startsWith('todos/')),
    projects: all.filter((d: any) => /^projects\/[^/]+\/project\.md$/.test(d.path)),
    board: all.filter((d: any) => /^board\/[^/]+\.md$/.test(d.path)),
    status: byPath.get('status.md'),
  }
}
const ids = (q: any[]) => q.map((x) => x.id)

// ---- same item ----

test('wordsOf / sameItem: ≥3-letter words and #n, Jaccard ≥ .5; status, project and to-do lines that match are one item', () => {
  assert.deepEqual(N.wordsOf('Pick a money direction (#1, #2, both, other)'), ['pick', 'money', 'direction', '#1', '#2', 'both', 'other'])
  assert.ok(N.sameItem('Pick a pricing direction (#1, #2, both, other)', 'Pick a pricing direction: #1 audits, #2 templates, both, or other'))
  assert.ok(!N.sameItem('Pick a direction', 'Pick a pricing direction (#1, #2, both, other)'), 'short milestone ≠ the to-do by Jaccard')
  assert.ok(!N.sameItem('', 'anything'))
  assert.ok(!N.sameItem('a b c', 'a b c'), 'no words ≥ 3 → never the same')
  assert.ok(N.sameItem('Écrire la note', 'écrire LA note!'), 'unicode letters count')
  for (const junk of [null, undefined, 5, {}, []]) assert.doesNotThrow(() => N.sameItem(junk, junk))
})

// ---- the queue ----

test('C1-1 · queue: the decision named in status `now` first, then other to-dos oldest first; the status line is not listed twice', () => {
  const m = modelOf(BASE)
  const q = N.nextQueue(m, 'alice', '2026-10-15T12:00:00Z')
  assert.equal(q[0].kind, 'decision')
  assert.equal(q[0].id, 'todo:todos/t4.md')
  assert.equal(q[0].project, 'pricing', 'project from the hub the to-do links')
  assert.deepEqual(ids(q.slice(1, 4)), ['todo:todos/t1.md', 'todo:todos/t2.md', 'todo:todos/t3.md'])
  assert.equal(q.filter((x: any) => N.sameItem(x.text, 'Pick a pricing direction: #1 audits, #2 templates, both, or other')).length, 1)
  // the other now line has no to-do → a status item, after the to-dos, with "Make it a to-do"
  assert.equal(q[4].kind, 'status')
  assert.equal(q[4].text, 'Write the launch note for the app')
  assert.equal(q.length, 5)
  // project of t1 = the project whose hub is its link; t3 links a doc two projects list → the hub wins
  assert.equal(q[1].project, 'social')
  assert.equal(q[3].project, 'pricing')
})

test('C1-1 · after the decision is done: pricing scope = the next to-do; app scope = its `next:` as a milestone item', () => {
  const files = { ...BASE, 'todos/t4.md': BASE['todos/t4.md'].replace('status: todo', 'status: done') }
  const m = modelOf(files)
  const q = N.nextQueue(m, 'alice')
  assert.equal(q[0].id, 'todo:todos/t1.md')
  assert.ok(!q.some((x: any) => x.kind === 'status' && /pricing/.test(x.text)), 'a now line a done to-do covers is gone')
  assert.deepEqual(N.nextFor(m, 'alice', 'pricing'), q.find((x: any) => x.id === 'todo:todos/t3.md'))
  const app = N.nextFor(m, 'alice', 'app')
  assert.equal(app.kind, 'milestone')
  assert.equal(app.id, 'ms:app')
  assert.equal(app.text, 'Paste a token in Settings, then ask one question')
  // social: `next:` = an open to-do of mine filed elsewhere → that to-do is the project's Next (never "Make it a to-do")
  assert.equal(N.nextFor(m, 'alice', 'social').id, 'todo:todos/t1.md')
  assert.equal(N.nextFor(m, 'alice', 'nope'), null)
})

test('project scope: `next:` covered by a done to-do → first open milestone no to-do covers; all covered → null', () => {
  const files = {
    ...BASE,
    'todos/t3.md': BASE['todos/t3.md'].replace('status: todo', 'status: done'),
    'todos/t4.md': BASE['todos/t4.md'].replace('status: todo', 'status: done'),
  }
  const m = modelOf(files)
  const it = N.nextFor(m, 'alice', 'pricing')
  // "Pick a direction" is open but no to-do says the same thing (Jaccard) → offered; the contract milestone is covered by t3
  assert.equal(it.kind, 'milestone')
  assert.equal(it.text, 'Pick a direction')
  const ticked = { ...files, 'projects/pricing/project.md': PRICING.replace('  - text: "Pick a direction"\n    done: false', '  - text: "Pick a direction"\n    done: true') }
  assert.equal(N.nextFor(modelOf(ticked), 'alice', 'pricing').text, 'First paid audit', 'skips the milestone a done to-do covers')
})

test('help → join → to-dos → status → check-in; teammates never get status.md lines; empty → check-in', () => {
  const files = {
    ...BASE,
    'todos/h1.md': fm(['id: h1', 'title: "Help: build is red"', 'status: todo', 'owner: alice', 'created: 2026-10-16T10:00:00Z', 'by: bob', 'blocker: "people/bob/log/2026-10.md#16 Oct 09:00"']),
    'board/j1.md': fm(['id: j1', 'author: bob', 'created: 2026-10-16T07:15:00Z', 'to: alice', 'project: app', 'request: join', 'part: research', 'status: open'], 'join'),
    'board/j2.md': fm(['id: j2', 'author: bob', 'created: 2026-10-16T07:16:00Z', 'to: alice', 'project: elsewhere', 'request: join', 'status: open'], 'join'),
  }
  const m = modelOf(files)
  const q = N.nextQueue(m, 'alice', '2026-10-17T00:00:00Z', { nameOf: (l: string) => (l === 'bob' ? 'Bob B' : l) })
  assert.ok(!N.nextQueue(m, 'alice', '2026-10-15T00:00:00Z').some((x: any) => x.kind === 'help' || x.kind === 'join'), 'help/join dated after now do not count yet')
  assert.deepEqual(q.slice(0, 3).map((x: any) => x.kind), ['help', 'join', 'decision'])
  assert.equal(q[0].id, 'todo:todos/h1.md')
  assert.equal(q[1].text, 'Bob B asks to join The app as research')
  assert.equal(q.filter((x: any) => x.id === 'todo:todos/h1.md').length, 1, 'a help to-do is not listed again as a to-do')
  assert.ok(!q.some((x: any) => x.path === 'board/j2.md'), 'a request for a project I do not own is not mine')
  // with an exact For-you list: only what it says is help/join
  const q2 = N.nextQueue(m, 'alice', '2026-10-17T00:00:00Z', { forYou: [{ kind: 'join', path: 'board/j1.md', from: 'bob', project: 'app', since: '2026-10-16T07:15:00Z' }] })
  assert.equal(q2[0].kind, 'join')
  assert.ok(q2.some((x: any) => x.id === 'todo:todos/h1.md' && x.kind === 'todo'), 'resolved blocker (not in For you) → a plain to-do')
  // bob: no to-dos, status.md is alice's (she owns the projects) → just the check-in nudge
  assert.deepEqual(N.nextQueue(m, 'bob'), [{ kind: 'checkin', id: 'checkin', text: 'Log one thing you did today' }])
  // an explicit status owner wins
  const owned = modelOf({ ...BASE, 'status.md': STATUS.replace('type: status', 'type: status\nowner: bob') })
  assert.ok(!N.nextQueue(owned, 'alice').some((x: any) => x.kind === 'status'))
  assert.equal(N.statusOwner(modelOf(BASE)), 'alice')
})

test('isDecision: kind: decision, or Pick/Choose/Decide + a link to a doc with options; decisionDoc', () => {
  const m = modelOf(BASE)
  const t = (data: any) => ({ path: 'todos/x.md', data, body: '' })
  assert.ok(N.isDecision(t({ title: 'Pick a pricing direction', link: 'notes/earn.md' }), m))
  assert.ok(N.isDecision(t({ title: 'Choose one', link: './notes/earn.md#options' }), m))
  assert.ok(N.isDecision(t({ title: 'Anything', kind: 'decision' }), m))
  assert.ok(!N.isDecision(t({ title: 'Pick a pricing direction', link: 'notes/tech.md' }), m), 'linked doc has no options')
  assert.ok(!N.isDecision(t({ title: 'Picking up groceries', link: 'notes/earn.md' }), m))
  assert.equal(N.decisionDoc(t({ title: 'Pick', link: 'notes/earn.md' }), m).path, 'notes/earn.md')
})

test('matchMilestone: same item, else ≥2 shared words covering ≥60% of the shorter line, else the first open one when `next:` is the to-do', () => {
  const p = parse('projects/pricing/project.md', PRICING)
  assert.equal(N.matchMilestone(p, 'Pick a pricing direction (#1, #2, both, other)').text, 'Pick a direction')
  assert.equal(N.matchMilestone(p, 'Check the contract for side work terms').text, 'Check the contract for side work')
  assert.equal(N.matchMilestone(p, 'Water the plants'), null)
  const viaNext = parse('p/project.md', fm(['next: "Ship the thing"', 'milestones:', '  - text: "Alpha"', '    done: false']))
  assert.equal(N.matchMilestone(viaNext, 'Ship the thing').text, 'Alpha')
})

// ---- frontmatter edits ----

test('setKeys is a byte twin of people-core setTopKeys (fixture to-dos + edge texts × patches)', async () => {
  const fx = await fixture()
  const texts = [
    ...Object.values(BASE),
    ...(fx ? fx.FILES.filter((f: any) => /^(todos|projects)\//.test(f.path)).map((f: any) => f.text) : []),
    'no frontmatter\n', '---\r\na: 1\r\nlist:\r\n  - x\r\n---\r\nbody', '\ufeff---\nx: "y"\n---\n', '---\nk: |\n  multi\n  line\n---\n',
  ]
  const patches = [
    { status: 'done', done_at: '2026-10-15T12:00:00Z', done_by: 'alice' },
    { status: 'todo', done_at: null, done_by: null, choice: null },
    { choice: '#1 Audits for small shops' },
    { choice: 'a: b, c | d', title: 'x' },
    { list: ['a', 'b, c'], members: [] },
    { k: true, n: 3, empty: '' },
  ]
  for (const t of texts) for (const p of patches) assert.equal(N.setKeys(t, p), core.setTopKeys(t, p), JSON.stringify(p) + ' on ' + JSON.stringify(t.slice(0, 40)))
})

test('C1-2 · tickMilestone: only that item changes (done: true + date:), CRLF kept, idempotent, other shapes', () => {
  const after = N.tickMilestone(PRICING, 'Pick a direction', '2026-10-15')
  const a = PRICING.split('\n')
  const b = after.split('\n')
  assert.equal(b.length, a.length + 1, 'one line added (date)')
  const i = a.indexOf('  - text: "Pick a direction"')
  assert.deepEqual(b.slice(i, i + 3), ['  - text: "Pick a direction"', '    date: 2026-10-15', '    done: true'])
  assert.deepEqual([...b.slice(0, i), ...b.slice(i + 3)], [...a.slice(0, i), ...a.slice(i + 2)], 'every other line identical')
  assert.equal(N.tickMilestone(after, 'Pick a direction', '2026-10-16'), after, 'idempotent (already done)')
  const crlf = PRICING.replace(/\n/g, '\r\n')
  const t2 = N.tickMilestone(crlf, 'Pick a direction', '2026-10-15')
  assert.equal(t2, after.replace(/\n/g, '\r\n'), 'CRLF kept')
  assert.ok(!/[^\r]\n/.test(t2))
  // by index; an existing date is replaced; unknown → unchanged
  const withDate = PRICING.replace('  - text: "First paid audit"\n    done: false', '  - text: "First paid audit"\n    date: 2026-11-30\n    done: false')
  const t3 = N.tickMilestone(withDate, 3, '2026-10-15')
  assert.ok(t3.includes('  - text: "First paid audit"\n    date: 2026-10-15\n    done: true\n'))
  assert.equal(N.tickMilestone(PRICING, 'Nope', '2026-10-15'), PRICING)
  assert.equal(N.tickMilestone('no frontmatter', 0, '2026-10-15'), 'no frontmatter')
  // plain and flow items → rewritten in block form; a missing done key is added at the item's end
  const plain = fm(['title: x', 'milestones:', '- Alpha', '- {text: "Beta", done: false}', '- text: Gamma', 'color: 1'])
  const tp = N.tickMilestone(N.tickMilestone(N.tickMilestone(plain, 'Alpha', '2026-10-15'), 'Beta', '2026-10-15'), 'Gamma', '2026-10-15')
  assert.ok(tp.includes('- text: Alpha\n  date: 2026-10-15\n  done: true\n- text: Beta\n  date: 2026-10-15\n  done: true\n- text: Gamma\n  date: 2026-10-15\n  done: true\ncolor: 1'), tp)
  assert.equal(parse('p.md', tp).data.milestones.filter((x: any) => x.done === true).length, 3, 'still valid YAML')
  // a multi-line text keeps its continuation; the date goes after it
  const multi = fm(['milestones:', '  - text: >-', '      Long', '      text', '    done: false'])
  assert.ok(N.tickMilestone(multi, 'Long text', '2026-10-15').includes('  - text: >-\n      Long\n      text\n    date: 2026-10-15\n    done: true\n'))
  for (const junk of [null, undefined, 5, '---\nmilestones: []\n---\n', '---\nmilestones:\n---\n']) assert.doesNotThrow(() => N.tickMilestone(junk as any, 0, '2026-10-15'))
})

// ---- writers ----

test('C1-3 (core) · decide as the owner: the to-do gets status/done_at/done_by/choice, the milestone done + date; undo restores both byte for byte', async () => {
  const { src, data, puts } = await memSource({ ...BASE })
  const m = modelOf(BASE)
  const r = await N.decide(src, 'alice', m, 'todos/t4.md', '#1 Audits for small shops', { now: '2026-10-15T12:00:00Z', day: '2026-10-15' })
  assert.equal(r.written, true)
  assert.equal(r.ticked, 'Pick a direction')
  assert.deepEqual(puts.map((p: any) => p.path), ['todos/t4.md', 'projects/pricing/project.md'])
  const t = data.get('todos/t4.md')
  assert.equal(t, BASE['todos/t4.md'].replace('status: todo', 'status: done').replace('link: notes/earn.md\n', 'link: notes/earn.md\ndone_at: 2026-10-15T12:00:00Z\ndone_by: alice\nchoice: "#1 Audits for small shops"\n'))
  assert.equal(data.get('projects/pricing/project.md'), N.tickMilestone(PRICING, 'Pick a direction', '2026-10-15'))
  await r.undo()
  assert.equal(data.get('todos/t4.md'), BASE['todos/t4.md'], 'to-do bytes restored')
  assert.equal(data.get('projects/pricing/project.md'), PRICING, 'project bytes restored')
  // deciding an already done to-do writes nothing
  const done = await memSource({ ...BASE, 'todos/t4.md': BASE['todos/t4.md'].replace('status: todo', 'status: done') })
  const r2 = await N.decide(done.src, 'alice', m, 'todos/t4.md', '#2', {})
  assert.equal(r2.written, false)
  assert.equal(done.puts.length, 0)
  await assert.rejects(() => N.decide(src, 'alice', m, 'todos/t4.md', '   '), /Pick an option/)
})

test('C1-3 (core) · decide as someone who does not own the project: only the to-do is written', async () => {
  const files = { ...BASE, 'todos/t4.md': BASE['todos/t4.md'].replace('owner: alice', 'owner: bob') }
  const { src, puts } = await memSource(files)
  const r = await N.decide(src, 'bob', modelOf(files), 'todos/t4.md', 'Other: my own idea', { now: '2026-10-15T12:00:00Z' })
  assert.equal(r.ticked, null)
  assert.deepEqual(puts.map((p: any) => p.path), ['todos/t4.md'])
  // the file changed hands on disk since the model loaded → no milestone write either
  const moved = { ...BASE, 'projects/pricing/project.md': PRICING.replace('owner: alice', 'owner: carol') }
  const s2 = await memSource(moved)
  const r3 = await N.decide(s2.src, 'alice', modelOf(BASE), 'todos/t4.md', '#1', {})
  assert.equal(r3.ticked, null)
  assert.deepEqual(s2.puts.map((p: any) => p.path), ['todos/t4.md'])
})

test('decide ticks a milestone whose quoted text has " #" (block map, flow map, plain item); an unquoted value still drops a # comment', async () => {
  const shapes: Record<string, string[]> = {
    block: ['  - text: "Pick #1 or #2"', '    done: false'],
    flow: ['  - {text: "Pick #1 or #2", done: false}'],
    plain: ["  - 'Pick #1 or #2'"],
  }
  for (const [shape, item] of Object.entries(shapes)) {
    const proj = fm(['title: Hash', 'type: project', 'owner: alice', 'status: active', 'started: 2026-10-01', 'milestones:',
      '  - text: "Research"', '    done: true', ...item, '  - text: "Ship"', '    done: false'])
    const files = { ...BASE, 'projects/hash/project.md': proj, 'todos/t9.md': todo('t9', 'Pick #1 or #2', ['link: notes/earn.md', 'project: hash']) }
    const { src, data } = await memSource(files)
    const r = await N.decide(src, 'alice', modelOf(files), 'todos/t9.md', '#1', { now: '2026-10-15T12:00:00Z', day: '2026-10-15' })
    assert.equal(r.ticked, 'Pick #1 or #2', shape)
    const after = parse('p.md', data.get('projects/hash/project.md')).data.milestones
    assert.deepEqual(after.map((m: any) => [m.text ?? m, m.done ?? false]), [['Research', true], ['Pick #1 or #2', true], ['Ship', false]], shape)
    assert.equal(N.tickMilestone(data.get('projects/hash/project.md'), 'Pick #1 or #2', '2026-10-16'), data.get('projects/hash/project.md'), `${shape}: idempotent`)
  }
  // "Publish post #2" with a trailing comment after the quotes; an unquoted value keeps dropping its comment
  const c = fm(['milestones:', '  - text: "Publish post #2" # the second one', '    done: false', '  - text: Plain # note', '    done: false'])
  assert.notEqual(N.tickMilestone(c, 'Publish post #2', '2026-10-15'), c)
  assert.notEqual(N.tickMilestone(c, 'Plain', '2026-10-15'), c)
})

test('statusOwner without an owner line: the first person (earliest-started projects), not whoever owns the most projects now', () => {
  const extra: Record<string, string> = {}
  for (const s of ['a1', 'a2', 'a3', 'a4']) extra[`projects/${s}/project.md`] = fm([`title: ${s}`, 'type: project', 'owner: bob', 'status: active', 'started: 2026-10-15'])
  const files = { ...BASE, ...extra }
  const m = modelOf(files)
  assert.equal(N.statusOwner(m), 'alice', 'bob owns 4 projects with earlier slugs, but started later')
  assert.equal(N.nextQueue(m, 'alice', '2026-10-15T12:00:00Z')[0].id, 'todo:todos/t4.md', "alice's Next keeps the status line's decision first")
  assert.ok(!N.nextQueue(m, 'bob', '2026-10-15T12:00:00Z').some((x: any) => x.kind === 'status'), 'bob never gets status lines')
  // no dates anywhere → most projects (ties → first file), as before
  const undated = modelOf({ 'status.md': STATUS, 'projects/x/project.md': fm(['owner: carol']), 'projects/y/project.md': fm(['owner: dan']), 'projects/z/project.md': fm(['owner: dan']) })
  assert.equal(N.statusOwner(undated), 'dan')
})

test('completeItem: Done stamps status/done_at/done_by only; undo restores bytes; a changed file gets a reverse patch; done → no write', async () => {
  const { src, data, puts } = await memSource({ ...BASE })
  const undo = await N.completeItem(src, 'alice', modelOf(BASE), { path: 'todos/t1.md', text: 'x' }, { now: '2026-10-15T12:00:00Z' })
  assert.equal(data.get('todos/t1.md'), BASE['todos/t1.md'].replace('status: todo', 'status: done').replace('link: notes/social.md\n', 'link: notes/social.md\ndone_at: 2026-10-15T12:00:00Z\ndone_by: alice\n'))
  await undo()
  assert.equal(data.get('todos/t1.md'), BASE['todos/t1.md'])
  // someone edited the file after the tick → undo reopens it with a reverse patch (their edit stays)
  const u2 = await N.completeItem(src, 'alice', modelOf(BASE), { path: 'todos/t2.md' }, { now: '2026-10-15T12:00:00Z' })
  data.set('todos/t2.md', data.get('todos/t2.md').replace('title:', 'title2: edited\ntitle:'))
  await u2()
  const back = data.get('todos/t2.md')
  assert.match(back, /status: todo/)
  assert.match(back, /title2: edited/)
  assert.doesNotMatch(back, /done_at|done_by/)
  const n = puts.length
  const u3 = await N.completeItem(src, 'alice', modelOf(BASE), { path: 'todos/t2.md' })
  await N.completeItem(src, 'alice', modelOf(BASE), { path: 'todos/t2.md' })
  assert.equal(puts.length, n + 1, 'second tick on a done to-do writes nothing')
  await u3()
  await assert.rejects(() => N.completeItem(src, 'alice', modelOf(BASE), { path: 'projects/app/project.md' }), /Only a to-do/)
})

test('choiceLabel: #n name, both, the person\'s own words', () => {
  const opts = parse('notes/earn.md', OPTIONS_DOC).data.options
  assert.equal(N.choiceLabel(opts, 0), '#1 Audits for small shops')
  assert.equal(N.choiceLabel(opts, 'both'), '#1 + #2: Audits for small shops + Template packs')
  assert.equal(N.choiceLabel(opts, 'my own, idea\nhere'), 'my own · idea here')
  assert.equal(N.choiceLabel(opts, 9), '')
  assert.equal(N.choiceLabel(null, 'both'), '')
})

test('total: junk models never throw', () => {
  const junk: any[] = [{ todos: [], projects: [] }, { todos: [null, { path: 'todos/x.md', data: null }], projects: [{ path: 'projects/a/project.md', data: { milestones: 'x' } }] }, { todos: [{ path: 'todos/y.md', data: { owner: 'a', status: 'todo', title: {} } }], projects: [], status: { path: 'status.md', data: { now: 'a, b' } } }]
  for (const m of junk) {
    assert.doesNotThrow(() => N.nextQueue(m, 'a'))
    assert.doesNotThrow(() => N.nextFor(m, 'a', 'a'))
    assert.ok(N.nextQueue(m, 'a').length >= 1)
  }
})

// ---- the real workspace (C1-1, C1-2): read-only string copies; skipped outside the private repo ----

const ROOT = path.resolve(APP, '..')
function realFiles() {
  const dirs = ['todos', 'investigations', 'projects', 'linkedin']
  if (!fs.existsSync(path.join(ROOT, 'todos')) || !fs.existsSync(path.join(ROOT, 'status.md'))) return null
  const out: Record<string, string> = { 'status.md': fs.readFileSync(path.join(ROOT, 'status.md'), 'utf8') }
  for (const d of dirs) {
    const full = path.join(ROOT, d)
    if (!fs.existsSync(full)) continue
    for (const name of fs.readdirSync(full)) {
      const abs = path.join(full, name)
      if (name.endsWith('.md') && fs.statSync(abs).isFile()) out[`${d}/${name}`] = fs.readFileSync(abs, 'utf8')
      const pm = path.join(abs, 'project.md')
      if (d === 'projects' && fs.existsSync(pm)) out[`projects/${name}/project.md`] = fs.readFileSync(pm, 'utf8')
    }
  }
  for (const f of ['technical.md', 'agentnavguide.md']) if (fs.existsSync(path.join(ROOT, f))) out[f] = fs.readFileSync(path.join(ROOT, f), 'utf8')
  return out
}
const REAL = realFiles()
const sameLogin = (a: unknown, b: unknown) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()
const realDecision = (m: any, me: string) => m.todos.find((t: any) => N.isOpenTodo(t) && sameLogin(t.data.owner, me) && N.isDecision(t, m))

test('(C1-1 real) open decision → queue[0] = that decision, queue[1] = the oldest other to-do; no status line twice; after it → its project scope = the next to-do there; the project without to-dos → its `next:`', { skip: !REAL && 'private workspace not available' }, (t) => {
  const m = modelOf(REAL!)
  const me = N.statusOwner(m)
  const dec = realDecision(m, me)
  if (!dec) return t.skip('no open decision in the workspace right now')
  const q = N.nextQueue(m, me)
  assert.equal(q[0].kind, 'decision')
  assert.equal(q[0].path, dec.path)
  const others = m.todos.filter((x: any) => N.isOpenTodo(x) && sameLogin(x.data.owner, me) && x !== dec).sort((a: any, b: any) => String(a.data.created).localeCompare(String(b.data.created)))
  assert.equal(q[1].path, others[0].path)
  assert.equal(q.filter((x: any) => N.sameItem(x.text, dec.data.title)).length, 1, 'status line not listed twice')
  // decided → the decision's project shows its next open to-do
  const files = { ...REAL!, [dec.path]: REAL![dec.path].replace(/^status: todo$/m, 'status: done') }
  const m2 = modelOf(files)
  const slug = N.projectOfTodo(dec, m2)
  const nextThere = N.nextQueue(m2, me).find((x: any) => x.project === slug)
  assert.ok(nextThere, 'another to-do in that project')
  assert.deepEqual(N.nextFor(m2, me, slug), nextThere)
  // the app's own project, while it has no open to-dos → its `next:` as a milestone item
  const appProj = m2.projects.find((p: any) => p.data.title === 'HQ dashboard')
  if (appProj && !m2.todos.some((x: any) => N.isOpenTodo(x) && N.projectOfTodo(x, m2) === N.projectSlugOf(appProj))) {
    const s = N.projectSlugOf(appProj)
    const it = N.nextFor(m2, me, s)
    assert.equal(it.kind, 'milestone')
    assert.equal(it.text, appProj.data.next)
  }
})

test('(C1-2 real) tickMilestone on a copy of the decision\'s project file: only the matching item changes, CRLF kept, idempotent', { skip: !REAL && 'private workspace not available' }, (t) => {
  const m = modelOf(REAL!)
  const me = N.statusOwner(m)
  const dec = realDecision(m, me)
  if (!dec) return t.skip('no open decision in the workspace right now')
  const proj = m.projects.find((p: any) => N.projectSlugOf(p) === N.projectOfTodo(dec, m))
  const ms = N.matchMilestone(proj, dec.data.title)
  assert.ok(ms, 'a milestone matches the decision')
  const before = REAL![proj.path]
  const after = N.tickMilestone(before, ms.text, '2026-10-15')
  const a = before.split(/\r?\n/)
  const b = after.split(/\r?\n/)
  const changed = b.filter((l: string) => !a.includes(l))
  assert.ok(changed.every((l: string) => /^\s+(date: 2026-10-15|done: true)$/.test(l)), 'only date/done lines are new: ' + changed.join(' | '))
  assert.equal(b.length - a.length, parse(proj.path, before).data.milestones[ms.index].date ? 0 : 1)
  const after2 = parse(proj.path, after).data.milestones
  assert.equal(after2[ms.index].done, true)
  assert.deepEqual(after2.filter((_: any, i: number) => i !== ms.index), parse(proj.path, before).data.milestones.filter((_: any, i: number) => i !== ms.index))
  assert.equal(N.tickMilestone(after, ms.text, '2026-10-16'), after, 'idempotent')
  const crlf = before.replace(/\r?\n/g, '\r\n')
  assert.equal(N.tickMilestone(crlf, ms.text, '2026-10-15'), after.replace(/\r?\n/g, '\r\n'))
})

test('untickMilestone + appendMilestone: only the touched lines change', () => {
  const base = ['---', 'title: P', 'milestones:', '  - text: "A"', '    date: 2026-10-01', '    done: true', '  - text: "B"', '    done: false', 'status: active', '---', '', 'body', ''].join('\n')
  const un = N.untickMilestone(base, 0)
  assert.equal(un, base.replace('    date: 2026-10-01\n    done: true', '    done: false'))
  assert.equal(N.untickMilestone(base, 1), base, 'already open → unchanged')
  const add = N.appendMilestone(base, 'C: ship it')
  assert.equal(add, base.replace('    done: false\nstatus', '    done: false\n  - text: "C: ship it"\n    done: false\nstatus'))
  const none = ['---', 'title: P', 'milestones: []', '---', ''].join('\n')
  assert.match(N.appendMilestone(none, 'First'), /milestones:\n  - text: First\n    done: false\n---/)
  // tick then untick round-trips
  assert.equal(N.untickMilestone(N.tickMilestone(base, 1, '2026-10-16'), 1), base)
})
