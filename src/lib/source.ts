// Where the data comes from: the local folder (dev) or the private GitHub repo (deployed).

export type FileEntry = { path: string; text: string }
export type Me = { login: string; name: string; avatar?: string }
export type Commit = { sha: string; message: string; author: string; avatar?: string; date: string }

export interface Source {
  kind: 'local' | 'github'
  label: string
  loadAll(): Promise<FileEntry[]>
  read(path: string): Promise<string | null>
  write(path: string, text: string, message: string): Promise<void>
  me(): Promise<Me>
  /** Recent commits, optionally only those touching one path. */
  activity(path?: string): Promise<Commit[]>
  webUrl(path: string): string | null
  /** Local only: answer an AI request right away (on GitHub, an Action does it). */
  runAi?(id: string): Promise<void>
}

/** Skip dot-folders (.claude, .github), the app itself, and node_modules. */
export const excluded = (p: string) =>
  p.split('/').some((s) => s.startsWith('.') || s === 'node_modules') || p === 'app' || p.startsWith('app/')
const isMd = (p: string) => p.toLowerCase().endsWith('.md')

export class LocalSource implements Source {
  kind = 'local' as const
  label = 'Local folder'
  async loadAll() {
    const r = await fetch('/__hq/files', { cache: 'no-store' })
    if (!r.ok) throw new Error('Local dev server not reachable')
    return r.json()
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
  webUrl() {
    return null
  }
  async runAi(id: string) {
    const r = await fetch('/__hq/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) })
    if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.log || 'AI worker failed')
  }
}

export type GhConfig = { owner: string; repo: string; branch: string; token: string }

const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/')
const b64 = (s: string) => {
  let bin = ''
  new TextEncoder().encode(s).forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin)
}

export class GitHubSource implements Source {
  kind = 'github' as const
  constructor(private c: GhConfig) {}
  get label() {
    return `${this.c.owner}/${this.c.repo}`
  }
  /** For the Supabase function: it acts with the same token, on the same repo. */
  get auth() {
    return { token: this.c.token, repo: `${this.c.owner}/${this.c.repo}`, branch: this.c.branch }
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
    if (!r.ok) {
      const msg = (await r.text()).slice(0, 200)
      if (r.status === 401) throw new Error('GitHub token rejected (expired or wrong). Update it in Settings.')
      if (r.status === 404) throw new Error('Repo not found, or the token has no access to it. Check Settings.')
      throw new Error(`GitHub ${r.status}: ${msg}`)
    }
    return r.json()
  }
  private get repoPath() {
    return `/repos/${this.c.owner}/${this.c.repo}`
  }

  async loadAll() {
    const { owner, repo, branch } = this.c
    const tree = await this.json(`${this.repoPath}/git/trees/${encodeURIComponent(branch)}?recursive=1`)
    const paths: string[] = tree.tree
      .filter((t: any) => t.type === 'blob' && isMd(t.path) && !excluded(t.path))
      .map((t: any) => t.path)
    const out: FileEntry[] = []
    // One GraphQL call fetches up to 80 files' text at once.
    for (let i = 0; i < paths.length; i += 80) {
      const chunk = paths.slice(i, i + 80)
      const fields = chunk
        .map((p, j) => `f${j}: object(expression: ${JSON.stringify(`${branch}:${p}`)}) { ... on Blob { text } }`)
        .join('\n')
      const query = `query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) { ${fields} } }`
      const res = await this.json('/graphql', { method: 'POST', body: JSON.stringify({ query }), headers: { 'Content-Type': 'application/json' } })
      if (res.errors?.length) throw new Error(res.errors[0].message)
      chunk.forEach((p, j) => {
        const text = res.data?.repository?.[`f${j}`]?.text
        if (typeof text === 'string') out.push({ path: p, text })
      })
    }
    return out
  }

  async read(path: string) {
    const r = await this.api(`${this.repoPath}/contents/${encPath(path)}?ref=${encodeURIComponent(this.c.branch)}`, {
      headers: { Accept: 'application/vnd.github.raw+json' },
    })
    if (r.status === 404) return null
    if (!r.ok) throw new Error(`GitHub ${r.status}`)
    return r.text()
  }

  async write(path: string, text: string, message: string) {
    const url = `${this.repoPath}/contents/${encPath(path)}`
    let sha: string | undefined
    const cur = await this.api(`${url}?ref=${encodeURIComponent(this.c.branch)}`)
    if (cur.ok) sha = (await cur.json()).sha
    await this.json(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: b64(text), branch: this.c.branch, ...(sha ? { sha } : {}) }),
    })
  }

  async me() {
    const u = await this.json('/user')
    return { login: u.login, name: u.name || u.login, avatar: u.avatar_url }
  }

  async activity(path?: string) {
    const only = path ? `&path=${encodeURIComponent(path)}` : ''
    const cs = await this.json(`${this.repoPath}/commits?sha=${encodeURIComponent(this.c.branch)}&per_page=15${only}`)
    return cs.map((c: any) => ({
      sha: c.sha,
      message: String(c.commit.message).split('\n')[0],
      author: c.author?.login || c.commit.author?.name || '?',
      avatar: c.author?.avatar_url,
      date: c.commit.author?.date,
    }))
  }

  webUrl(path: string) {
    return `https://github.com/${this.c.owner}/${this.c.repo}/blob/${this.c.branch}/${encPath(path)}`
  }
}
