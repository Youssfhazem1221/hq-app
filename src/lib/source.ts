// Where the data comes from: the local folder (dev) or the private GitHub repo (deployed).
import { commitActor } from './people-core'
import { encPath, excluded, ghError, netError, RepoSync, StaleWriteError, updateLoop, type FileEntry, type UpdateFn } from './sync'

export { BAD_TOKEN_MSG } from './sync'
export { excluded, StaleWriteError, updateLoop, type FileEntry, type UpdateFn }
/** `configured` (local mode only): false = HQ_LOCAL_LOGIN is not set, so `login` is the default owner login. Local
 *  project writes are refused then; the UI should say "set HQ_LOCAL_LOGIN in .env.local". */
export type Me = { login: string; name: string; avatar?: string; configured?: boolean }
/** `message` = the subject line; `body` = the rest of the message; `actor` = who really did it ('claude' for
 *  commits with the Claude trailer or a `claude:` subject, 'hq-ai' / 'hq-digest' for the bots, else `author`). */
export type Commit = { sha: string; message: string; body: string; author: string; actor: string; avatar?: string; date: string }

/** A Commit from a full message (subject + body). `actorName` = the git author name, used to spot the bots. */
export function commitOf(c: { sha: string; full: string; author: string; actorName?: string; avatar?: string; date: string }): Commit {
  const full = String(c.full || '')
  const [subject = '', ...rest] = full.split(/\r?\n/)
  const name = String(c.actorName || '')
  const actor = commitActor({ message: full, author: /^hq-(ai|digest)$/i.test(name) ? name : c.author })
  return { sha: c.sha, message: subject, body: rest.join('\n').trim(), author: c.author, actor, avatar: c.avatar, date: c.date }
}

/** A text without a leading byte-order mark (U+FEFF). */
const noBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

/** sha1 (hex) of a text, the way the local dev server checks `expect` (a leading BOM is ignored). */
export async function sha1hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(noBom(String(text))))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
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
  /** A file's raw bytes (an image a note shows in the Docs reader). null = no such file. */
  readBytes(path: string): Promise<Blob | null>
  write(path: string, text: string, message: string): Promise<void>
  /**
   * Safe read-modify-write: `fn(current text | null)` → the new text, or null / the same text to skip. If the file
   * changes meanwhile (another tab, device or person), `fn` runs again on the newer text (≤3 tries). So `fn` must
   * be pure. true = written (one commit on GitHub), false = nothing to change.
   */
  update(path: string, fn: UpdateFn, message: string): Promise<boolean>
  /**
   * An Ask AI change the person applied (any text file, code too): create, replace, or delete when `next` is null
   * (the Undo of a file they created). Only if the file is still exactly `base` (null = it must not exist), else
   * StaleWriteError. One commit on GitHub; `message` names the person. The house rules are checked before (lib/ai-apply)
   * and again by the dev server in local mode.
   */
  apply(path: string, base: string | null, next: string | null, message: string): Promise<void>
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
  /** Text this tab itself just wrote, per path (undefined = deleted): the dev server's file event for it is not
   *  "changed on this PC". */
  private own = new Map<string, string | undefined>()

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
    this.own.clear()
    return files
  }
  async refresh() {
    const r = await fetch('/__hq/files', { cache: 'no-store' })
    if (!r.ok) throw new Error('Local dev server not reachable')
    const files: FileEntry[] = await r.json()
    const changed = this.remember(files)
    if (!changed.length) return null
    // Our own writes still rebuild the model, but they are not reported as someone else's change (no toast).
    const theirs = changed.filter((p) => !this.own.has(p) || this.own.get(p) !== this.last.get(p))
    for (const p of changed) this.own.delete(p)
    return { files, changed: theirs }
  }
  async read(path: string) {
    const r = await fetch('/__hq/read?path=' + encodeURIComponent(path), { cache: 'no-store' })
    if (r.status === 404) return null
    // an error body must never be taken for the file's text (update() would edit it)
    if (!r.ok) throw new Error(`Local dev server: could not read ${path} (${r.status})`)
    return r.text()
  }
  /** GET /__hq/raw: the bytes of an image inside the workspace (.png .jpg .jpeg .webp .gif only). */
  async readBytes(path: string) {
    const r = await fetch('/__hq/raw?path=' + encodeURIComponent(path), { cache: 'no-store' })
    if (r.status === 404) return null
    if (!r.ok) throw new Error(`Local dev server: could not read ${path} (${r.status})`)
    return r.blob()
  }
  /** `expect`: sha1 of the text this change was based on, or 'absent' (create-only). The server answers 409 when
   *  the file is not that version any more. Without `expect` it overwrites (the old behaviour). */
  private async send(path: string, text: string, expect?: string) {
    const r = await fetch('/__hq/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(expect === undefined ? { path, text } : { path, text, expect }),
    })
    if (r.status === 409) throw new StaleWriteError(`Not saved: ${path} was changed on disk just now. Make your change again.`)
    if (!r.ok) throw new Error(`Save failed: ${await r.text()}`)
    this.own.set(path, text)
  }
  async write(path: string, text: string) {
    await this.send(path, text)
  }
  /** Ask AI → Apply: `via: "ai"` makes the dev server check the shared write policy (any text file it allows). */
  async apply(path: string, base: string | null, next: string | null) {
    const r = await fetch('/__hq/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, via: 'ai', expect: base === null ? 'absent' : await sha1hex(base), ...(next === null ? { delete: true } : { text: next }) }),
    })
    if (r.status === 409) throw new StaleWriteError(`Not saved: ${path} changed since the AI read it. Ask again for a fresh change.`)
    if (!r.ok) throw new Error(`Not saved: ${String((await r.json().catch(() => null))?.error || r.status)}`)
    this.own.set(path, next ?? undefined)
  }
  update(path: string, fn: UpdateFn) {
    // A new file (not in the last file list): skip the first read, whose 404 the browser logs as a console error, and
    // create it with expect 'absent'. If it exists after all, the server answers 409 and the next try reads it for real.
    let assumeNew = this.last.size > 0 && !this.last.has(path)
    return updateLoop(
      () => {
        if (!assumeNew) return this.read(path)
        assumeNew = false
        return null
      },
      async (next, cur) => this.send(path, next, cur === null ? 'absent' : await sha1hex(cur)),
      fn,
      3,
      path,
    )
  }
  async me() {
    return (await fetch('/__hq/me')).json()
  }
  async activity(path?: string): Promise<Commit[]> {
    const r = await fetch('/__hq/activity' + (path ? '?path=' + encodeURIComponent(path) : ''), { cache: 'no-store' })
    if (!r.ok) return []
    const list = await r.json().catch(() => [])
    return (Array.isArray(list) ? list : []).map((c: any) =>
      commitOf({ sha: c.sha, full: [c.message, c.body].filter(Boolean).join('\n\n'), author: c.author, actorName: c.author, date: c.date }),
    )
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

/** A REST commit → Commit. Keeps the whole message, so the body (and the Claude trailer in it) is not lost. */
export const toCommit = (c: any): Commit =>
  commitOf({
    sha: c.sha,
    full: String(c.commit?.message ?? ''),
    author: c.author?.login || c.commit?.author?.name || '?',
    actorName: c.commit?.author?.name,
    avatar: c.author?.avatar_url,
    date: c.commit?.author?.date,
  })

export class GitHubSource implements Source {
  kind = 'github' as const
  private sync: RepoSync
  // A plain field (no constructor parameter property), so Node can load this file by type stripping (tests).
  private c: GhConfig
  constructor(c: GhConfig) {
    this.c = c
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

  /** Every GitHub call. No answer at all (offline, blocked, a bad character in the token) → a plain-words error. */
  private async api(path: string, init: RequestInit = {}) {
    try {
      return await fetch('https://api.github.com' + path, {
        ...init,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.c.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.headers || {}),
        },
      })
    } catch (e) {
      throw netError(e)
    }
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

  /** Bytes through the same contents API: the raw media type also serves files over 1 MB; the token stays in the header. */
  async readBytes(path: string) {
    const r = await this.api(`${this.repoPath}/contents/${encPath(path)}?ref=${encodeURIComponent(this.c.branch)}`, {
      headers: { Accept: 'application/vnd.github.raw+json' },
    })
    if (r.status === 404) return null
    if (!r.ok) throw new Error(`GitHub ${r.status}`)
    return r.blob()
  }

  write(path: string, text: string, message: string) {
    return this.sync.write(path, text, message)
  }

  apply(path: string, base: string | null, next: string | null, message: string) {
    return this.sync.applyFile(path, base, next, message)
  }

  /** Reads from the sync cache (0 extra calls); a stale cache shows up as StaleWriteError, which re-syncs it. */
  update(path: string, fn: UpdateFn, message: string) {
    return updateLoop(() => this.sync.cached(path) ?? null, (next) => this.sync.write(path, next, message), fn, 3, path)
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
