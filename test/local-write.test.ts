// M2 acceptance (4), (5), (8), (10): the local dev server's write rules (localWrite), the real hqLocal middleware
// driven by the app's LocalSource, and /__hq/activity bodies. Everything runs in temp folders; the synthetic
// fixture (alice, bob, carol) is materialized there, never inside the repo.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { APP, app, fixture, rm, startLocal, tmpDir, viteConfig } from './helpers.ts'

const { localWrite, textSha1 } = await viteConfig()
const { LocalSource, sha1hex } = await app('lib/source')
const { buildModel, setTodoStatus, setPostStatus } = await app('lib/hq')
const F = await fixture()
// The default local login = the owner in src/config.ts DEFAULT_REPO (read, never written out here: public repo).
const OWNER = (fs.readFileSync(path.join(APP, 'src', 'config.ts'), 'utf8').match(/DEFAULT_REPO\s*=\s*'([^/']+)\//) || [])[1] || 'owner'

const put = (root: string, rel: string, text: string) => {
  const abs = path.join(root, ...rel.split('/'))
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, text)
}
const read = (root: string, rel: string) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8')
const project = (owner: string, extra = '') => `---\ntitle: Demo app\ntype: project\nowner: ${owner}\nstatus: active\n${extra}---\n\n# Demo app\n`

test('(4) localWrite expect: wrong sha1 → 409; "absent" on an existing file → 409; no expect → overwrite (old behaviour)', (t) => {
  const root = tmpDir('write')
  t.after(() => rm(root))
  const P = 'todos/t1.md'
  put(root, P, 'one\n')
  assert.equal(localWrite(root, { path: P, text: 'two\n', expect: 'f'.repeat(40) }, 'alice').status, 409)
  assert.equal(localWrite(root, { path: P, text: 'two\n', expect: 'absent' }, 'alice').status, 409)
  assert.equal(read(root, P), 'one\n', 'a refused write changes nothing')
  assert.equal(localWrite(root, { path: P, text: 'two\n', expect: textSha1('one\n') }, 'alice').status, 200)
  assert.equal(read(root, P), 'two\n')
  assert.equal(localWrite(root, { path: P, text: 'three\n' }, 'alice').status, 200, 'no expect: overwrite, as before')
  assert.equal(read(root, P), 'three\n')
  assert.equal(localWrite(root, { path: 'todos/new.md', text: 'x\n', expect: 'absent' }, 'alice').status, 200, 'create-only on a new file')
  assert.equal(localWrite(root, { path: 'todos/gone.md', text: 'x\n', expect: textSha1('x\n') }, 'alice').status, 409, 'expected a file that is not there')
  assert.equal(localWrite(root, { path: P, text: 'x', expect: 'nope' }, 'alice').status, 400)
  assert.equal(localWrite(root, { path: P }, 'alice').status, 400, 'text must be a string')
  assert.equal(localWrite(root, { path: 'status.md', text: 'x' }, 'alice').status, 400, 'still only the writable folders')
  assert.equal(localWrite(root, { path: '../escape.md', text: 'x' }, 'alice').status, 400)
})

test('the browser sha1 (source.ts) equals the server sha1 (vite.config.ts), BOM ignored', async () => {
  const BOM = String.fromCharCode(0xfeff)
  for (const s of ['', 'abc\n', 'crlf\r\nline\r\n', BOM + 'with bom\n', 'emoji 🏆 · ü\n', 'FEFF is just text\n']) assert.equal(await sha1hex(s), textSha1(s))
  assert.equal(textSha1(BOM + 'x'), textSha1('x'))
  assert.equal(await sha1hex(BOM + 'x'), await sha1hex('x'))
  assert.notEqual(textSha1('FEFFx'), textSha1('x'), 'only a real BOM is ignored')
})

test('(5) localWrite projects/: create with "absent" ok; owner may update; another login → 403; changing owner → 403', (t) => {
  const root = tmpDir('projects')
  t.after(() => rm(root))
  const P = 'projects/demo/project.md'
  // create-only, and I must be the owner I write
  assert.equal(localWrite(root, { path: P, text: project('alice') }, 'alice').status, 403, 'create without expect')
  assert.equal(localWrite(root, { path: P, text: project('bob'), expect: 'absent' }, 'alice').status, 403, "can't create a project in bob's name")
  assert.equal(localWrite(root, { path: P, text: project('alice'), expect: 'absent' }, 'alice').status, 200)
  // the owner (any case) updates; the owner line stays
  const v1 = read(root, P)
  const v2 = project('alice', 'members: [bob]\n')
  assert.equal(localWrite(root, { path: P, text: v2, expect: textSha1(v1) }, 'Alice').status, 200)
  assert.equal(localWrite(root, { path: P, text: project('bob', 'members: [bob]\n'), expect: textSha1(v2) }, 'alice').status, 403, 'changing owner')
  // another login
  const r = localWrite(root, { path: P, text: project('alice', 'members: [bob, carol]\n'), expect: textSha1(v2) }, 'bob')
  assert.equal(r.status, 403)
  assert.match(String(r.data.error), /Only alice can change this project/)
  assert.equal(localWrite(root, { path: 'projects/demo/notes.md', text: 'x\n', expect: 'absent' }, 'bob').status, 403, "no new files in someone else's project")
  assert.equal(localWrite(root, { path: 'projects/demo/notes.md', text: 'x\n', expect: 'absent' }, 'alice').status, 200)
  assert.equal(localWrite(root, { path: 'projects/demo/notes.md', text: 'y\n' }, 'bob').status, 403)
  assert.equal(read(root, P), v2, 'refused writes changed nothing')
})

/** Changed lines between two files, via `git diff --no-index` ([] = identical). */
function changedLines(a: string, b: string) {
  const r = spawnSync('git', ['diff', '--no-index', '--no-color', '-U0', '--', a, b], { encoding: 'utf8' })
  if (r.status === 0) return []
  assert.equal(r.status, 1, r.stderr)
  return r.stdout.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l))
}

test('(8) local mode on a fixture copy: ticking a to-do adds done_at/done_by, reopen removes them; no other line changes', { skip: !F && 'fixture not available (public app repo)' }, async (t) => {
  const root = F!.materialize(tmpDir('fixture'))
  const orig = tmpDir('orig')
  const local = await startLocal(root, 'alice')
  t.after(async () => {
    await local.close()
    rm(root)
    rm(orig)
  })
  const src = new LocalSource()
  const me = await src.me()
  assert.deepEqual(me, { login: 'alice', name: 'Alice', configured: true }, '/__hq/me: login from the env, name from the profile')
  const model = buildModel(await src.loadAll())

  const TODO = 'todos/20261015-090000-bob-r4m.md'
  fs.copyFileSync(path.join(root, TODO), path.join(orig, 'todo.md'))
  const doc = model.byPath.get(TODO)
  const now = '2026-10-18T06:00:00Z'
  assert.equal(await setTodoStatus(src, me, doc, 'done', now), true)
  assert.deepEqual(changedLines(path.join(orig, 'todo.md'), path.join(root, TODO)), [
    '-status: todo',
    '+status: done',
    `+done_at: ${now}`,
    '+done_by: alice',
  ])
  assert.ok(local.posts.at(-1)!.expect && /^[0-9a-f]{40}$/.test(local.posts.at(-1)!.expect!), 'LocalSource sent expect = sha1')
  assert.equal(await setTodoStatus(src, me, doc, 'done', now), false, 'same status again: no write')
  assert.equal(await setTodoStatus(src, me, doc, 'todo', now), true)
  assert.deepEqual(changedLines(path.join(orig, 'todo.md'), path.join(root, TODO)), [], 'reopen → byte-identical to the start')

  // a post: closed_* on done, removed on reopen
  const POST = 'board/20261016-110000-alice-m2x.md'
  fs.copyFileSync(path.join(root, POST), path.join(orig, 'post.md'))
  assert.equal(await setPostStatus(src, me, model.byPath.get(POST), 'done', now), true)
  assert.deepEqual(changedLines(path.join(orig, 'post.md'), path.join(root, POST)), ['-status: open', '+status: done', `+closed_at: ${now}`, '+closed_by: alice'])
  await setPostStatus(src, me, model.byPath.get(POST), 'open', now)
  assert.deepEqual(changedLines(path.join(orig, 'post.md'), path.join(root, POST)), [])
})

test('local mode: a change on disk between read and write → 409 → update re-reads and retries (2 POSTs, both kept)', { skip: !F && 'fixture not available' }, async (t) => {
  const root = F!.materialize(tmpDir('race'))
  const local = await startLocal(root, 'alice')
  t.after(async () => {
    await local.close()
    rm(root)
  })
  const src = new LocalSource()
  const P = 'people/alice/log/2026-10.md'
  let runs = 0
  const n0 = local.posts.length
  const ok = await src.update(P, (cur: string | null) => {
    runs++
    // first run: another tab saves right after we read
    if (runs === 1) fs.appendFileSync(path.join(root, ...P.split('/')), '| other tab |\n')
    return cur + '| mine |\n'
  }, 'log: done from alice')
  assert.equal(ok, true)
  assert.equal(runs, 2)
  assert.equal(local.posts.length - n0, 2)
  assert.match(read(root, P), /\| other tab \|\n\| mine \|\n$/)
  // create-only through the server: an existing file is never overwritten
  assert.equal(await src.update(P, (cur: string | null) => (cur === null ? 'new' : null), 'x'), false)
  // alice owns demo: allowed through update (expect = sha1)
  assert.equal(await src.update('projects/demo/project.md', (cur: string | null) => cur + '\n', 'x'), true)
  // as bob, alice's project is refused by the server: a plain error, no retry loop
  process.env.HQ_LOCAL_LOGIN = 'bob'
  const n1 = local.posts.length
  await assert.rejects(src.update('projects/solo/project.md', (cur: string | null) => cur + '\nmore\n', 'x'), /Save failed: .*Only alice can change this project/)
  assert.equal(local.posts.length - n1, 1, 'one refused write, no retries on 403')
  process.env.HQ_LOCAL_LOGIN = 'alice'
})

test('/__hq/me without a profile → the login as the name', { skip: !F && 'fixture not available' }, async (t) => {
  const root = F!.materialize(tmpDir('me'))
  const local = await startLocal(root, 'carol')
  t.after(async () => {
    await local.close()
    rm(root)
  })
  assert.deepEqual(await new LocalSource().me(), { login: 'carol', name: 'carol', configured: true })
})

test('review F1: without HQ_LOCAL_LOGIN, local mode shows the default login but refuses projects/ writes', async (t) => {
  const root = tmpDir('nologin')
  const P = 'projects/own/project.md'
  put(root, P, project(OWNER))
  const local = await startLocal(root, '') // nothing in the env, no .env.local
  t.after(async () => {
    await local.close()
    rm(root)
  })
  assert.deepEqual(await new LocalSource().me(), { login: OWNER, name: OWNER, configured: false })
  // the owner check never passes on the default login: not for an update, not for a new project
  const v1 = read(root, P)
  const r = localWrite(root, { path: P, text: project(OWNER, 'members: [bob]\n'), expect: textSha1(v1) })
  assert.equal(r.status, 403)
  assert.match(String(r.data.error), /Set HQ_LOCAL_LOGIN=<your GitHub login> in \.env\.local/)
  assert.equal(localWrite(root, { path: 'projects/new/project.md', text: project(OWNER), expect: 'absent' }).status, 403)
  await assert.rejects(new LocalSource().update(P, (cur: string | null) => cur + '\n', 'x'), /Set HQ_LOCAL_LOGIN/)
  assert.equal(read(root, P), v1, 'nothing written')
  // people/ refuses too: a clone without the login never writes into the default owner's profile, log or look
  const mine = OWNER.toLowerCase()
  for (const p of [`people/${mine}.md`, `people/${mine}/log/2026-10.md`, `people/${mine}/ui.md`]) {
    const w = localWrite(root, { path: p, text: 'x\n', expect: 'absent' })
    assert.equal(w.status, 403, p)
    assert.match(String(w.data.error), /Set HQ_LOCAL_LOGIN/)
  }
  assert.equal(fs.existsSync(path.join(root, 'people')), false, 'nothing written under people/')
  // other folders keep working as before
  assert.equal(localWrite(root, { path: 'todos/t.md', text: 'x\n', expect: 'absent' }).status, 200)
  // .env.local in the workspace sets the login: now the owner may change the project
  put(root, '.env.local', `# local\nHQ_LOCAL_LOGIN=${OWNER}\n`)
  assert.deepEqual(await new LocalSource().me(), { login: OWNER, name: OWNER, configured: true })
  assert.equal(await new LocalSource().update(P, (cur: string | null) => cur + '\n', 'x'), true)
})

test('people/: only my own profile and folder (not my digest, not anyone else\'s); no login → refused', (t) => {
  const root = tmpDir('people')
  t.after(() => rm(root))
  put(root, 'people/alice.md', '---\nname: Alice\nrole: dev\n---\n')
  put(root, 'people/alice/ui.md', '---\ntype: ui-prefs\nsize: l\n---\n')
  const before = { profile: read(root, 'people/alice.md'), ui: read(root, 'people/alice/ui.md') }
  // bob can't touch alice's files, with or without expect
  for (const [p, expect] of [
    ['people/alice/ui.md', undefined],
    ['people/alice.md', undefined],
    ['people/alice.md', textSha1(before.profile)],
    ['people/alice/log/2026-10.md', 'absent'],
    ['people/ALICE/intake.md', 'absent'],
    ['people/_team/digest/2026-10.md', 'absent'],
    ['people/claude/log/2026-10.md', 'absent'],
  ] as [string, string | undefined][]) {
    const r = localWrite(root, { path: p, text: 'role: hijacked\n', expect }, 'bob')
    assert.equal(r.status, 403, `bob → ${p}`)
  }
  assert.deepEqual({ profile: read(root, 'people/alice.md'), ui: read(root, 'people/alice/ui.md') }, before, 'alice\'s files unchanged')
  // bob writes his own profile, log, look and intake; never his digest (the weekly Action owns it)
  for (const p of ['people/bob.md', 'people/bob/log/2026-10.md', 'people/bob/ui.md', 'people/bob/intake.md'])
    assert.equal(localWrite(root, { path: p, text: 'x\n', expect: 'absent' }, 'bob').status, 200, `bob → ${p}`)
  assert.equal(localWrite(root, { path: 'people/bob/digest/2026-10.md', text: 'x\n', expect: 'absent' }, 'bob').status, 403)
  // alice (any case of the login) may change her own files
  assert.equal(localWrite(root, { path: 'people/alice/ui.md', text: 'y\n', expect: textSha1(before.ui) }, 'Alice').status, 200)
  // no configured login → refused
  assert.equal(localWrite(root, { path: 'people/carol.md', text: 'x\n', expect: 'absent' }, '').status, 403)
})

test('(10) /__hq/activity returns the body; a trailer commit and a claude: commit get actor "claude"', async (t) => {
  const root = tmpDir('git')
  const local = await startLocal(root, 'alice')
  t.after(async () => {
    await local.close()
    rm(root)
  })
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=alice', '-c', 'user.email=alice@example.invalid', ...args], { cwd: root, stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  put(root, 'notes.md', 'a\n')
  git('add', '.')
  git('commit', '-q', '-m', 'Plain change')
  put(root, 'notes.md', 'b\n')
  git('commit', '-q', '-a', '-m', 'Fix the board', '-m', 'Longer reason.', '-m', 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')
  put(root, 'notes.md', 'c\n')
  git('commit', '-q', '-a', '-m', 'claude: board x (bridge)')

  const raw = await (await fetch('/__hq/activity')).json()
  assert.equal(raw.length, 3)
  assert.deepEqual(raw.map((c: any) => c.message), ['claude: board x (bridge)', 'Fix the board', 'Plain change'])
  assert.equal(raw[1].body, 'Longer reason.\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')
  assert.equal(raw[2].body, '')

  const commits = await new LocalSource().activity()
  assert.deepEqual(commits.map((c: any) => c.actor), ['claude', 'claude', 'alice'])
  assert.deepEqual(commits.map((c: any) => c.author), ['alice', 'alice', 'alice'])
  assert.equal(commits[1].message, 'Fix the board', 'message stays the subject line')
  const one = await new LocalSource().activity('notes.md')
  assert.equal(one.length, 3, 'a file path filters (still works)')
})

// ---------------------------------------------------------------------------
// UI v3 (plan F3): the write policy for files inside project folders, through the real middleware
const postWrite = (base: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + '/__hq/write', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

test('v3 F3: a new file inside projects/<slug>/ needs that project to be mine; a new project.md is open to anyone (as owner)', async (t) => {
  const root = tmpDir('f3')
  put(root, 'projects/demo/project.md', project('alice'))
  t.after(() => rm(root))
  const as = async (login: string, fn: (base: string) => Promise<void>) => {
    const local = await startLocal(root, login)
    try {
      await fn(local.base)
    } finally {
      await local.close()
    }
  }
  const X = 'projects/demo/explainer-x.md'
  await as('bob', async (base) => {
    const r = await postWrite(base, { path: X, text: '# x\n', expect: 'absent' })
    assert.equal(r.status, 403)
    assert.match((await r.json()).error, /Only alice can add to projects\/demo/)
    assert.equal(fs.existsSync(path.join(root, 'projects', 'demo', 'explainer-x.md')), false)
    // a folder without project.md: nobody owns it yet, so nothing goes in (create the project first)
    const g = await postWrite(base, { path: 'projects/ghost/explainer-y.md', text: '# y\n', expect: 'absent' })
    assert.equal(g.status, 403)
    assert.match((await g.json()).error, /projects\/ghost has no project\.md/)
    // anyone may start a project (as its owner) …
    assert.equal((await postWrite(base, { path: 'projects/new/project.md', text: project('bob'), expect: 'absent' })).status, 200)
    // … and then add files to it
    assert.equal((await postWrite(base, { path: 'projects/new/explainer-y.md', text: '# y\n', expect: 'absent' })).status, 200)
    // still not in someone else's name
    assert.equal((await postWrite(base, { path: 'projects/other/project.md', text: project('alice'), expect: 'absent' })).status, 403)
  })
  await as('alice', async (base) => {
    assert.equal((await postWrite(base, { path: X, text: '# x\n', expect: 'absent' })).status, 200, 'the owner adds a file')
    assert.equal((await postWrite(base, { path: X, text: '# x again\n', expect: 'absent' })).status, 409, 'create-only: a second save is refused')
    assert.equal((await postWrite(base, { path: 'projects/new/explainer-z.md', text: '# z\n', expect: 'absent' })).status, 403, "not in bob's project")
    assert.equal((await postWrite(base, { path: 'projects/carols/project.md', text: project('alice'), expect: 'absent' })).status, 200)
  })
  assert.equal(read(root, X), '# x\n')
  assert.equal(read(root, 'projects/new/project.md'), project('bob'))
})

// ---------------------------------------------------------------------------
// UI v3: POST /__hq/ui-tweak → the shared Adjust look handler (stubbed here: the real one belongs to the ui-tweak module)
const STUB_HANDLER = [
  'export async function handleUiTweak(body, ctx) {',
  "  if (body.action === 'boom') throw new Error('failed https://x.invalid/?key=' + ctx.env.GEMINI_API_KEY)",
  "  if (body.action === 'net') { const r = await ctx.fetch('https://gemini.invalid/v1'); return { status: 200, body: await r.json() } }",
  "  if (body.action === 'weird') return { status: 7, body: { x: 1 } }",
  "  if (body.action === 'limit') return { status: 429, body: { error: 'slow down' } }",
  '  return { status: 200, body: { echo: body, login: ctx.login, configured: ctx.configured, local: ctx.local, envKeys: Object.keys(ctx.env).sort(), bytes: ctx.bytes, fetch: typeof ctx.fetch } }',
  '}',
  '',
].join('\n')
const postTweak = (base: string, raw: string, headers: Record<string, string> = {}) =>
  fetch(base + '/__hq/ui-tweak', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw })

test('v3 /__hq/ui-tweak: the shared handler gets the local login, only the AI keys and a fetch; caps, bad input and failures', async (t) => {
  const root = tmpDir('tweak')
  const shared = tmpDir('tweak-shared')
  const empty = tmpDir('tweak-empty')
  fs.writeFileSync(path.join(shared, 'ui-tweak-handler.mjs'), STUB_HANDLER)
  // synthetic test values only
  put(root, '.env.local', 'GEMINI_API_KEY=test-not-a-real-key\nSUPABASE_SECRET_KEY=test-not-a-secret\nALLOWED_LOGINS=alice\nHQ_LOCAL_LOGIN=alice\n')
  const calls: string[] = []
  const stubNet = (async (url: any) => {
    calls.push(String(url))
    return Response.json({ stub: true })
  }) as typeof fetch
  const local = await startLocal(root, 'alice', { shared, fetch: stubNet })
  t.after(async () => {
    await local.close()
    for (const d of [root, shared, empty]) rm(d)
  })
  const body = { clauses: ['bigger text', 'calm colours'], current: { size: 'm' }, context: { page: 'home', pinnable: [] } }
  const raw = JSON.stringify(body)
  const r = await postTweak(local.base, raw)
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.deepEqual(j.echo, body)
  assert.equal(j.login, 'alice')
  assert.equal(j.configured, true)
  assert.equal(j.local, true)
  assert.deepEqual(j.envKeys, ['ALLOWED_LOGINS', 'GEMINI_API_KEY'], 'only the AI keys, never the Supabase secret')
  assert.equal(j.bytes, Buffer.byteLength(raw))
  assert.equal(j.fetch, 'function')
  // the onboarding intake rides the same route
  const draft = await postTweak(local.base, JSON.stringify({ action: 'profile-draft', intake: '# Who I am\n' + 'x'.repeat(20_000) }))
  assert.equal(draft.status, 200)
  assert.equal((await draft.json()).echo.action, 'profile-draft')
  // the handler's network is the injected one (no real call)
  const net = await postTweak(local.base, JSON.stringify({ action: 'net' }))
  assert.deepEqual([net.status, await net.json(), calls], [200, { stub: true }, ['https://gemini.invalid/v1']])
  // the handler's own status passes through
  assert.equal((await postTweak(local.base, JSON.stringify({ action: 'limit' }))).status, 429)
  // failures never echo the error text (it could hold a URL with a key)
  const boom = await postTweak(local.base, JSON.stringify({ action: 'boom' }))
  assert.equal(boom.status, 502)
  assert.doesNotMatch(await boom.text(), /key=|test-not-a-real-key|x\.invalid/)
  assert.equal((await postTweak(local.base, JSON.stringify({ action: 'weird' }))).status, 502, 'a status outside 200-599 → 502')
  // caps and bad input
  assert.equal((await postTweak(local.base, JSON.stringify({ intake: 'x'.repeat(70_000) }))).status, 413)
  assert.equal((await postTweak(local.base, 'not json')).status, 400)
  assert.equal((await postTweak(local.base, '[1, 2]')).status, 400)
  assert.equal((await postTweak(local.base, 'null')).status, 400)
  assert.equal((await fetch(local.base + '/__hq/ui-tweak')).status, 405)
  assert.equal((await postTweak(local.base, raw, { 'content-type': 'text/plain' })).status, 415)
  assert.equal((await postTweak(local.base, raw, { origin: 'http://evil.example' })).status, 403)
  // the handler file is not there (the ui-tweak module not built yet) → 501, a plain message
  const { localUiTweak } = await viteConfig()
  const m = await localUiTweak({ text: raw, bytes: Buffer.byteLength(raw), tooBig: false }, { envFile: path.join(root, '.env.local'), shared: empty })
  assert.equal(m.status, 501)
  assert.match(m.body.error, /not built yet/)
})

// ---------------------------------------------------------------------------
// UI v3 (plan F2): the local Ask AI walker leaves people/<slug>/ui.md out of the context (files mode, stubbed Gemini)
test('v3 F2: /__hq/ask (askLocal) never puts people/<slug>/ui.md into the prompt', { skip: !F && 'fixture not available' }, async (t) => {
  const root = F!.materialize(tmpDir('askui'))
  const MARK = 'UIPREFS-MARKER-askLocal'
  put(root, 'people/alice/ui.md', `---\ntype: ui-prefs\nperson: alice\nsize: xl\n---\n${MARK}\n`)
  put(root, '.env.local', 'GEMINI_API_KEY=test-not-a-real-key\nHQ_LOCAL_LOGIN=alice\n') // no Supabase keys → files mode
  const sent: any[] = []
  const real = globalThis.fetch
  const sse = (events: unknown[]) => new Response(new ReadableStream({
    start(c) {
      for (const e of events) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`))
      c.close()
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
  globalThis.fetch = (async (url: any, init: any = {}) => {
    const u = String(url)
    if (u.endsWith('/v1beta/interactions')) {
      sent.push(JSON.parse(init.body))
      return sse([{ event_type: 'interaction.created', interaction: { id: 'i1' } },
        { event_type: 'step.delta', index: 0, delta: { type: 'text', text: 'Fine.\n\n**Next:** nothing.' } },
        { event_type: 'interaction.completed', interaction: { id: 'i1', status: 'completed' } }])
    }
    if (u.startsWith('https://')) throw new Error('unexpected network call ' + u)
    return real(url, init)
  }) as typeof fetch
  const local = await startLocal(root, 'alice')
  t.after(async () => {
    await local.close()
    globalThis.fetch = real
    rm(root)
  })
  const r = await fetch(local.base + '/__hq/ask', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ request: { id: '20261018-050700-alice-u1i', question: 'what font does alice use?', kind: 'ask', model: 'fast', connectors: [] }, history: [] }),
  })
  const stream = await r.text()
  assert.match(stream, /event: done/, stream.slice(0, 400))
  assert.equal(sent.length, 1)
  const prompt = JSON.stringify(sent[0])
  assert.ok(prompt.includes('people/alice.md'), 'the walker still hands over the notes')
  assert.ok(!prompt.includes('people/alice/ui.md') && !prompt.includes(MARK), 'no ui.md path or text')
})
