// Ask AI changes (2026-10-20): reading proposals back from an answer (lib/ai-changes), applying and undoing them as
// the person clicking (lib/ai-apply + Source.apply), and the dev server's AI write mode (via: "ai"). Temp folders and
// synthetic logins only (alice, bob).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP, app, rm, startLocal, tmpDir, viteConfig } from './helpers.ts'

const { splitChanges, validChange, changesOf } = await app('lib/ai-changes')
const { applyChange, undoChange, stateOf, priorText, refusalOf, commitMessage } = await app('lib/ai-apply')
const { textSha1 } = await app('lib/write-policy')
const { answerParts, stripChanges } = await app('lib/read-core')
const { historyOf } = await app('lib/askStream')
const { LocalSource, StaleWriteError } = await app('lib/source')
const { RepoSync } = await app('lib/sync')
const { localAiWrite, textSha1: serverSha1 } = await viteConfig()

// The shared server code lives in the private repo; tests that need it skip in the public app repo.
const SHARED = path.resolve(APP, '..', 'supabase', 'functions', '_shared', 'propose.mjs')
const R: any = fs.existsSync(SHARED) ? await import(pathToFileURL(SHARED).href) : null

const NOW = '2026-10-20T10:00:00Z'
const ME = { login: 'alice', name: 'Alice' }
const sha = (s: string) => textSha1(s)

/** An in-memory Source with apply() (the same stale check as the real ones) and every apply recorded. */
function mem(files: Record<string, string>) {
  const data = new Map(Object.entries(files))
  const applied: { path: string; next: string | null; message: string }[] = []
  const src: any = {
    kind: 'local',
    async read(p: string) {
      return data.get(p) ?? null
    },
    async apply(p: string, base: string | null, next: string | null, message: string) {
      if ((data.get(p) ?? null) !== base) throw new StaleWriteError(`Not saved: ${p} changed`)
      applied.push({ path: p, next, message })
      if (next === null) data.delete(p)
      else data.set(p, next)
    },
  }
  return { src, data, applied }
}

const change = async (o: Record<string, any>) => {
  const before = o.before ?? null
  const text = o.text
  return validChange({
    id: 'c1', kind: 'file', op: before === null ? 'create' : 'replace', summary: 'Edit it', by: 'alice', diff: [], added: 1, removed: 0,
    base: before === null ? null : await sha(before), after: await sha(text), text, ...(o.op === 'replace' && before !== null ? { before } : {}), ...o,
  })
}

test('splitChanges: the block after Sources comes back as changes; the text keeps no trace of it', async (t) => {
  if (!R) return t.skip('shared server code not available (public app repo)')
  const { proposal } = await R.propose('propose_todo', { title: 'Call the accountant' }, { me: 'alice', now: NOW, readRaw: async () => null })
  const md = 'Proposed a to-do.\n\n**Next:** apply it.\n\n---\n**Sources**\n- 📄 [status.md](../../status.md)' + R.changesBlock([{ id: 'c1', ...proposal }])
  const { md: text, changes } = splitChanges(md)
  assert.equal(changes.length, 1)
  assert.equal(changes[0].path, proposal.path)
  assert.equal(changes[0].text, proposal.text)
  assert.ok(!text.includes('hq-changes') && text.endsWith('(../../status.md)'))
  const parts = answerParts(md)
  assert.deepEqual(parts.sources.map((s: any) => s.path), ['status.md'], 'Sources still parse; the block is not a source')
  assert.ok(!stripChanges(md).includes('Proposed changes'))
  assert.equal(historyOf([{ question: 'q', answer: md }])[0].a, 'Proposed a to-do.\n\n**Next:** apply it.')
  const bare = 'Done.' + R.changesBlock([{ id: 'c1', ...proposal }])
  assert.equal(historyOf([{ question: 'q', answer: bare }])[0].a, 'Done.', 'no Sources: the block is still cut from history')
})

test('validChange / changesOf: untrusted JSON is checked; bad shapes and paths are dropped, one per path', async () => {
  const good = await change({ path: 'status.md', before: 'a\n', text: 'b\n', op: 'replace' })
  assert.ok(good)
  const base = { ...good }
  for (const bad of [
    { ...base, path: '../etc/passwd' }, { ...base, path: 'C:/x.md' }, { ...base, path: '/abs.md' }, { ...base, kind: 'shell' },
    { ...base, op: 'delete' }, { ...base, after: 'nope' }, { ...base, base: null }, { ...base, op: 'create' }, { ...base, text: 5 },
    { ...base, op: 'edit', edits: [] }, null, 'x', [],
  ]) assert.equal(validChange(bad), null, JSON.stringify(bad)?.slice(0, 80))
  assert.equal(changesOf([good, { ...good, id: 'c2' }]).length, 1, 'one change per path')
  assert.equal(changesOf('nope').length, 0)
  assert.deepEqual(splitChanges('x\n\n---\n**Proposed changes**\n```hq-changes\nnot json\n```\n').changes, [])
})

test('apply → applied → undo: one apply per click, the commit names me; the file comes back byte for byte', async () => {
  const before = '---\ntitle: Status\n---\n\nold line\n'
  const text = before.replace('old', 'new')
  const c = await change({ path: 'status.md', before, text, op: 'replace', summary: 'Edit status.md' })
  const { src, data, applied } = mem({ 'status.md': before })
  assert.equal(await stateOf(c, before), 'ready')
  assert.equal(await refusalOf(src, ME, c, before), '')
  const known = await applyChange(src, ME, c)
  assert.deepEqual(known, { cur: before, next: text })
  assert.equal(data.get('status.md'), text)
  assert.equal(applied[0].message, 'ai-apply: Edit status.md (by alice)')
  assert.equal(await stateOf(c, text), 'applied')
  await assert.rejects(applyChange(src, ME, c), /Applied/, 'a second click does nothing')
  await undoChange(src, ME, c) // after a reload: from the change's saved `before`
  assert.equal(data.get('status.md'), before)
  assert.equal(applied[1].message, 'ai-apply: undo Edit status.md (by alice)')
  assert.equal(applied.length, 2)
})

test('a new file: Apply creates it, Undo removes it; a file that appeared meanwhile is never overwritten', async () => {
  const text = '---\nid: t9\ntitle: Call\nstatus: todo\nowner: alice\nby: alice\n---\n'
  const c = await change({ path: 'todos/t9.md', text, kind: 'todo' })
  const { src, data } = mem({})
  const known = await applyChange(src, ME, c)
  assert.equal(data.get('todos/t9.md'), text)
  await undoChange(src, ME, c, known)
  assert.equal(data.has('todos/t9.md'), false)
  data.set('todos/t9.md', 'someone else\n')
  assert.equal(await stateOf(c, 'someone else\n'), 'exists')
  await assert.rejects(applyChange(src, ME, c), /exists now with other text/)
  assert.equal(data.get('todos/t9.md'), 'someone else\n')
})

test('stale or refused: a changed file, a wrong text, or a house rule stops Apply before anything is saved', async () => {
  const before = 'a\n'
  const c = await change({ path: 'status.md', before, text: 'b\n', op: 'replace' })
  const { src, applied } = mem({ 'status.md': 'edited meanwhile\n' })
  assert.equal(await stateOf(c, 'edited meanwhile\n'), 'changed')
  await assert.rejects(applyChange(src, ME, c), /changed since the AI read it/)
  // a text that doesn't hash to `after` (an edited answer file) is refused
  const forged = { ...(await change({ path: 'status.md', before, text: 'b\n', op: 'replace' })), text: 'evil\n' }
  await assert.rejects(applyChange(mem({ 'status.md': before }).src, ME, forged), /doesn't fit the file/)
  // house rules as the person clicking: bob's profile, a dot-folder, someone else's project
  const bobs = await change({ path: 'people/bob.md', before: 'x\n', text: 'y\n', op: 'replace' })
  await assert.rejects(applyChange(mem({ 'people/bob.md': 'x\n' }).src, ME, bobs), /only change your own files/)
  const proj = '---\ntitle: P\nowner: bob\n---\n'
  const note = await change({ path: 'projects/p/notes.md', text: '# n\n' })
  await assert.rejects(applyChange(mem({ 'projects/p/project.md': proj }).src, ME, note), /Only bob can add to projects\/p/)
  assert.equal(applied.length, 0)
})

test('big files: exact edits re-run on Apply; Undo reverses them when that gives the old text back', async () => {
  const big = 'x\n'.repeat(30) + 'tail\n'
  const next = big.replace('tail', 'TAIL')
  const c = validChange({ id: 'c1', kind: 'file', op: 'edit', path: 'scripts/big.mjs', summary: 'Edit', by: 'alice', diff: [], added: 1, removed: 1, base: await sha(big), after: await sha(next), edits: [{ find: 'tail', replace: 'TAIL' }] })
  const { src, data } = mem({ 'scripts/big.mjs': big })
  await applyChange(src, ME, c)
  assert.equal(data.get('scripts/big.mjs'), next)
  assert.equal(await priorText(c, next), big)
  await undoChange(src, ME, c)
  assert.equal(data.get('scripts/big.mjs'), big)
  const gone = { ...c, edits: [{ find: 'tail', replace: '' }], after: await sha(big.replace('tail', '')) }
  assert.equal(await priorText(gone, big.replace('tail', '')), undefined, 'a deletion can only be undone from the toast')
})

test('commitMessage: summary clipped to one line, the login at the end', () => {
  assert.equal(commitMessage({ summary: 'New  to-do:\nCall' }, { login: 'bob' }), 'ai-apply: New to-do: Call (by bob)')
  assert.match(commitMessage({ summary: 'x'.repeat(200) }, { login: 'bob' }), /^ai-apply: x{69}… \(by bob\)$/)
})

test('dev server via: "ai": the shared policy, expect required, create / replace / delete, 409 when stale', async (t) => {
  const root = tmpDir('aiw')
  t.after(() => rm(root))
  const put = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), text)
  }
  put('status.md', 'old\r\n')
  put('scripts/tool.mjs', 'export const x = 1\n')
  put('board/p1.md', '---\nid: p1\nauthor: bob\nstatus: open\n---\n\nHi\n')
  put('.env.local', 'HQ_LOCAL_LOGIN=alice\n')
  const W = (b: any, login = 'alice') => localAiWrite(root, { via: 'ai', ...b }, login)
  assert.equal(W({ path: 'status.md', text: 'new\r\n', expect: serverSha1('old\r\n') }).status, 200, 'a root note (not a WRITABLE folder for the app)')
  assert.equal(fs.readFileSync(path.join(root, 'status.md'), 'utf8'), 'new\r\n')
  assert.equal(W({ path: 'scripts/tool.mjs', text: 'export const x = 2\n', expect: serverSha1('export const x = 1\n') }).status, 200, 'code')
  assert.equal(W({ path: 'status.md', text: 'x', expect: serverSha1('old\r\n') }).status, 409, 'stale')
  assert.equal(W({ path: 'status.md', text: 'x' }).status, 400, 'expect is required')
  assert.equal(W({ path: '.github/workflows/x.yml', text: 'x', expect: 'absent' }).status, 400, 'dot-folders are not even a path here')
  assert.equal(W({ path: 'ai/answers/x.md', text: 'x', expect: 'absent' }).status, 403)
  assert.equal(W({ path: 'people/bob.md', text: 'x', expect: 'absent' }).status, 403)
  assert.equal(W({ path: '../out.md', text: 'x', expect: 'absent' }).status, 400)
  assert.equal(W({ path: 'board/replies/nope--r1.md', text: '---\nauthor: alice\n---\n', expect: 'absent' }).status, 403, 'no parent post')
  const reply = '---\nid: r1\nparent: p1\nauthor: alice\n---\n\nOn it\n'
  assert.equal(W({ path: 'board/replies/p1--r1.md', text: reply, expect: 'absent' }).status, 200)
  assert.equal(W({ path: 'board/replies/p1--r1.md', delete: true, expect: serverSha1(reply) }, 'bob').status, 403, "not bob's reply")
  assert.equal(W({ path: 'board/replies/p1--r1.md', delete: true, expect: serverSha1(reply) }).status, 200, 'Undo removes my reply')
  assert.equal(fs.existsSync(path.join(root, 'board/replies/p1--r1.md')), false)
  assert.equal(W({ path: 'status.md', text: 'x', expect: serverSha1('new\r\n') }, '').status, 403, 'no HQ_LOCAL_LOGIN → refused')
})

test('LocalSource.apply + /__hq/read through the real dev-server middleware', async (t) => {
  const root = tmpDir('aiw-mw')
  t.after(() => rm(root))
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(root, 'scripts', 'tool.mjs'), 'export const x = 1\n')
  fs.writeFileSync(path.join(root, '.env.local'), 'HQ_LOCAL_LOGIN=alice\n')
  const local = await startLocal(root, 'alice')
  try {
    const src = new LocalSource()
    assert.equal(await src.read('scripts/tool.mjs'), 'export const x = 1\n', 'code files are readable for Apply')
    assert.equal(await src.read('.env.local'), null, 'never the secrets')
    await src.apply('scripts/tool.mjs', 'export const x = 1\n', 'export const x = 2\n', 'm')
    assert.equal(fs.readFileSync(path.join(root, 'scripts', 'tool.mjs'), 'utf8'), 'export const x = 2\n')
    await assert.rejects(src.apply('scripts/tool.mjs', 'export const x = 1\n', 'x', 'm'), (e: any) => e instanceof StaleWriteError)
    await src.apply('investigations/09-x.md', null, '# X\n', 'm')
    assert.equal(fs.readFileSync(path.join(root, 'investigations', '09-x.md'), 'utf8'), '# X\n')
    await src.apply('investigations/09-x.md', '# X\n', null, 'm')
    assert.equal(fs.existsSync(path.join(root, 'investigations', '09-x.md')), false)
    await assert.rejects(src.apply('people/bob.md', null, 'x\n', 'm'), /only change your own files/)
    assert.deepEqual(local.posts.map((p) => p.expect === 'absent' || /^[0-9a-f]{40}$/.test(String(p.expect))), [true, true, true, true, true])
  } finally {
    await local.close()
  }
})

test('GitHub RepoSync.applyFile: fresh read, stale check against the base text, PUT with sha, DELETE for Undo', async () => {
  const calls: { method: string; path: string; body?: any }[] = []
  const files = new Map<string, { sha: string; text: string }>([['status.md', { sha: 's1', text: 'old\n' }]])
  const enc = (s: string) => Buffer.from(s, 'utf8').toString('base64')
  const api = async (p: string, init: any = {}) => {
    const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method, path: p, body })
    const file = decodeURIComponent(p.replace(/^\/repos\/o\/r\/contents\//, '').replace(/\?.*$/, ''))
    if (method === 'GET') {
      const f = files.get(file)
      return f ? Response.json({ type: 'file', encoding: 'base64', content: enc(f.text), sha: f.sha }) : new Response('{}', { status: 404 })
    }
    if (method === 'PUT') {
      if ((files.get(file)?.sha) !== body.sha) return new Response('{}', { status: 409 })
      files.set(file, { sha: 's' + (calls.length + 1), text: Buffer.from(body.content, 'base64').toString('utf8') })
      return Response.json({ content: { sha: files.get(file)!.sha }, commit: { sha: 'c' + calls.length } })
    }
    if (method === 'DELETE') {
      files.delete(file)
      return Response.json({ commit: { sha: 'c' + calls.length } })
    }
    return new Response('{}', { status: 500 })
  }
  const sync = new RepoSync(api as any, 'o', 'r', 'main')
  await sync.applyFile('status.md', 'old\n', 'new · ü\n', 'ai-apply: x (by alice)')
  assert.equal(files.get('status.md')!.text, 'new · ü\n')
  assert.equal(calls[1].body.sha, 's1')
  assert.equal(calls[1].body.message, 'ai-apply: x (by alice)')
  assert.equal(sync.cached('status.md'), 'new · ü\n', 'the cache follows')
  assert.ok(sync.own.has('c2'), 'its commit is "mine" (no "files changed" toast)')
  await assert.rejects(sync.applyFile('status.md', 'old\n', 'x\n', 'm'), (e: any) => e instanceof StaleWriteError)
  await sync.applyFile('scripts/new.mjs', null, 'export {}\n', 'm')
  assert.equal(calls.at(-1)!.body.sha, undefined, 'a new file: no sha')
  await assert.rejects(sync.applyFile('scripts/new.mjs', null, 'again\n', 'm'), (e: any) => e instanceof StaleWriteError, 'create-only')
  await sync.applyFile('scripts/new.mjs', 'export {}\n', null, 'undo')
  assert.equal(files.has('scripts/new.mjs'), false)
  assert.equal(calls.at(-1)!.method, 'DELETE')
})
