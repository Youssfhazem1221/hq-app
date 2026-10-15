// M2 acceptance (6): buildModel on the synthetic team fixture (alice, bob, carol) parsed by the APP's YAML parser:
// people are depth-1 profiles only, events equal M1's hand-reviewed expected-events.json, and routes for people
// paths. Skips when the fixture (private repo) is not there.
import test from 'node:test'
import assert from 'node:assert/strict'
import { app, fixture, readFixtureJson } from './helpers.ts'

const F = await fixture()
const skip = !F && 'fixture not available (public app repo)'
const { buildModel, personOfPath, routeFor } = await app('lib/hq')
const core = await app('lib/people-core')
const M = F ? buildModel(F.FILES) : null

test('(6) buildModel(fixture): 2 people (depth-1 profiles), _team digest is not a person', { skip }, () => {
  assert.equal(M.people.length, 2)
  assert.deepEqual(M.people.map((d: any) => d.path), ['people/alice.md', 'people/bob.md'])
  assert.deepEqual(M.roster.map((p: any) => p.login), ['alice', 'bob'])
  assert.ok(!M.people.some((d: any) => /\/(log|digest)\/|_team/.test(d.path)))
  assert.ok(!M.roster.some((p: any) => p.slug === '_team' || p.slug === 'claude'))
  assert.deepEqual([...M.logs.keys()].sort(), ['alice', 'bob', 'claude'])
  assert.deepEqual([...M.digests.keys()].sort(), ['_team', 'bob'])
  assert.deepEqual(M.knownLogins, ['alice', 'bob', 'carol'], 'carol: a known login without a profile; no claude')
})

test('(6) model.events deep-equal M1 expected-events.json (app YAML parser, same events)', { skip }, () => {
  assert.deepEqual(M.events, readFixtureJson('expected-events.json'))
  assert.ok(M.events.filter((e: any) => e.kind === 'ai.question').every((e: any) => e.title === 'asked AI'), 'question text hidden in the shared model')
})

test('logEntries = parseLog of each month with that person\'s own config (bob\'s old header still maps)', { skip }, () => {
  for (const [s, cfg] of [['alice', M.roster[0].log], ['bob', M.roster[1].log], ['claude', core.CLAUDE_LOG_CONFIG]] as const) {
    const text = F!.FILES.find((f) => f.path === `people/${s}/log/2026-10.md`)!.text
    assert.deepEqual(M.logEntries.get(s), core.parseLog(text, cfg))
  }
  const bobOld = M.logEntries.get('bob').find((e: any) => e.when === '6 Oct 12:00')
  assert.deepEqual(bobOld.fields, { did: 'Read the HQ docs', build_target: 'web', minutes: 30 })
  assert.equal(M.logEntries.get('alice').length, 11)
})

test('existing model parts are unchanged: knowledge has no people/board/todos/ai, projects and todos as before', { skip }, () => {
  assert.ok(!M.knowledge.some((d: any) => /^(board|todos|people|ai)\//.test(d.path)))
  assert.deepEqual(M.projects.map((d: any) => d.path).sort(), ['projects/demo/project.md', 'projects/solo/project.md'])
  assert.equal(M.todos.length, 8)
  assert.equal(M.board.length, 5)
  assert.equal(M.replies.get('20261012-090000-bob-u5p').length, 1)
})

test('a model with no people files at all still builds (today\'s real data shape)', () => {
  const m = buildModel([{ path: 'people/someone.md', text: '---\nname: Someone\ngithub: someone\n---\n' }, { path: 'status.md', text: '# s\n' }])
  assert.equal(m.people.length, 1)
  assert.deepEqual(m.roster.map((p: any) => p.log.preset), ['minimal'], 'no log: block → minimal preset')
  assert.equal(m.logs.size + m.digests.size + m.logEntries.size, 0)
  assert.deepEqual(m.events, [])
})

test('routeFor: profiles, logs and digests open the person; the team digest opens /people/_team; others unchanged', () => {
  assert.equal(routeFor('people/alice.md'), '/people/alice')
  assert.equal(routeFor('people/alice/log/2026-10.md'), '/people/alice')
  assert.equal(routeFor('people/bob/digest/2026-10.md'), '/people/bob')
  assert.equal(routeFor('people/claude/log/2026-10.md'), '/people/claude')
  assert.equal(routeFor('people/_team/digest/2026-10.md'), '/people/_team')
  assert.equal(routeFor('people/alice/notes.md'), '/docs/people/alice/notes.md', 'other files under people/ stay docs')
  assert.equal(routeFor('projects/demo/project.md'), '/projects/demo')
  assert.equal(routeFor('projects/demo/notes.md'), '/docs/projects/demo/notes.md')
  assert.equal(routeFor('investigations/x.md'), '/docs/investigations/x.md')
  assert.equal(routeFor('img.png'), '/docs')
  assert.equal(personOfPath('people/_x.md'), undefined)
})

test('a to-do saved with a byte-order mark keeps its frontmatter in the model (md.parse ignores the BOM)', async () => {
  const { parse } = await app('lib/md')
  const BOM = String.fromCharCode(0xfeff)
  const text = BOM + '---\ntitle: "Ship it"\nstatus: todo\nowner: alice\n---\n\nbody\n'
  const d = parse('todos/t.md', text)
  assert.deepEqual([d.data.title, d.data.status, d.data.owner], ['Ship it', 'todo', 'alice'])
  assert.equal(d.body, '\nbody\n')
  const m = buildModel([{ path: 'todos/t.md', text }])
  assert.equal(m.todos.length, 1)
  assert.equal(m.todos[0].data.status, 'todo')
})
