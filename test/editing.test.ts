// Editing inside the app (phase 3 of HQ as a portfolio): lib/fm-edit (milestones, blocks, upload names and folders).
// Every edit must change only its own part: the other bytes stay, CRLF included. Synthetic notes only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from './helpers.ts'

const E = await app('lib/fm-edit')

const PROJECT = [
  '---',
  'title: "Demo"',
  'owner: alice',
  'status: active',
  'milestones:',
  '  - text: "First step"',
  '    date: 2026-10-01',
  '    done: true',
  '  - text: "Second step"',
  '    done: false',
  '  - text: Third',
  '    done: false',
  'color: 3',
  '---',
  '',
  '# Demo',
  '',
].join('\n')

test('editMilestone: rename keeps every other line; dates are set, changed and removed in place', () => {
  const renamed = E.editMilestone(PROJECT, 1, { text: 'Second step, done right: "quoted"' })
  assert.equal(renamed, PROJECT.replace('  - text: "Second step"', '  - text: "Second step, done right: \\"quoted\\""'))
  const dated = E.editMilestone(PROJECT, 2, { date: '2026-11-05' })
  assert.equal(dated, PROJECT.replace('  - text: Third\n', '  - text: Third\n    date: 2026-11-05\n'))
  assert.equal(E.editMilestone(PROJECT, 0, { date: '2026-10-02' }), PROJECT.replace('date: 2026-10-01', 'date: 2026-10-02'))
  assert.equal(E.editMilestone(PROJECT, 0, { date: null }), PROJECT.replace('    date: 2026-10-01\n', ''))
  assert.equal(E.editMilestone(PROJECT, 0, { date: 'next week' }), PROJECT, 'a bad date changes nothing')
  assert.equal(E.editMilestone(PROJECT, 0, { text: '  ' }), PROJECT, 'an empty name changes nothing')
  assert.equal(E.editMilestone(PROJECT, 9, { text: 'x' }), PROJECT, 'no such milestone')
})

test('editMilestone / moveMilestone keep CRLF', () => {
  const crlf = PROJECT.replace(/\n/g, '\r\n')
  const out = E.editMilestone(crlf, 2, { date: '2026-11-05' })
  assert.ok(!/[^\r]\n/.test(out), 'no bare LF added')
  assert.ok(out.includes('  - text: Third\r\n    date: 2026-11-05\r\n'))
  const moved = E.moveMilestone(crlf, 2, -1)
  assert.ok(!/[^\r]\n/.test(moved))
  assert.equal(E.milestoneCount(moved), 3)
})

test('removeMilestone / moveMilestone: whole items move or go; the last one leaves "milestones: []"', () => {
  const gone = E.removeMilestone(PROJECT, 1)
  assert.equal(gone, PROJECT.replace('  - text: "Second step"\n    done: false\n', ''))
  const down = E.moveMilestone(PROJECT, 0, 1)
  assert.ok(down.indexOf('Second step') < down.indexOf('First step'))
  assert.ok(down.includes('  - text: "First step"\n    date: 2026-10-01\n    done: true\n  - text: Third'), 'the item moves with its lines')
  assert.equal(E.moveMilestone(PROJECT, 0, -1), PROJECT, 'the first item cannot move up')
  assert.equal(E.moveMilestone(PROJECT, 2, 1), PROJECT, 'the last item cannot move down')
  assert.equal(E.moveMilestone(E.moveMilestone(PROJECT, 1, 1), 2, -1), PROJECT, 'down then up = the same text')
  let one = PROJECT
  for (let i = 0; i < 3; i++) one = E.removeMilestone(one, 0)
  assert.ok(one.includes('milestones: []\ncolor: 3'), one)
  assert.equal(E.milestoneCount(one), 0)
  const inline = '---\nmilestones: [{text: a, done: false}]\n---\n'
  assert.equal(E.removeMilestone(inline, 0), inline, 'an inline list is left alone')
})

const NOTE = [
  '---',
  'title: Note',
  '---',
  '# Note',
  'Intro line one',
  'intro line two',
  '',
  '## Section',
  '- a',
  '- b',
  '',
  '```explainer',
  '{"type":"flow",',
  '',
  '"steps":[]}',
  '```',
  '',
  '| A | B |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  'Last.',
  '',
].join('\n')

test('splitBlocks: headings alone, fenced blocks whole (blank lines inside too), exact offsets', () => {
  const b = E.splitBlocks(NOTE)
  assert.deepEqual(b.map((x: any) => x.kind), ['heading', 'para', 'heading', 'list', 'explainer', 'table', 'para'])
  for (const x of b) assert.equal(NOTE.slice(x.start, x.end), x.src)
  assert.equal(b[1].src, 'Intro line one\nintro line two')
  assert.ok(b[4].src.startsWith('```explainer') && b[4].src.endsWith('```'))
  assert.equal(E.splitBlocks('no frontmatter\n\nsecond').length, 2)
  assert.equal(E.bodyStart(NOTE), NOTE.indexOf('# Note'))
})

test('replaceBlock / insertBlock / removeBlock / moveBlock change only their block; a stale block is refused', () => {
  const b = E.splitBlocks(NOTE)
  assert.equal(E.replaceBlock(NOTE, b[1], 'New intro.'), NOTE.replace('Intro line one\nintro line two', 'New intro.'))
  assert.equal(E.insertBlock(NOTE, b[3], 'After the list.'), NOTE.replace('- a\n- b\n', '- a\n- b\n\nAfter the list.\n'))
  assert.equal(E.insertBlock(NOTE, null, 'At the end.'), NOTE.replace('Last.\n', 'Last.\n\nAt the end.\n'))
  assert.equal(E.removeBlock(NOTE, b[5]), NOTE.replace('| A | B |\n|---|---|\n| 1 | 2 |\n\n', ''))
  assert.equal(E.removeBlock(NOTE, b[6]), NOTE.replace('\n\nLast.\n', '\n'), 'the last block: one line end stays')
  assert.equal(E.replaceBlock(NOTE, b[1], '   '), E.removeBlock(NOTE, b[1]), 'an empty text removes the block')
  const swapped = E.moveBlock(NOTE, b, 5, 1)
  assert.ok(swapped.indexOf('Last.') < swapped.indexOf('| A | B |'))
  assert.equal(E.moveBlock(swapped, E.splitBlocks(swapped), 5, 1), NOTE, 'moving back restores the note')
  assert.throws(() => E.replaceBlock(NOTE.replace('Intro line one', 'Someone else changed this'), b[1], 'x'), E.StalePartError)
  const crlf = NOTE.replace(/\n/g, '\r\n')
  const cb = E.splitBlocks(crlf)
  const out = E.replaceBlock(crlf, cb[1], 'Two\nlines')
  assert.ok(out.includes('Two\r\nlines') && !/[^\r]\n/.test(out), 'typed line breaks follow the note (CRLF)')
})

test('uploads: safe names, the folder by kind, never project.md or a dot / parent folder', () => {
  assert.equal(E.safeFileName('My Notes (v2).MD'), 'my-notes-v2.md')
  assert.equal(E.safeFileName('C:\\fake\\Café Menu.CSV'), 'cafe-menu.csv')
  assert.equal(E.safeFileName('../../.env'), 'file.env', 'a dot-file name gets a visible stem')
  assert.equal(E.uploadPath('demo', '../../.env'), null, '.env is not a kind HQ uploads')
  assert.equal(E.uploadPath('demo', 'Notes.md'), 'projects/demo/notes.md')
  assert.equal(E.uploadPath('demo', 'prices.CSV'), 'projects/demo/data/prices.csv')
  assert.equal(E.uploadPath('demo', 'Cover Photo.JPG'), 'projects/demo/media/cover-photo.jpg')
  assert.equal(E.uploadPath('demo', 'clip.mp4'), 'projects/demo/media/clip.mp4')
  assert.equal(E.uploadPath('demo', 'notes.md', 'research'), 'projects/demo/research/notes.md')
  for (const [slug, name, folder] of [['demo', 'tool.exe', undefined], ['demo', 'project.md', ''], ['demo', 'x.md', '../x'], ['demo', 'x.md', '.claude'], ['../x', 'a.md', undefined], ['.hq', 'a.md', undefined]])
    assert.equal(E.uploadPath(slug, name, folder), null, `${slug} ${name} ${folder}`)
  assert.equal(E.uploadMax('md'), 200_000)
  assert.equal(E.uploadMax('png'), 25_000_000)
  assert.equal(E.uploadMax('mp4'), 50_000_000)
})

// ---- saving: lib/edit-io + the dev server's /__hq/upload ------------------------------------------------------------

import fs from 'node:fs'
import path from 'node:path'
import { rm, startLocal, tmpDir } from './helpers.ts'

const IO = await app('lib/edit-io')
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0x80])

test('/__hq/upload: the owner adds a media file (create-only, typed, size-capped) and removes it; others are refused', async () => {
  const root = tmpDir('upload')
  const put = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), text)
  }
  put('projects/mine/project.md', '---\ntitle: Mine\nowner: alice\n---\n')
  put('projects/theirs/project.md', '---\ntitle: Theirs\nowner: bob\n---\n')
  const local = await startLocal(root, 'alice')
  try {
    const { LocalSource } = await app('lib/source')
    const src = new LocalSource()
    await IO.createBytes(src, 'projects/mine/media/pic.png', new Blob([PNG]), 'upload')
    assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(root, 'projects/mine/media/pic.png'))), PNG, 'exact bytes')
    await assert.rejects(IO.createBytes(src, 'projects/mine/media/pic.png', new Blob([PNG]), 'again'), /already exists/, 'never overwrites')
    await assert.rejects(IO.createBytes(src, 'projects/theirs/media/pic.png', new Blob([PNG]), 'x'), /Only bob/)
    for (const p of ['projects/mine/x.md', 'projects/mine/run.exe', 'projects/mine/../../x.png', 'people/alice/pic.png', '.hq/x.png', 'projects/mine/.claude/x.png'])
      await assert.rejects(IO.createBytes(src, p, new Blob([PNG]), 'x'), /Not saved/, p)
    await IO.createText(src, 'projects/mine/data/a.json', '{"a":1}', 'upload json')
    assert.equal(fs.readFileSync(path.join(root, 'projects/mine/data/a.json'), 'utf8'), '{"a":1}')
    await assert.rejects(IO.createText(src, 'projects/mine/data/a.json', '{}', 'again'), /already exists/)
    await IO.removeFile(src, 'projects/mine/media/pic.png', 'remove')
    assert.equal(fs.existsSync(path.join(root, 'projects/mine/media/pic.png')), false)
    await IO.removeFile(src, 'projects/mine/data/a.json', 'remove', '{"a":1}')
    assert.equal(fs.existsSync(path.join(root, 'projects/mine/data/a.json')), false)
  } finally {
    await local.close()
    rm(root)
  }
})

test('createBytes / removeFile on GitHub: the contents API with the token in the header only; 422 = exists', async () => {
  const real = globalThis.fetch
  const calls: { url: string; method: string; headers: Record<string, string>; body?: any }[] = []
  globalThis.fetch = (async (url: any, init: any = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined })
    if (String(url).includes('taken.png')) return new Response('{"message":"sha wasn\'t supplied"}', { status: 422 })
    if ((init.method || 'GET') === 'GET') return new Response(JSON.stringify({ sha: 'abc123' }), { status: 200 })
    return new Response('{}', { status: 201 })
  }) as typeof fetch
  try {
    const src = { kind: 'github', auth: { token: 'tok_9', repo: 'o/r', branch: 'main' } }
    await IO.createBytes(src, 'projects/p/media/my pic.png', new Blob([PNG]), 'upload: my pic')
    assert.equal(calls[0].url, 'https://api.github.com/repos/o/r/contents/projects/p/media/my%20pic.png')
    assert.equal(calls[0].method, 'PUT')
    assert.equal(calls[0].headers.Authorization, 'Bearer tok_9')
    assert.equal(calls[0].body.content, Buffer.from(PNG).toString('base64'))
    assert.equal(calls[0].body.sha, undefined, 'no sha: GitHub refuses to overwrite')
    assert.ok(!calls.some((c) => c.url.includes('tok_9')))
    await assert.rejects(IO.createBytes(src, 'projects/p/media/taken.png', new Blob([PNG]), 'x'), /already exists/)
    await IO.removeFile(src, 'projects/p/media/old.png', 'remove old')
    const del = calls.find((c) => c.method === 'DELETE')!
    assert.equal(del.body.sha, 'abc123', 'deletes the blob it just looked up')
  } finally {
    globalThis.fetch = real
  }
})
