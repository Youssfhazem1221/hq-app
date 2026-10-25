// STRUCTURE.md `moved:` → where an old link's page lives now (lib/moved.ts). Synthetic paths only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from './helpers.ts'

const { movedTo } = await app('lib/moved')

const MOVED = {
  'investigations/01-ideas.md': 'projects/side/investigations/01-ideas.md',
  'notes/': 'projects/notes/',
  'notes/deep/': 'projects/deep-notes/',
  'bad/': '../outside/',
  'evil.md': 'https://example.com/x.md',
}

test('an exact file entry → its new path', () => {
  assert.equal(movedTo(MOVED, 'investigations/01-ideas.md'), 'projects/side/investigations/01-ideas.md')
})

test('a folder entry (key ending in /) moves everything under it; the longest folder wins', () => {
  assert.equal(movedTo(MOVED, 'notes/a.md'), 'projects/notes/a.md')
  assert.equal(movedTo(MOVED, 'notes/.claude/skills/x/SKILL.md'), 'projects/notes/.claude/skills/x/SKILL.md')
  assert.equal(movedTo(MOVED, 'notes/deep/b.md'), 'projects/deep-notes/b.md')
})

test('unknown paths, bad maps and unsafe targets → ""', () => {
  assert.equal(movedTo(MOVED, 'status.md'), '')
  assert.equal(movedTo(MOVED, 'notesx/a.md'), '')
  assert.equal(movedTo(MOVED, 'bad/a.md'), '')
  assert.equal(movedTo(MOVED, 'evil.md'), '')
  assert.equal(movedTo(undefined, 'notes/a.md'), '')
  assert.equal(movedTo(['notes/'], 'notes/a.md'), '')
  assert.equal(movedTo('notes/', 'notes/a.md'), '')
  assert.equal(movedTo(MOVED, ''), '')
})
