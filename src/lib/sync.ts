// Incremental GitHub sync. A check is one conditional tree call (a 304 costs no rate limit);
// on a change, only blobs whose SHA is new are fetched, in batched GraphQL queries.
// In memory only: the Pages origin (youssfhazem1221.github.io) is shared with other sites,
// so private notes are not persisted in the browser.

export type Api = (path: string, init?: RequestInit) => Promise<Response>
export type FileEntry = { path: string; text: string }
export type SyncResult = { files: FileEntry[]; changed: string[]; headSha?: string }

type Cached = { sha: string; text: string }
type TreeEntry = { path: string; type: string; sha: string; size?: number }

const BATCH_FILES = 150
const BATCH_BYTES = 1_500_000
// GraphQL silently truncates Blob.text at 512,000 bytes; bigger files go through REST.
const GRAPHQL_MAX = 500_000

/** Skip dot-folders (.claude, .github, .hq), the app itself, and node_modules. */
export const excluded = (p: string) =>
  p.split('/').some((s) => s.startsWith('.') || s === 'node_modules') || p === 'app' || p.startsWith('app/')
const isMd = (p: string) => p.toLowerCase().endsWith('.md')

export const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/')
const b64 = (s: string) => {
  let bin = ''
  new TextEncoder().encode(s).forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

/** A readable error for a failed GitHub response. */
export async function ghError(r: Response) {
  const msg = (await r.text().catch(() => '')).slice(0, 200)
  if (r.status === 401) return new Error('GitHub token rejected (expired or wrong). Update it in Settings.')
  if (r.status === 404) return new Error('Repo not found, or the token has no access to it. Check Settings.')
  return new Error(`GitHub ${r.status}: ${msg}`)
}

export class RepoSync {
  treeEtag?: string
  /** Commit the cached tree belongs to (the tree endpoint returns it as .sha when asked by branch). */
  headSha?: string
  /** Commits this tab made, so their echo does not raise a "files changed" toast. */
  own = new Set<string>()
  private files = new Map<string, Cached>()
  private running: Promise<SyncResult> | null = null
  /** Changes found by write()'s own re-sync, handed to the next takeChanged() so the page still sees them. */
  private missed = new Set<string>()

  constructor(private api: Api, private owner: string, private repo: string, private branch: string) {}

  private get base() {
    return `/repos/${this.owner}/${this.repo}`
  }

  list(): FileEntry[] {
    return [...this.files].map(([path, f]) => ({ path, text: f.text }))
  }

  /** `changed` plus anything write() synced on its own since the last call. */
  takeChanged(changed: string[]) {
    const all = [...new Set([...this.missed, ...changed])]
    this.missed.clear()
    return all
  }

  /** One sync at a time; callers that arrive meanwhile share it. */
  sync(): Promise<SyncResult> {
    this.running ??= this.run().finally(() => (this.running = null))
    return this.running
  }

  private async run(): Promise<SyncResult> {
    const r = await this.api(`${this.base}/git/trees/${encodeURIComponent(this.branch)}?recursive=1`, {
      headers: this.treeEtag ? { 'If-None-Match': this.treeEtag } : {},
    })
    if (r.status === 304) return { files: this.list(), changed: [], headSha: this.headSha }
    if (!r.ok) throw await ghError(r)
    const tree = await r.json()
    const entries: TreeEntry[] = (tree.tree || []).filter((t: TreeEntry) => t.type === 'blob' && isMd(t.path) && !excluded(t.path))

    // Reuse text by SHA: unchanged files, renames and copies cost nothing.
    const known = new Map([...this.files.values()].map((f) => [f.sha, f.text]))
    const missing = new Map<string, number>()
    for (const e of entries) if (!known.has(e.sha)) missing.set(e.sha, e.size || 0)
    const fetched = await this.fetchBlobs(missing)

    const next = new Map<string, Cached>()
    // A truncated tree is partial: keep files it does not list instead of dropping them.
    if (tree.truncated) for (const [p, f] of this.files) next.set(p, f)
    for (const e of entries) {
      const text = known.get(e.sha) ?? fetched.get(e.sha)
      if (text !== undefined) next.set(e.path, { sha: e.sha, text })
    }
    const changed = [...next.keys()].filter((p) => this.files.get(p)?.sha !== next.get(p)!.sha)
    for (const p of this.files.keys()) if (!next.has(p)) changed.push(p)

    this.files = new Map([...next].sort(([a], [b]) => a.localeCompare(b)))
    this.treeEtag = r.headers.get('etag') || undefined
    this.headSha = typeof tree.sha === 'string' ? tree.sha : undefined
    return { files: this.list(), changed, headSha: this.headSha }
  }

  /** Blob text by SHA: GraphQL batches (1 point each), REST raw for big or truncated blobs. */
  private async fetchBlobs(want: Map<string, number>) {
    const out = new Map<string, string>()
    const big: string[] = []
    const batches: string[][] = [[]]
    let bytes = 0
    for (const [sha, size] of want) {
      if (size > GRAPHQL_MAX) {
        big.push(sha)
        continue
      }
      let cur = batches[batches.length - 1]
      if (cur.length >= BATCH_FILES || (cur.length && bytes + size > BATCH_BYTES)) {
        batches.push((cur = []))
        bytes = 0
      }
      cur.push(sha)
      bytes += size
    }
    for (const shas of batches.filter((b) => b.length)) {
      const fields = shas.map((s, i) => `b${i}: object(oid: ${JSON.stringify(s)}) { ... on Blob { oid isTruncated text } }`).join('\n')
      const query = `query { repository(owner: ${JSON.stringify(this.owner)}, name: ${JSON.stringify(this.repo)}) { ${fields} } }`
      const r = await this.api('/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) })
      if (!r.ok) throw await ghError(r)
      const res = await r.json()
      const repo = res.data?.repository
      if (!repo && res.errors?.length) throw new Error(res.errors[0].message)
      shas.forEach((s, i) => {
        const b = repo?.[`b${i}`]
        if (b && !b.isTruncated && typeof b.text === 'string') out.set(s, b.text)
        else big.push(s)
      })
    }
    for (const sha of big) {
      const r = await this.api(`${this.base}/git/blobs/${sha}`, { headers: { Accept: 'application/vnd.github.raw+json' } })
      if (!r.ok) throw await ghError(r)
      out.set(sha, await r.text())
    }
    return out
  }

  /**
   * Save one file. Uses the cached blob SHA (no extra GET). On a stale SHA it syncs: if the file changed (or was
   * created) on GitHub meanwhile, it throws instead of overwriting that newer version; otherwise it retries once.
   */
  async write(path: string, text: string, message: string) {
    const put = (sha?: string) =>
      this.api(`${this.base}/contents/${encPath(path)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content: b64(text), branch: this.branch, ...(sha ? { sha } : {}) }),
      })
    const before = this.files.get(path)?.sha
    let r = await put(before)
    if (r.status === 409 || r.status === 422) {
      for (const p of (await this.sync()).changed) this.missed.add(p)
      const now = this.files.get(path)
      if (now?.text === text) return // already saved (e.g. an earlier try whose response was lost)
      if (now?.sha !== before) throw new Error(`Not saved: ${path} was changed on GitHub just now (by someone else or another tab). The page will show the new version; make your change again.`)
      r = await put(now?.sha)
    }
    if (!r.ok) throw await ghError(r)
    const j = await r.json()
    if (j.content?.sha && isMd(path) && !excluded(path)) this.files.set(path, { sha: j.content.sha, text })
    if (j.commit?.sha) this.own.add(j.commit.sha)
  }
}
