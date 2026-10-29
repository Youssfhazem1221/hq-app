// Review fixes (correctness + plain-words lenses): human words for commits (never tool prefixes or file ids), plain AI
// error words, For-you rows in Next-queue order, the empty journey (no "0 of 0", one action for the owner) and the
// owner's "add the first milestone" write. Synthetic data only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { app, memSource } from './helpers.ts'
import { loadTsx } from './tsx.ts'

const { humanChange } = await app('lib/changes')
const { aiErrorWords } = await app('lib/askStream')
const P = await app('lib/people')
const { parse } = await app('lib/md')
const [J, FY] = await loadTsx(['components/visuals/Journey.tsx', 'components/people/ForYouList.tsx'])
const html = (node: any) => renderToString(h('div', null, node)).replace(/<!-- -->/g, '')
const nameOf = (l: string) => ({ alice: 'Alice', bob: 'Bob', claude: 'Claude' } as Record<string, string>)[l] || l

test('humanChange: bridge and board commits read as words; no "claude:" prefix and no file ids', () => {
  assert.equal(humanChange({ message: 'claude: board 20261015-023331-alice-h4u (bridge)', actor: 'claude', author: 'x' }, nameOf), 'Claude replied on the board')
  assert.equal(humanChange({ message: 'board: done 20261015-070000-alice-f1g', actor: 'bob', author: 'bob' }, nameOf), 'Bob closed a board post')
  assert.equal(humanChange({ message: 'claude: tidy 20261015-070000-alice-f1g notes', actor: 'claude', author: 'x' }, nameOf), 'Claude: tidy notes')
  assert.equal(humanChange({ message: 'misc: 20261015-070000-alice-f1g', actor: 'bob', author: 'bob' }, nameOf), 'Bob changed a file')
  assert.equal(humanChange({ message: 'project: first milestone · Ship it', actor: 'alice', author: 'alice' }, nameOf), 'Alice added a milestone')
  for (const m of ['claude: board 20261015-023331-alice-h4u (bridge)', 'todo: 20261015-023331-alice-h4u', 'x: y 20261015-023331-a']) {
    const s = humanChange({ message: m, actor: 'claude', author: 'claude' }, nameOf)
    assert.doesNotMatch(s, /\d{8}-\d{6}/, s)
    assert.doesNotMatch(s.replace(/^Claude/, ''), /claude:/i, s)
  }
})

test('aiErrorWords: plain words, never an HTTP code or provider jargon', () => {
  const cases: [string, RegExp][] = [
    ['Gemini 400: API key not valid. Please pass a valid API key.', /AI key isn't working/],
    ['Bad GitHub token', /sign-in has expired/],
    ['alice is not allowed to use HQ AI', /can't use Pinwheel AI yet/],
    ['Gemini is busy: try again in a minute', /Too many questions/],
    ['Failed to fetch', /Can't reach the AI/],
    ['Something odd', /couldn't answer/],
  ]
  for (const [raw, re] of cases) {
    const s = aiErrorWords(raw)
    assert.match(s, re, raw)
    assert.doesNotMatch(s, /\b\d{3}\b|gemini|api/i, s)
  }
})

test('For you rows follow the Next queue (decision first, like the hero); unqueued kinds keep their order after', () => {
  const it = (kind: string, path: string) => ({ id: kind + path, hash: path, kind, from: 'claude', title: path, path, since: '2026-10-14T14:00:00Z', isNew: false })
  const items = [it('assigned', 'todos/t1.md'), it('reply', 'board/r1.md'), it('assigned', 'todos/t2.md'), it('join', 'board/j1.md'), it('assigned', 'todos/t4.md')]
  const queue = ['post:board/j1.md', 'todo:todos/t4.md', 'todo:todos/t1.md', 'todo:todos/t2.md', 'checkin']
  assert.deepEqual(FY.inQueueOrder(items, queue).map((x: any) => x.path), ['board/j1.md', 'todos/t4.md', 'todos/t1.md', 'todos/t2.md', 'board/r1.md'])
  assert.deepEqual(FY.inQueueOrder(items, []).map((x: any) => x.path), items.map((x) => x.path), 'no queue → as listed')
})

test('Journey with no milestones: no "0 of 0", no track or caret; the owner gets one "Add the first milestone" field', () => {
  const p = { path: 'projects/n/project.md', data: { title: 'New', owner: 'alice', next: P.TEMPLATE_NEXT, milestones: [] } }
  const next = { kind: 'milestone', id: 'milestone:n', text: P.TEMPLATE_NEXT, project: 'n' }
  const viewer = html(h(J.Journey, { project: p, next }))
  assert.ok(!/of 0 done|j-count/.test(viewer), 'no zero count')
  assert.ok(viewer.includes('journey pc1 j-none'), 'empty class hides the caret')
  const owner = html(h(J.Journey, { project: p, next, onAddMilestone: async () => {} }))
  assert.ok(owner.includes('Add the first milestone'))
  assert.equal((owner.match(/<button/g) || []).length, 1, 'one action: the Add button (the placeholder Next is replaced)')
  assert.ok(!owner.includes('data-next'), 'no placeholder NOW card')
  const none = html(h(J.Journey, { project: p, next: null }))
  assert.ok(none.includes('No milestones yet.'))
})

test('addFirstMilestone: owner only; writes a block-style first milestone and clears the template next:', async () => {
  const text = P.projectTemplate('New thing', 'new-thing', 'alice', '2026-10-15', 3)
  const path = 'projects/new-thing/project.md'
  const { src, data, puts } = await memSource({ [path]: text })
  await assert.rejects(P.addFirstMilestone(src, { login: 'bob', name: 'Bob' }, path, 'Ship it'), /Only alice/)
  assert.equal(puts.length, 0)
  assert.equal(await P.addFirstMilestone(src, { login: 'alice', name: 'Alice' }, path, '  Ship   a first version '), true)
  const after = data.get(path)!
  assert.match(after, /\nmilestones:\n {2}- text: Ship a first version\n {4}done: false\n/)
  assert.ok(!/\nnext:/.test(after), 'template next: removed')
  const d = parse(path, after).data
  assert.deepEqual(d.milestones, [{ text: 'Ship a first version', done: false }])
  assert.equal(d.color, 3)
  // every other line is unchanged
  const keep = (t: string) => t.split('\n').filter((l) => !/^(milestones:|next:|  - text:|    done:)/.test(l))
  assert.deepEqual(keep(after), keep(text))
  // a second call (it has milestones now) writes nothing
  assert.equal(await P.addFirstMilestone(src, { login: 'alice', name: 'Alice' }, path, 'Again'), false)
})
