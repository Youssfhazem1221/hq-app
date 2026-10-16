// Project board + grouped pages: synthetic projects only (the public app repo holds no real content).
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from './helpers.ts'

const B = await app('lib/project-board')
const { parse } = await app('lib/md')

const fm = (o: Record<string, string>) => '---\n' + Object.entries(o).map(([k, v]) => `${k}: ${v}`).join('\n') + '\n---\n\nBody\n'
const project = parse('projects/demo/project.md', `---
title: Demo
owner: alice
hub: projects/demo/brief.md
board:
  title: Episodes
  folder: eps
  lanes:
    - { name: Idea, stages: [idea] }
    - { name: Making, stages: [draft, script] }
    - { name: Live, stages: [published] }
  due: { script: -3, published: 0 }
---
`)
const files = [
  parse('projects/demo/brief.md', fm({ title: 'Brief' })),
  parse('projects/demo/eps/README.md', fm({ title: '"Episodes: the pipeline"' })),
  parse('projects/demo/eps/calendar.md', fm({ title: 'Calendar' })),
  parse('projects/demo/eps/01-a/README.md', fm({ title: '"01 · A"', stage: 'draft', publish: '2026-10-18' })),
  parse('projects/demo/eps/01-a/script.md', fm({ title: '"Script 01 · A"' })),
  parse('projects/demo/eps/02-b/README.md', fm({ title: '"02 · B"', stage: 'idea', publish: '2026-10-21' })),
  parse('projects/demo/eps/03-c/README.md', fm({ title: '"03 · C"', stage: 'mystery' })),
  parse('projects/demo/kit/README.md', fm({ title: 'Kit' })),
  parse('projects/demo/kit/template/README.md', fm({ title: '"{{NN}} · {{TITLE}}"' })),
  parse('projects/demo/notes/deep/x.md', fm({ title: 'Deep note' })),
]

test('boardConfig: clean config from project.md; junk → null', () => {
  const c = B.boardConfig(project, 'demo')
  assert.equal(c.folder, 'projects/demo/eps')
  assert.deepEqual(c.stages, ['idea', 'draft', 'script', 'published'])
  assert.deepEqual(c.due, { script: -3, published: 0 })
  assert.equal(c.field, 'stage')
  assert.equal(c.date, 'publish')
  for (const bad of [null, {}, { board: 'x' }, { board: { folder: '../x', lanes: [{ name: 'A', stages: ['a'] }] } }, { board: { folder: 'eps', lanes: [] } }])
    assert.equal(B.boardConfig(bad && { path: 'p', data: bad, body: '' }, 'demo'), null)
})

test('boardOf: lanes, dates, next gate, late flag, links, unknown stage → first lane', () => {
  const b = B.boardOf(B.boardConfig(project, 'demo'), files, '2026-10-16')
  assert.equal(b.total, 3)
  const [idea, making, live] = b.lanes
  assert.deepEqual(idea.cards.map((c: any) => c.item), ['02-b', '03-c'])
  assert.deepEqual(making.cards.map((c: any) => c.item), ['01-a'])
  assert.equal(live.cards.length, 0)
  const a = making.cards[0]
  assert.equal(a.date, '2026-10-18')
  assert.deepEqual(a.next, { stage: 'script', due: '2026-10-15' })
  assert.equal(a.late, true)
  assert.deepEqual(a.links.map((l: any) => l.title), ['Script 01 · A'])
  assert.equal(idea.cards[1].next, null)
})

test('setCard: only the stage and date keys change', () => {
  const cfg = B.boardConfig(project, 'demo')
  const src = '---\ntitle: "01 · A"\nstage: draft\npublish: 2026-10-18\ncast: [x]\n---\n\nBody stays\n'
  const out = B.setCard(src, cfg, { stage: 'script', date: '2026-10-20' })
  const d = parse('x.md', out)
  assert.equal(d.data.stage, 'script')
  assert.equal(B.isoOf(d.data.publish), '2026-10-20')
  assert.match(out, /cast: \[x\]/)
  assert.match(out, /Body stays/)
  assert.equal(B.setCard(src, cfg, { stage: 'bad stage!' }), src)
})

test('pageGroups: root first, folder README names its group, sub-folders collapse to one row, templates hidden', () => {
  const g = B.pageGroups('demo', [project, ...files], { hub: 'projects/demo/brief.md', boardFolder: 'projects/demo/eps' })
  assert.deepEqual(g.map((x: any) => x.label), ['Main pages', 'Episodes: the pipeline', 'Kit', 'Notes'])
  const eps = g[1]
  assert.equal(eps.board, true)
  assert.equal(eps.index, 'projects/demo/eps/README.md')
  assert.deepEqual(eps.rows.map((r: any) => r.title), ['Calendar', '01 · A', '02 · B', '03 · C'])
  assert.deepEqual(eps.rows[1].links.map((l: any) => l.title), ['Script 01 · A'])
  assert.equal(g[2].rows.length, 0, 'the template page is hidden')
  assert.deepEqual(g[3].rows.map((r: any) => r.title), ['Deep note'])
  assert.equal(B.dayName('2026-10-18'), 'Sun 18 Oct')
})

test('pageGroups: a hub outside the folder stays on top of Main pages; `order` (hub, docs:) leads each group', () => {
  const outside = parse('ideas/big.md', fm({ title: '"Big idea"' }))
  const order = ['ideas/big.md', 'projects/demo/eps/03-c/README.md', 'projects/demo/eps/02-b/README.md']
  const g = B.pageGroups('demo', [outside, project, ...files], { hub: 'ideas/big.md', order })
  assert.deepEqual(g[0].rows.map((r: any) => r.title), ['Big idea', 'Brief'])
  assert.deepEqual(g[1].rows.map((r: any) => r.title), ['03 · C', '02 · B', 'Calendar', '01 · A'])
  assert.equal(g.flatMap((x: any) => x.rows).filter((r: any) => r.path === 'ideas/big.md').length, 1)
})
