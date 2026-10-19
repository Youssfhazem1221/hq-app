// Board notifications (the bell): derived from the files like every other HQ event. Nothing is stored but a read
// marker per login on this device (a time and ≤200 short hashes: no text, no paths).
// Who hears what: a new post → everyone except its author; a reply or a close → the post's author and everyone who
// already replied in that thread, never the person who did it. Claude's bridge replies count as replies from Claude.
// A reply and a close by the same person within 5 minutes (a join answer, the bridge) read as one item.
import type { Model } from './hq'
import type { Doc } from './md'
import { shortHash, toIso } from './people-core'

export type NoteKind = 'post' | 'reply' | 'closed' | 'replied-closed'
export type Note = {
  /** The event id (the reply's, for a merged reply + close). */
  id: string
  /** Read-state keys: one per event (two for a merged reply + close). */
  hashes: string[]
  kind: NoteKind
  /** Who did it (a login; 'claude' for the bridge). */
  actor: string
  at: string
  /** The post's id (what the Board link opens) and author. */
  post: string
  postAuthor: string
  /** The post's first line. */
  title: string
  /** A reply's first line. */
  snippet?: string
  project?: string
  /** The viewer wrote the post. */
  mine: boolean
  /** The post was sent to the viewer (`to:`). */
  toMe: boolean
}

export type ReadState = { at: string; read: string[] }

export const NOTE_DAYS = 30
export const NOTE_MAX = 50
export const READ_MAX = 200
/** A first run on a device counts the last day as unread (older items show as read). */
export const FIRST_RUN_MS = 24 * 3600_000
const MERGE_MS = 5 * 60_000

const str = (v: unknown) => (v == null ? '' : String(v))
const same = (a: unknown, b: unknown) => !!str(a).trim() && str(a).trim().toLowerCase() === str(b).trim().toLowerCase()
const postIdOf = (d: Doc) => str(d.data.id).trim() || (d.path.split('/').pop() || '').replace(/\.md$/i, '')
const replyAuthor = (d: Doc) => (str(d.data.via).toLowerCase() === 'bridge' ? 'claude' : str(d.data.author).trim())
const isoOf = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const HASH_RE = /^[0-9a-f]{8}$/

/** First readable line of a markdown body (no #, >, list markers or bold), at most `n` characters. */
function firstLine(s: unknown, n = 90): string {
  for (const raw of str(s).split(/\r?\n/)) {
    const l = raw.replace(/^[\s#>*-]+/, '').replace(/\*\*|__|`/g, '').trim()
    if (!l) continue
    const cp = Array.from(l)
    return cp.length > n ? cp.slice(0, n - 1).join('').trimEnd() + '…' : l
  }
  return ''
}

/** The viewer's notifications, newest first: the last `days` days, at most `max`. */
export function notesFor(model: Pick<Model, 'events' | 'board' | 'replies' | 'byPath'>, viewer: string, now: string, opts: { days?: number; max?: number } = {}): Note[] {
  const me = str(viewer).trim()
  const N = Date.parse(now)
  if (!me || !Number.isFinite(N)) return []
  const from = isoOf(N - (opts.days ?? NOTE_DAYS) * 86400_000)
  const byId = new Map<string, Doc>()
  for (const p of model.board || []) byId.set(postIdOf(p), p)
  /** Did the viewer reply in this thread before `at`? */
  const inThread = (post: string, at: string) =>
    (model.replies?.get(post) || []).some((r) => same(replyAuthor(r), me) && toIso(r.data.created) < at)

  const raw: Note[] = []
  for (const e of model.events || []) {
    if (!e.at || e.at < from || same(e.actor, me)) continue
    if (e.kind !== 'post' && e.kind !== 'reply' && e.kind !== 'claude.run' && e.kind !== 'post.closed') continue
    const doc = model.byPath?.get(e.path)
    if (!doc) continue
    const post = e.kind === 'reply' || e.kind === 'claude.run' ? byId.get(str(doc.data.parent).trim()) : doc
    if (!post || post.data.welcome === true || str(post.data.welcome) === 'true') continue
    const postAuthor = str(post.data.author).trim()
    const id = postIdOf(post)
    const mine = same(postAuthor, me)
    if (e.kind !== 'post' && !mine && !inThread(id, e.at)) continue
    raw.push({
      id: e.id,
      hashes: [shortHash(`${e.id}@${e.at}`)],
      kind: e.kind === 'post' ? 'post' : e.kind === 'post.closed' ? 'closed' : 'reply',
      actor: e.actor,
      at: e.at,
      post: id,
      postAuthor,
      title: firstLine(post.body) || firstLine(post.data.title) || id,
      snippet: e.kind === 'reply' || e.kind === 'claude.run' ? firstLine(doc.body) || undefined : undefined,
      project: str(post.data.project).trim() || undefined,
      mine,
      toMe: same(post.data.to, me),
    })
  }

  // A close and a reply by the same person on the same post, close together in time → one item.
  const out: Note[] = []
  const used = new Set<Note>()
  for (const n of raw) {
    if (used.has(n) || n.kind !== 'closed') continue
    const r = raw.find((x) => !used.has(x) && x.kind === 'reply' && x.post === n.post && same(x.actor, n.actor) && Math.abs(Date.parse(x.at) - Date.parse(n.at)) <= MERGE_MS)
    if (!r) continue
    used.add(n).add(r)
    out.push({ ...r, kind: 'replied-closed', hashes: [...r.hashes, ...n.hashes], at: r.at > n.at ? r.at : n.at })
  }
  for (const n of raw) if (!used.has(n)) out.push(n)
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1)).slice(0, opts.max ?? NOTE_MAX)
}

// ---- read state ----

/** A stored read state, cleaned (anything else → the first-run state for `now`). */
export function cleanRead(v: unknown, now: string): ReadState {
  const x = v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  const at = x && typeof x.at === 'string' ? toIso(x.at) : ''
  if (!x || !at) return firstRead(now)
  const read = Array.isArray(x.read) ? [...new Set(x.read.filter((h): h is string => typeof h === 'string' && HASH_RE.test(h)))] : []
  return { at, read: read.slice(-READ_MAX) }
}

export const firstRead = (now: string): ReadState => ({ at: isoOf((Date.parse(now) || Date.now()) - FIRST_RUN_MS), read: [] })

export const isUnread = (n: Note, s: ReadState) => n.at > s.at && !n.hashes.some((h) => s.read.includes(h))

export const unreadCount = (notes: Note[], s: ReadState) => notes.filter((n) => isUnread(n, s)).length

export function markRead(s: ReadState, n: Note): ReadState {
  const add = n.hashes.filter((h) => !s.read.includes(h))
  return add.length ? { at: s.at, read: [...s.read, ...add].slice(-READ_MAX) } : s
}

/** Everything up to now (and any item stamped later) is read; the marker never moves back. */
export function markAllRead(s: ReadState, notes: Note[], now: string): ReadState {
  let at = toIso(now) || s.at
  for (const n of notes) if (n.at > at) at = n.at
  return { at: at > s.at ? at : s.at, read: [] }
}

/** Items that were not in the previous list (`before` = its first hashes; null = the first look: nothing is new). */
export function freshNotes(before: Set<string> | null, notes: Note[]): Note[] {
  return before ? notes.filter((n) => !before.has(n.hashes[0])) : []
}

// ---- words ----

/** "Claude replied to your post" + the post's title, for the list, pop-ups and screen readers. */
export function noteWords(n: Note, nameOf: (login: string) => string): { who: string; what: string; title: string; line: string } {
  const who = nameOf(n.actor)
  const whose = n.mine ? 'your' : same(n.actor, n.postAuthor) ? 'their' : `${nameOf(n.postAuthor)}’s`
  const what =
    n.kind === 'post'
      ? n.toMe ? 'posted to you' : 'posted'
      : n.kind === 'reply'
        ? `replied to ${whose} post`
        : n.kind === 'closed'
          ? `closed ${whose} post`
          : `replied and closed ${whose} post`
  return { who, what, title: n.title, line: `${who} ${what}: ${n.title}` }
}

/** The system pop-up's title. */
export const POPUP_TITLE: Record<NoteKind, string> = {
  post: 'New board post',
  reply: 'New reply',
  closed: 'Post closed',
  'replied-closed': 'Reply · post closed',
}

/** The Board link for an item: the page scrolls to that post and lights it up. */
export const noteHref = (n: Note) => '#/board?post=' + encodeURIComponent(n.post)

/** The post id a Board link asks for (`#/board?post=<id>`), or ''. */
export function postFromHash(hash: string): string {
  const m = str(hash).match(/^#?\/board\?(?:.*&)?post=([^&]*)/)
  if (!m) return ''
  try {
    return decodeURIComponent(m[1]).trim()
  } catch {
    return ''
  }
}
