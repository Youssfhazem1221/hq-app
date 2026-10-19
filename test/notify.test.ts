// The bell (board notifications, lib/notify-core.ts): who hears about what, the reply + close merge, the read state on
// this device, the words and the Board link. Synthetic team only (alice, bob, carol), built inline: no fixture needed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from './helpers.ts'

const nc = await app('lib/notify-core')
const { buildModel } = await app('lib/hq')

const NOW = '2026-10-14T12:00:00Z'
const fm = (keys: Record<string, unknown>, body: string) =>
  `---\n${Object.entries(keys).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n${body}\n`
const post = (id: string, keys: Record<string, unknown>, body: string) => ({ path: `board/${id}.md`, text: fm({ id, ...keys }, body) })
const reply = (parent: string, id: string, keys: Record<string, unknown>, body: string) => ({
  path: `board/replies/${parent}--${id}.md`,
  text: fm({ id, parent, ...keys }, body),
})

const FILES = [
  post('20261001-090000-claude-w01', { author: 'claude', created: '2026-10-01T09:00:00Z', type: 'update', status: 'open', welcome: true }, '👋 **Welcome to the board.**'),
  post('20260801-090000-bob-old', { author: 'bob', created: '2026-08-01T09:00:00Z', type: 'idea', status: 'open' }, 'An old idea'),
  // bob's post: alice replies, then carol (alice is in the thread by then)
  post('20261010-090000-bob-p01', { author: 'bob', created: '2026-10-10T09:00:00Z', type: 'thought', status: 'open', project: 'demo' }, 'Map screen is up. Thoughts?'),
  reply('20261010-090000-bob-p01', '20261010-100000-alice-r01', { author: 'alice', created: '2026-10-10T10:00:00Z' }, 'Needs a legend.'),
  reply('20261010-090000-bob-p01', '20261011-090000-carol-r02', { author: 'carol', created: '2026-10-11T09:00:00Z' }, 'Agree, and a scale bar.'),
  // alice's post: bob replies at 09:00 and closes at 09:02 → one item for alice
  post('20261012-080000-alice-p02', { author: 'alice', created: '2026-10-12T08:00:00Z', type: 'question', status: 'done', closed_at: '2026-10-12T09:02:00Z', closed_by: 'bob' }, 'Where is the demo token?'),
  reply('20261012-080000-alice-p02', '20261012-090000-bob-r03', { author: 'bob', created: '2026-10-12T09:00:00Z' }, 'In Settings → Connection.'),
  // carol's post to alice, answered by the Claude bridge
  post('20261013-080000-carol-p03', { author: 'carol', created: '2026-10-13T08:00:00Z', type: 'question', status: 'open', to: 'alice', for_claude: true }, 'Can you check the **onboarding** text?'),
  reply('20261013-080000-carol-p03', '20261013-090000-claude-r04', { author: 'claude', via: 'bridge', created: '2026-10-13T09:00:00Z' }, 'Done: tightened the copy.'),
]
const model = buildModel(FILES)
const notes = (login: string, opts?: object) => nc.notesFor(model, login, NOW, opts)
const brief = (login: string) => notes(login).map((n: any) => `${n.kind} ${n.actor} ${n.post.split('-').pop()}`)

test('who hears what: new posts → everyone but the author; replies + closes → the author and the thread', () => {
  assert.deepEqual(brief('alice'), [
    'post carol p03', // to alice
    'replied-closed bob p02', // her own post: reply + close merged
    'reply carol p01', // she replied there first
    'post bob p01',
  ])
  assert.deepEqual(
    brief('bob'),
    ['post carol p03', 'post alice p02', 'reply carol p01', 'reply alice p01'],
    'bob: new posts and the replies on his post; not Claude in a thread he is not in, nothing for his own reply + close',
  )
  assert.deepEqual(brief('carol'), ['reply claude p03', 'post alice p02', 'post bob p01'], 'carol: the bridge answered her post; her own reply stays quiet')
  for (const who of ['alice', 'bob', 'carol']) {
    assert.ok(!notes(who).some((n: any) => n.post.endsWith('w01')), 'the welcome post never notifies')
    assert.ok(!notes(who).some((n: any) => n.post.endsWith('old')), 'older than 30 days: out of the list')
    assert.ok(!notes(who).some((n: any) => n.actor.toLowerCase() === who), 'never your own actions')
  }
  assert.deepEqual(nc.notesFor(model, '', NOW), [], 'no login, no list')
  assert.deepEqual(nc.notesFor(model, 'alice', 'not a time'), [])
})

test('items carry the post, the snippet, the project and whether it is mine', () => {
  const [toMe, merged, thread] = notes('alice')
  assert.equal(toMe.toMe, true)
  assert.equal(toMe.title, 'Can you check the onboarding text?', 'first line without markdown')
  assert.equal(merged.kind, 'replied-closed')
  assert.equal(merged.hashes.length, 2, 'one read key per event')
  assert.equal(merged.at, '2026-10-12T09:02:00Z', 'the later of the two')
  assert.equal(merged.snippet, 'In Settings → Connection.')
  assert.equal(merged.mine, true)
  assert.equal(thread.mine, false)
  assert.equal(thread.postAuthor, 'bob')
  assert.equal(thread.project, 'demo')
  assert.ok(notes('alice').every((n: any) => n.hashes.every((h: string) => /^[0-9a-f]{8}$/.test(h))))
  const bridge = notes('carol')[0]
  assert.equal(bridge.actor, 'claude', 'bridge replies come from Claude')
  assert.equal(bridge.snippet, 'Done: tightened the copy.')
})

test('a reply and a close far apart stay two items; max and days limit the list', () => {
  const far = buildModel([
    ...FILES.filter((f) => !f.path.includes('alice-p02')),
    post('20261012-080000-alice-p02', { author: 'alice', created: '2026-10-12T08:00:00Z', type: 'question', status: 'done', closed_at: '2026-10-12T10:00:00Z', closed_by: 'bob' }, 'Where is the demo token?'),
    reply('20261012-080000-alice-p02', '20261012-090000-bob-r03', { author: 'bob', created: '2026-10-12T09:00:00Z' }, 'In Settings.'),
  ])
  const kinds = nc.notesFor(far, 'alice', NOW).filter((n: any) => n.post.endsWith('p02')).map((n: any) => n.kind)
  assert.deepEqual(kinds, ['closed', 'reply'])
  assert.equal(notes('alice', { max: 2 }).length, 2)
  assert.deepEqual(notes('alice', { days: 3 }).map((n: any) => n.kind), ['post', 'replied-closed'], 'only the last 3 days')
})

test('read state: first run = the last day unread; mark one, mark all; the marker never moves back', () => {
  const list = notes('alice')
  const first = nc.cleanRead(null, '2026-10-14T06:00:00Z')
  assert.deepEqual(first, { at: '2026-10-13T06:00:00Z', read: [] })
  assert.deepEqual(list.map((n: any) => nc.isUnread(n, first)), [true, false, false, false], 'only the post from the last 24 h')
  assert.equal(nc.unreadCount(list, { at: '2026-10-01T00:00:00Z', read: [] }), 4)
  const one = nc.markRead({ at: '2026-10-01T00:00:00Z', read: [] }, list[1])
  assert.deepEqual(one.read, list[1].hashes, 'both keys of a merged item')
  assert.equal(nc.isUnread(list[1], one), false)
  assert.equal(nc.markRead(one, list[1]), one, 'marking twice changes nothing')
  const all = nc.markAllRead(one, list, NOW)
  assert.deepEqual(all, { at: NOW, read: [] })
  assert.equal(nc.unreadCount(list, all), 0)
  assert.equal(nc.markAllRead({ at: '2026-10-20T00:00:00Z', read: [] }, list, NOW).at, '2026-10-20T00:00:00Z', 'never moves back')
  const future = [{ ...list[0], at: '2026-10-14T12:05:00Z' }]
  assert.equal(nc.markAllRead(first, future, NOW).at, '2026-10-14T12:05:00Z', 'a clock a little ahead still counts as read')
})

test('read state from storage: junk is dropped, at most 200 keys, no text or paths', () => {
  assert.deepEqual(nc.cleanRead({ at: 'soon', read: ['x'] }, NOW), nc.firstRead(NOW), 'no valid time → a first run')
  assert.deepEqual(nc.cleanRead('[]', NOW), nc.firstRead(NOW))
  const s = nc.cleanRead({ at: '2026-10-02T00:00:00Z', read: ['deadbeef', 'deadbeef', 'board/x.md', 42, 'ABCDEF12', ...Array.from({ length: 250 }, (_, i) => i.toString(16).padStart(8, '0'))] }, NOW)
  assert.equal(s.read.length, 200)
  assert.ok(s.read.every((h: string) => /^[0-9a-f]{8}$/.test(h)), 'only short hashes')
  assert.ok(!s.read.includes('deadbeef'), 'the oldest keys go first')
  let state = nc.firstRead(NOW)
  for (const n of notes('alice')) state = nc.markRead(state, n)
  assert.deepEqual(Object.keys(state).sort(), ['at', 'read'])
  assert.doesNotMatch(JSON.stringify(state), /board|alice|bob|token|\//, 'nothing readable in storage')
})

test('fresh items: nothing on the first look, then only what is new', () => {
  const list = notes('alice')
  assert.deepEqual(nc.freshNotes(null, list), [])
  const before = new Set(list.slice(1).map((n: any) => n.hashes[0]))
  assert.deepEqual(nc.freshNotes(before, list), [list[0]])
  assert.deepEqual(nc.freshNotes(new Set(list.map((n: any) => n.hashes[0])), list), [])
})

test('words: your / their / someone’s post, posted to you; pop-up titles', () => {
  const name = (l: string) => ({ alice: 'Alice', bob: 'Bob', carol: 'Carol', claude: 'Claude' })[l] || l
  const [toMe, merged, thread, posted] = notes('alice').map((n: any) => nc.noteWords(n, name).line)
  assert.equal(toMe, 'Carol posted to you: Can you check the onboarding text?')
  assert.equal(merged, 'Bob replied and closed your post: Where is the demo token?')
  assert.equal(thread, 'Carol replied to Bob’s post: Map screen is up. Thoughts?')
  assert.equal(posted, 'Bob posted: Map screen is up. Thoughts?')
  const own = { ...notes('alice')[2], actor: 'bob', kind: 'closed' }
  assert.equal(nc.noteWords(own, name).what, 'closed their post')
  assert.equal(nc.POPUP_TITLE['replied-closed'], 'Reply · post closed')
})

test('the Board link round-trips; anything else is no post', () => {
  const n = notes('alice')[0]
  const href = nc.noteHref(n)
  assert.equal(href, '#/board?post=20261013-080000-carol-p03')
  assert.equal(nc.postFromHash(href), '20261013-080000-carol-p03')
  assert.equal(nc.postFromHash('#/board?x=1&post=abc'), 'abc')
  assert.equal(nc.postFromHash('#/board'), '')
  assert.equal(nc.postFromHash('#/docs/board?post=abc'), '', 'only the Board route')
  assert.equal(nc.postFromHash('#/board?post=%E0%A4%A'), '', 'a broken escape is no post')
})
