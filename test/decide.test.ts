// C1-3 · Decide end to end through the real local write path: the dev-server middleware (hqLocal) on a temp copy of
// the synthetic team fixture, driven by the app's LocalSource. As the project owner, Pick this writes ONLY
// status/done_at/done_by/choice on the to-do and done + date on the matching milestone; as someone else, only the to-do.
// Undo restores the exact bytes. Skipped in the public app repo (the fixture lives in the private repo).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { app, fixture, rm, startLocal, tmpDir } from './helpers.ts'

const N = await app('lib/next-core')
const { LocalSource } = await app('lib/source')
const { buildModel } = await app('lib/hq')
const F = await fixture()

const fm = (lines: string[], body = '') => ['---', ...lines, '---', '', body, ''].join('\n')
const EXTRA: Record<string, string> = {
  'notes/earn.md': fm(['title: "Ways to earn"', 'options:',
    '  - name: Audits for small shops', '    first_money: 2–4 weeks', '    evidence: "✅ own case study"', '    recommended: true',
    '  - name: Template packs', '    first_money: Jan–Feb', '    evidence: "✅ signal · ⚠️ payouts"']),
  'projects/pricing/project.md': fm(['title: Pricing', 'type: project', 'owner: alice', 'status: waiting', 'color: 4', 'updated: 2026-10-14',
    'next: "Pick a pricing direction (#1, #2, both, other)"', 'hub: notes/earn.md',
    'milestones:', '  - text: "Research options"', '    date: 2026-10-02', '    done: true', '  - text: "Pick a direction"', '    done: false', '  - text: "First paid audit"', '    done: false']),
  'todos/20261014-140003-claude-p04.md': fm(['id: 20261014-140003-claude-p04', 'title: "Pick a pricing direction (#1, #2, both, other)"', 'status: todo', 'owner: alice',
    'created: 2026-10-14T14:00:03Z', 'by: claude', 'link: notes/earn.md']),
  'todos/20261015-100000-alice-b05.md': fm(['id: 20261015-100000-alice-b05', 'title: "Choose an audit tool to try"', 'kind: decision', 'status: todo', 'owner: bob',
    'created: 2026-10-15T10:00:00Z', 'by: alice', 'project: pricing', 'link: notes/earn.md']),
}
function seed(name: string) {
  const root = F!.materialize(tmpDir(name))
  for (const [p, t] of Object.entries(EXTRA)) {
    fs.mkdirSync(path.join(root, path.dirname(p)), { recursive: true })
    fs.writeFileSync(path.join(root, p), t)
  }
  return root
}
const read = (root: string, p: string) => fs.readFileSync(path.join(root, p), 'utf8')
/** +/- lines between two texts (order kept; enough for small frontmatter edits). */
function changed(a: string, b: string) {
  const A = a.split('\n')
  const B = b.split('\n')
  return [...A.filter((l) => !B.includes(l)).map((l) => '-' + l), ...B.filter((l) => !A.includes(l)).map((l) => '+' + l)]
}

test('C1-3 · as the owner (alice): Pick this → to-do status/done_at/done_by/choice + milestone done/date; Undo → bytes back', { skip: !F && 'fixture not available (public app repo)' }, async (t) => {
  const root = seed('decide-alice')
  const local = await startLocal(root, 'alice')
  t.after(async () => {
    await local.close()
    rm(root)
  })
  const src = new LocalSource()
  const me = await src.me()
  const model = buildModel(await src.loadAll())
  const TODO = 'todos/20261014-140003-claude-p04.md'
  const PROJ = 'projects/pricing/project.md'
  // it IS my Next, as a decision
  const q = N.nextQueue(model, me, '2026-10-15T12:00:00Z')
  assert.equal(q[0].id, 'todo:' + TODO)
  assert.equal(q[0].kind, 'decision')
  const t0 = read(root, TODO)
  const p0 = read(root, PROJ)
  const r = await N.decide(src, me, model, TODO, N.choiceLabel(model.byPath.get('notes/earn.md').data.options, 0), { now: '2026-10-15T12:00:00Z', day: '2026-10-15' })
  assert.equal(r.written, true)
  assert.equal(r.ticked, 'Pick a direction')
  assert.deepEqual(changed(t0, read(root, TODO)), ['-status: todo', '+status: done', '+done_at: 2026-10-15T12:00:00Z', '+done_by: alice', '+choice: "#1 Audits for small shops"'])
  // exactly: the "Pick a direction" item gained a date and flipped to done; nothing else in the file moved
  assert.equal(read(root, PROJ), p0.replace('  - text: "Pick a direction"\n    done: false', '  - text: "Pick a direction"\n    date: 2026-10-15\n    done: true'))
  assert.ok(local.posts.every((x) => x.expect && x.expect !== 'absent'), 'every write was an update with expect = sha1 (never a blind overwrite)')
  // the Next moved on
  const after = N.nextQueue(buildModel(await src.loadAll()), me, '2026-10-15T12:00:00Z')
  assert.notEqual(after[0].id, 'todo:' + TODO)
  await r.undo()
  assert.equal(read(root, TODO), t0, 'to-do bytes restored')
  assert.equal(read(root, PROJ), p0, 'project bytes restored')
})

test('C1-3 · as someone who does not own the project (bob on alice\'s): only the to-do is written', { skip: !F && 'fixture not available (public app repo)' }, async (t) => {
  const root = seed('decide-bob')
  const local = await startLocal(root, 'bob')
  t.after(async () => {
    await local.close()
    rm(root)
  })
  const src = new LocalSource()
  const me = await src.me()
  const model = buildModel(await src.loadAll())
  const TODO = 'todos/20261015-100000-alice-b05.md'
  const PROJ = 'projects/pricing/project.md'
  assert.ok(N.nextQueue(model, me, '2026-10-15T12:00:00Z').some((x: any) => x.id === 'todo:' + TODO && x.kind === 'decision'))
  const p0 = read(root, PROJ)
  const t0 = read(root, TODO)
  const r = await N.decide(src, me, model, TODO, '#1 Audits for small shops', { now: '2026-10-15T12:00:00Z' })
  assert.equal(r.ticked, null)
  assert.deepEqual(local.posts.map((x) => x.path), [TODO])
  assert.equal(read(root, PROJ), p0, 'alice\'s project.md untouched')
  assert.deepEqual(changed(t0, read(root, TODO)), ['-status: todo', '+status: done', '+done_at: 2026-10-15T12:00:00Z', '+done_by: bob', '+choice: "#1 Audits for small shops"'])
  await r.undo()
  assert.equal(read(root, TODO), t0)
})

test('Done (completeItem) through LocalSource: stamps only, undo restores bytes; the queue moves on and back', { skip: !F && 'fixture not available (public app repo)' }, async (t) => {
  const root = seed('done-alice')
  const local = await startLocal(root, 'alice')
  t.after(async () => {
    await local.close()
    rm(root)
  })
  const src = new LocalSource()
  const me = await src.me()
  const TODO = 'todos/20261015-090000-bob-r4m.md'
  const t0 = read(root, TODO)
  const undo = await N.completeItem(src, me, buildModel(await src.loadAll()), { path: TODO, text: 'Review the map screen' }, { now: '2026-10-15T12:00:00Z' })
  assert.deepEqual(changed(t0, read(root, TODO)), ['-status: todo', '+status: done', '+done_at: 2026-10-15T12:00:00Z', '+done_by: alice'])
  assert.ok(!N.nextQueue(buildModel(await src.loadAll()), me, '2026-10-15T12:00:00Z').some((x: any) => x.path === TODO))
  await undo()
  assert.equal(read(root, TODO), t0)
  assert.ok(N.nextQueue(buildModel(await src.loadAll()), me, '2026-10-15T12:00:00Z').some((x: any) => x.path === TODO))
})
