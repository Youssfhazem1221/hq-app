// Ask AI changes (2026-10-20): the AI proposes, the person applies. A saved answer keeps its proposals in a
// ```hq-changes block after its Sources (the shared server code writes it: supabase/functions/_shared/propose.mjs
// changesBlock); the live stream sends the same objects as `proposals` events. This module reads them back for the
// Apply cards. Total: anything malformed is dropped, never thrown. Applying lives in ai-apply.ts (lazy).

export type ChangeKind = 'file' | 'todo' | 'post' | 'reply' | 'status'
export type Edit = { find: string; replace: string }
export type Change = {
  id: string
  kind: ChangeKind
  /** create = a new file · replace = the whole new text · edit = exact replacements (big files) */
  op: 'create' | 'replace' | 'edit'
  path: string
  summary: string
  why?: string
  /** sha1 of the text it was made from (null = the file must not exist yet) */
  base: string | null
  /** sha1 of the text after it */
  after: string
  text?: string
  edits?: Edit[]
  /** replace: the whole old text (small files), so Undo still works after a reload */
  before?: string
  /** preview lines: ' ' kept · '-' removed · '+' added · '@' a "line N" marker · '…' more */
  diff: string[]
  added: number
  removed: number
  /** the login it was proposed for (only they get Apply) */
  by: string
}

export const MAX_CHANGES = 6
const SHA = /^[0-9a-f]{40}$/
const KINDS = new Set(['file', 'todo', 'post', 'reply', 'status'])
const OPS = new Set(['create', 'replace', 'edit'])
/** The block as propose.mjs writes it (after the answer's Sources). */
const BLOCK = /\r?\n[ \t]*-{3,}[ \t]*\r?\n+[ \t]*\*\*Proposed changes\*\*[^\n]*\r?\n+```hq-changes[ \t]*\r?\n([^\n]*)\r?\n```[ \t]*(?:\r?\n|$)/

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0)
/** A repo path a change may name: relative, forward slashes, no "..", no drive letters or NUL. */
const okPath = (p: string) => !!p && p.length <= 300 && !/[\\:\0]/.test(p) && !p.startsWith('/') && !p.split('/').some((s) => s === '..' || s === '' || s === '.')

/** One proposal from untrusted JSON (an answer file anyone on the team can edit), or null. */
export function validChange(x: any, i = 0): Change | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null
  const path = str(x.path, 300)
  if (!okPath(path) || !KINDS.has(x.kind) || !OPS.has(x.op)) return null
  const base = x.base === null ? null : typeof x.base === 'string' && SHA.test(x.base) ? x.base : undefined
  if (base === undefined || typeof x.after !== 'string' || !SHA.test(x.after) || (x.op === 'create') !== (base === null)) return null
  const edits = Array.isArray(x.edits)
    ? x.edits.filter((e: any) => e && typeof e.find === 'string' && typeof e.replace === 'string').slice(0, 20).map((e: any) => ({ find: e.find, replace: e.replace }))
    : []
  if (x.op === 'edit' ? !edits.length : typeof x.text !== 'string') return null
  return {
    id: str(x.id, 20) || `c${i + 1}`,
    kind: x.kind,
    op: x.op,
    path,
    summary: str(x.summary, 160) || path,
    why: str(x.why, 220) || undefined,
    base,
    after: x.after,
    text: x.op === 'edit' ? undefined : x.text,
    edits: x.op === 'edit' ? edits : undefined,
    before: x.op === 'replace' && typeof x.before === 'string' ? x.before : undefined,
    diff: (Array.isArray(x.diff) ? x.diff : []).filter((l: unknown) => typeof l === 'string').slice(0, 200).map((l: string) => l.slice(0, 320)),
    added: num(x.added),
    removed: num(x.removed),
    by: str(x.by, 40),
  }
}

/** A list of proposals (the stream's `proposals` items, or a parsed block): valid ones only, one per path. */
export function changesOf(list: unknown): Change[] {
  const out: Change[] = []
  for (const [i, x] of (Array.isArray(list) ? list : []).entries()) {
    const c = validChange(x, i)
    if (c && !out.some((o) => o.path === c.path)) out.push(c)
  }
  return out.slice(0, MAX_CHANGES)
}

/** An answer's markdown without its "Proposed changes" block, plus the proposals in it. */
export function splitChanges(md: string): { md: string; changes: Change[] } {
  const text = String(md ?? '')
  const m = text.match(BLOCK)
  if (!m || m.index === undefined) return { md: text, changes: [] }
  let list: unknown = []
  try {
    list = JSON.parse(m[1])
  } catch {
    list = []
  }
  return { md: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trimEnd(), changes: changesOf(list) }
}
