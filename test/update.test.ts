// M2 acceptance (1)–(3): Source.update's optimistic loop (updateLoop), plus the same loop end to end through
// GitHubSource → RepoSync against a fake GitHub API (two tabs appending to one file at once).
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from './helpers.ts'

const { StaleWriteError, updateLoop } = await app('lib/sync')
const { GitHubSource, commitOf, toCommit } = await app('lib/source')

/** A tiny "remote": get() returns its text; put() fails with StaleWriteError while `stale` > 0 (someone else
 *  wrote meanwhile: the text changes, as RepoSync's re-sync would show it). */
function stub(text: string | null, stale = 0) {
  const s = { text, stale, puts: 0, gets: 0, runs: 0 }
  const get = async () => {
    s.gets++
    return s.text
  }
  const put = async (next: string) => {
    s.puts++
    if (s.stale > 0) {
      s.stale--
      s.text = (s.text ?? '') + 'theirs\n'
      throw new StaleWriteError('Not saved: changed on GitHub just now')
    }
    s.text = next
  }
  return { s, get, put }
}

test('(1) first PUT → StaleWriteError, cache changed, fn re-runs on the new text, 2nd PUT ok → exactly 2 PUTs', async () => {
  const { s, get, put } = stub('base\n', 1)
  const seen: (string | null)[] = []
  const ok = await updateLoop(get, put, (cur: string | null) => {
    seen.push(cur)
    return (cur ?? '') + 'mine\n'
  })
  assert.equal(ok, true)
  assert.equal(s.puts, 2)
  assert.deepEqual(seen, ['base\n', 'base\ntheirs\n'])
  assert.equal(s.text, 'base\ntheirs\nmine\n', 'both changes kept: nothing overwritten')
})

test('(2) fn returns the same text or null → 0 PUTs, false', async () => {
  const a = stub('same\n')
  assert.equal(await updateLoop(a.get, a.put, (cur: string | null) => cur), false)
  assert.equal(a.s.puts, 0)
  const b = stub(null)
  assert.equal(await updateLoop(b.get, b.put, () => null), false)
  assert.equal(await updateLoop(b.get, b.put, () => undefined), false)
  assert.equal(b.s.puts, 0)
})

test('(3) 3 stale failures → a readable error that names the file; the 4th write never happens', async () => {
  const { s, get, put } = stub('x\n', 99)
  await assert.rejects(
    updateLoop(get, put, (cur: string | null) => cur + 'y\n', 3, 'people/alice/log/2026-10.md'),
    (e: Error) => {
      assert.equal(e.message, 'Not saved after 3 tries: people/alice/log/2026-10.md keeps changing. Your text is still in the box.')
      return true
    },
  )
  assert.equal(s.puts, 3)
})

test('other errors stop at once (no retry); an error thrown by fn means no PUT', async () => {
  const a = stub('x\n')
  let calls = 0
  const boom = async () => {
    calls++
    throw new Error('GitHub 500')
  }
  await assert.rejects(updateLoop(a.get, boom, (cur: string | null) => cur + 'y'), /GitHub 500/)
  assert.equal(calls, 1)
  const b = stub('x\n')
  await assert.rejects(updateLoop(b.get, b.put, () => {
    throw new Error('Only alice can change this project')
  }), /Only alice/)
  assert.equal(b.s.puts, 0)
})

// ---- GitHubSource end to end on a fake GitHub API ----

/** Enough of the GitHub API for RepoSync: recursive tree (+ ETag/304), GraphQL blobs, raw blobs, contents PUT
 *  (409 on a stale sha, 422 when a sha is missing for an existing file, like GitHub). */
function fakeGitHub(initial: Record<string, string>) {
  let n = 0
  const sha = () => (++n).toString(16).padStart(40, '0')
  const files = new Map<string, { sha: string; text: string }>()
  for (const [p, t] of Object.entries(initial)) files.set(p, { sha: sha(), text: t })
  let head = sha()
  const stats = { puts: 0, rejected: 0 }
  const blob = (s: string) => [...files.values()].find((f) => f.sha === s)?.text
  const handle = async (url: string, init: any = {}) => {
    const p = url.replace('https://api.github.com', '')
    const method = init.method || 'GET'
    if (p.includes('/git/trees/')) {
      const etag = `"${head}"`
      if (init.headers?.['If-None-Match'] === etag) return new Response(null, { status: 304 })
      const tree = [...files].map(([path, f]) => ({ path, type: 'blob', sha: f.sha, size: f.text.length }))
      return Response.json({ sha: head, truncated: false, tree }, { headers: { etag } })
    }
    if (p === '/graphql') {
      const q = JSON.parse(String(init.body)).query
      const repository: Record<string, unknown> = {}
      for (const m of q.matchAll(/(b\d+): object\(oid: "([0-9a-f]+)"\)/g)) repository[m[1]] = { oid: m[2], isTruncated: false, text: blob(m[2]) }
      return Response.json({ data: { repository } })
    }
    const c = p.match(/\/contents\/(.+)$/)
    if (c && method === 'PUT') {
      stats.puts++
      const b = JSON.parse(String(init.body))
      const path = c[1].split('/').map(decodeURIComponent).join('/')
      const cur = files.get(path)
      if (cur && !b.sha) return (stats.rejected++, new Response('{"message":"sha wasn\'t supplied"}', { status: 422 }))
      if ((cur && b.sha !== cur.sha) || (!cur && b.sha)) return (stats.rejected++, new Response('{"message":"conflict"}', { status: 409 }))
      const s = sha()
      files.set(path, { sha: s, text: Buffer.from(b.content, 'base64').toString('utf8') })
      head = sha()
      return Response.json({ content: { sha: s }, commit: { sha: head } })
    }
    return new Response('not found', { status: 404 })
  }
  return { handle, files, stats }
}

async function withFakeFetch<T>(gh: ReturnType<typeof fakeGitHub>, run: () => Promise<T>) {
  const real = globalThis.fetch
  globalThis.fetch = ((url: any, init: any) => gh.handle(String(url), init)) as typeof fetch
  try {
    return await run()
  } finally {
    globalThis.fetch = real
  }
}

const cfg = { owner: 'o', repo: 'r', branch: 'main', token: 't' }
const LOG = 'people/alice/log/2026-10.md'

test('GitHubSource.update: two tabs append to one file at once → both rows land, ≤2 PUTs each, nothing lost', async () => {
  const gh = fakeGitHub({ [LOG]: 'head\n', 'notes.md': '# n\n' })
  await withFakeFetch(gh, async () => {
    const a = new GitHubSource(cfg)
    const b = new GitHubSource(cfg)
    await a.loadAll()
    await b.loadAll()
    const before = gh.stats.puts
    assert.equal(await a.update(LOG, (cur: string | null) => cur + '| row A |\n', 'log: done from alice'), true)
    assert.equal(gh.stats.puts - before, 1, 'tab A: 1 PUT')
    const mid = gh.stats.puts
    // tab B still has the old text cached: its first PUT is rejected, it re-syncs and re-runs fn on A's text
    const seen: (string | null)[] = []
    assert.equal(await b.update(LOG, (cur: string | null) => (seen.push(cur), cur + '| row B |\n'), 'log: done from alice'), true)
    assert.equal(gh.stats.puts - mid, 2, 'tab B: exactly 2 PUTs')
    assert.deepEqual(seen, ['head\n', 'head\n| row A |\n'])
    assert.equal(gh.files.get(LOG)!.text, 'head\n| row A |\n| row B |\n')
    // the same change again is a no-op (no PUT, no empty commit)
    const n = gh.stats.puts
    assert.equal(await b.update(LOG, (cur: string | null) => (cur!.includes('| row B |') ? cur : cur + '| row B |\n'), 'x'), false)
    assert.equal(gh.stats.puts, n)
  })
})

test('GitHubSource.update create-only: a file created elsewhere meanwhile is never overwritten', async () => {
  const gh = fakeGitHub({ 'notes.md': '# n\n' })
  await withFakeFetch(gh, async () => {
    const a = new GitHubSource(cfg)
    const b = new GitHubSource(cfg)
    await a.loadAll()
    await b.loadAll()
    const P = 'projects/demo/project.md'
    const create = (text: string) => (cur: string | null) => (cur === null ? text : null)
    assert.equal(await a.update(P, create('A\n'), 'project: new demo by alice'), true)
    assert.equal(await b.update(P, create('B\n'), 'project: new demo by bob'), false, 'B sees it exists (after one rejected PUT)')
    assert.equal(gh.files.get(P)!.text, 'A\n')
  })
})

test('Commit keeps the body and labels the actor (claude trailer / claude: prefix / bots)', () => {
  const rest = (message: string, login = 'alice', name = 'Alice') =>
    toCommit({ sha: 's', author: { login, avatar_url: 'a' }, commit: { message, author: { name, date: '2026-10-15T10:00:00Z' } } })
  const t = rest('Fix the board\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')
  assert.equal(t.message, 'Fix the board')
  assert.match(t.body, /^Co-Authored-By: Claude/)
  assert.equal(t.actor, 'claude')
  assert.equal(t.author, 'alice', 'author stays the login (pages show it)')
  assert.equal(rest('claude: board x (bridge)').actor, 'claude')
  assert.equal(rest('people: digests week of 2026-10-11', 'github-actions[bot]', 'hq-digest').actor, 'hq-digest')
  assert.equal(rest('ai: answer', 'github-actions[bot]', 'hq-ai').actor, 'hq-ai')
  const plain = rest('Docs tweak')
  assert.deepEqual([plain.actor, plain.body], ['alice', ''])
  assert.equal(commitOf({ sha: 's', full: 'a\r\nb\r\nc', author: 'bob', date: '' }).body, 'b\nc')
})
