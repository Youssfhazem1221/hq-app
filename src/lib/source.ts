// Where the data comes from: the local folder (dev) or the private GitHub repo (deployed).
import { encPath, excluded, ghError, RepoSync, type FileEntry } from './sync'

export { excluded, type FileEntry }
export type Me = { login: string; name: string; avatar?: string }
export type Commit = { sha: string; message: string; author: string; avatar?: string; date: string }
/** Re-check result: the new file list and the paths that changed. */
export type Refresh = { files: FileEntry[]; changed: string[] }
export type Realtime = { topic: string; project?: string }

export interface Source {
  kind: 'local' | 'github'
  label: string
  loadAll(): Promise<FileEntry[]>
  /** Cheap change check (a free 304 on GitHub). null = nothing changed since the last load. */
  refresh(): Promise<Refresh | null>
  read(path: string): Promise<string | null>
  write(path: string, text: string, message: string): Promise<void>
  me(): Promise<Me>
  /** Recent commits, optionally only those touching one path (a file or a folder). */
  activity(path?: string): Promise<Commit[]>
  /** Newest commit, for the "files changed" toast. null when unknown or made by this tab. */
  latest(): Promise<Commit | null>
  /** Doorbell topic (.hq/realtime.json in the private repo). */
  realtime(): Promise<Realtime | null>
  webUrl(path: string): string | null
  /** Commit the loaded files belong to (GitHub only). */
  headSha?: string
  /** Local only: answer an AI request with the old worker (fallback when streaming fails). */
  runAi?(id: string): Promise<void>
}

const realtimeOf = (j: any): Realtime | null =>
  j && typeof j.topic === 'string' && /^[\w-]{8,80}$/.test(j.topic) ? { topic: j.topic, project: j.project ? String(j.project) : undefined } : null

export class LocalSource implements Source {
  kind = 'local' as const
  label = 'Local folder'
  private last = new Map<string, string>()

  private remember(files: FileEntry[]) {
    const before = this.last
    this.last = new Map(files.map((f) => [f.path, f.text]))
    const changed = files.filter((f) => before.get(f.path) !== f.text).map((f) => f.path)
    for (const p of before.keys()) if (!this.last.has(p)) changed.push(p)
    return changed
  }
  async loadAll() {
    const r = await fetch('/__hq/files', { cache: 'no-store' })
    if (!r.ok) throw new Error('Local dev server not reachable')
    const files: FileEntry[] = await r.json()
    this.remember(files)
    return files
  }
  async refresh() {
    const r = await fetch('/__hq/files', { cache: 'no-store' })
    if (!r.ok) throw new Error('Local dev server not reachable')
    const files: FileEntry[] = await r.json()
    const changed = this.remember(files)
    return changed.length ? { files, changed } : null
  }
  async read(path: string) {
    const r = await fetch('/__hq/read?path=' + encodeURIComponent(path), { cache: 'no-store' })
    return r.status === 404 ? null : r.text()
  }
  async write(path: string, text: string) {
    const r = await fetch('/__hq/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, text }) })
    if (!r.ok) throw new Error(`Save failed: ${await r.text()}`)
  }
  async me() {
    return (await fetch('/__hq/me')).json()
  }
  async activity(path?: string) {
    const r = await fetch('/__hq/activity' + (path ? '?path=' + encodeURIComponent(path) : ''), { cache: 'no-store' })
    return r.ok ? r.json() : []
  }
  async latest() {
    return null
  }
  async realtime() {
    const r = await fetch('/__hq/realtime', { cache: 'no-store' })
    return r.ok ? realtimeOf(await r.json().catch(() => null)) : null
  }
  webUrl() {
    return null
  }
  async runAi(id: string) {
    const r = await fetch('/__hq/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) })
    if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.log || 'AI worker failed')
  }
}

export type GhConfig = { owner: string; repo: string; branch: string; token: string }

const toCommit = (c: any): Commit => ({
  sha: c.sha,
  message: String(c.commit.message).split('\n')[0],
  author: c.author?.login || c.commit.author?.name || '?',
  avatar: c.author?.avatar_url,
  date: c.commit.author?.date,
})

export class GitHubSource implements Source {
  kind = 'github' as const
  private sync: RepoSync
  constructor(private c: GhConfig) {
    this.sync = new RepoSync((p, init) => this.api(p, init), c.owner, c.repo, c.branch)
  }
  get label() {
    return `${this.c.owner}/${this.c.repo}`
  }
  /** For the Supabase function: it acts with the same token, on the same repo. */
  get auth() {
    return { token: this.c.token, repo: `${this.c.owner}/${this.c.repo}`, branch: this.c.branch }
  }
  get headSha() {
    return this.sync.headSha
  }

  private api(path: string, init: RequestInit = {}) {
    return fetch('https://api.github.com' + path, {
      ...init,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.c.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.headers || {}),
      },
    })
  }
  private async json(path: string, init?: RequestInit) {
    const r = await this.api(path, init)
    if (!r.ok) throw await ghError(r)
    return r.json()
  }
  private get repoPath() {
    return `/repos/${this.c.owner}/${this.c.repo}`
  }

  async loadAll() {
    return (await this.sync.sync()).files
  }
  async refresh() {
    const r = await this.sync.sync()
    const changed = this.sync.takeChanged(r.changed)
    return changed.length ? { files: r.files, changed } : null
  }

  async read(path: string) {
    const r = await this.api(`${this.repoPath}/contents/${encPath(path)}?ref=${encodeURIComponent(this.c.branch)}`, {
      headers: { Accept: 'application/vnd.github.raw+json' },
    })
    if (r.status === 404) return null
    if (!r.ok) throw new Error(`GitHub ${r.status}`)
    return r.text()
  }

  write(path: string, text: string, message: string) {
    return this.sync.write(path, text, message)
  }

  async me() {
    const u = await this.json('/user')
    return { login: u.login, name: u.name || u.login, avatar: u.avatar_url }
  }

  async activity(path?: string) {
    const only = path ? `&path=${encodeURIComponent(path)}` : ''
    const cs = await this.json(`${this.repoPath}/commits?sha=${encodeURIComponent(this.c.branch)}&per_page=15${only}`)
    return cs.map(toCommit)
  }

  async latest() {
    const [c] = await this.json(`${this.repoPath}/commits?sha=${encodeURIComponent(this.c.branch)}&per_page=1`)
    return c && !this.sync.own.has(c.sha) ? toCommit(c) : null
  }

  async realtime() {
    const text = await this.read('.hq/realtime.json').catch(() => null)
    try {
      return text ? realtimeOf(JSON.parse(text)) : null
    } catch {
      return null
    }
  }

  webUrl(path: string) {
    return `https://github.com/${this.c.owner}/${this.c.repo}/blob/${this.c.branch}/${encPath(path)}`
  }
}
