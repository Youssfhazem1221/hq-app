// Small pieces the four work pages share (module C1): project glyph / tag / stale dot, ages with a "from … · … ago"
// tooltip, the to-do control (Decide for decisions, a tick otherwise), Start/Reopen writers with byte-exact Undo, and
// the human words for commits ("Claude updated the docs"). Colour = the project's validated slot through
// `data-pc="1..8"` (work.css), never an inline value and never the grid's cN classes.
import type { ReactNode } from 'react'
import { Icon, hasIcon } from '../lib/icons'
import type { IconName, NextItem } from '../lib/contracts'
import { useNextActions } from '../lib/hq-context'
import { displayName, setTodoStatus, type Model } from '../lib/hq'
import type { Doc } from '../lib/md'
import type { Commit, Me, Source } from '../lib/source'
import { isDecision, isOpenTodo, projectOfTodo, projectSlugOf, todoTitle, type NextModel } from '../lib/next-core'
import { toast } from './toast'

export const same = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
export const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

/** Colour slot 1–8 from `color:` (anything else = 1). */
export function slotOf(p: Doc | undefined | null): number {
  const n = Number(p?.data?.color)
  return Number.isInteger(n) && n >= 1 && n <= 8 ? n : 1
}
export const projectBySlug = (model: Model, slug: string | undefined) => (slug ? model.projects.find((p) => projectSlugOf(p) === slug) : undefined)
/** A project's display name (its title) and a short one for tags (title before " · " / ":" / "(" , ≤ 22 chars). */
export const projectTitle = (p: Doc | undefined, slug = '') => String(p?.data?.title || slug || '').trim()
export function shortTitle(p: Doc | undefined, slug = '') {
  const t = projectTitle(p, slug).split(/\s+[·:(–-]\s*|\s*\(/)[0].trim() || projectTitle(p, slug)
  return clip(t, 22)
}
/** The project's own icon (`icon:` when it is a known name), else null: the glyph then shows the title's first letter
 *  (never a status icon, which would repeat the status pill and make different projects look alike). */
export const projectIcon = (p: Doc | undefined): IconName | null => {
  const i = p?.data?.icon
  return hasIcon(i) ? i : null
}
const initialOf = (p: Doc | undefined) => (Array.from(projectTitle(p).replace(/^[^\p{L}\p{N}]+/u, ''))[0] || '·').toUpperCase()

export function ProjectGlyph({ project, lg }: { project: Doc | undefined; lg?: boolean }) {
  const icon = projectIcon(project)
  return (
    <span className={'pglyph' + (lg ? ' lg' : '')} data-pc={slotOf(project)} aria-hidden="true">
      {icon ? <Icon name={icon} /> : <b className="pg-l">{initialOf(project)}</b>}
    </span>
  )
}
export function ProjectTag({ model, slug }: { model: Model; slug?: string }) {
  const p = projectBySlug(model, slug)
  if (!slug) return null
  return (
    <span className="pj">
      <i className="pdot" data-pc={slotOf(p)} />
      {shortTitle(p, slug)}
    </span>
  )
}

/** Days since a date (YYYY-MM-DD or ISO), or null. */
export function daysSince(v: unknown, now = Date.now()) {
  const t = Date.parse(String(v || ''))
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 864e5)) : null
}
/** Freshness speaks only when stale: amber after 7 days, silent otherwise. */
export function StaleDot({ updated }: { updated: unknown }) {
  const d = daysSince(updated)
  if (d === null || d <= 7) return null
  return (
    <span className="fresh amber" data-tipt={`Not updated for ${d} days`}>
      <i />
      {d} d
    </span>
  )
}
/** "12 min" · "5 h" · "3 d" (no "ago"; the tooltip says it). */
export function shortAgo(iso: unknown, now = Date.now()) {
  const t = Date.parse(String(iso || ''))
  if (!Number.isFinite(t) || t > now + 60000) return ''
  const m = Math.max(0, Math.round((now - t) / 60000))
  if (m < 60) return m + ' min'
  const h = Math.round(m / 60)
  if (h < 24) return h + ' h'
  return Math.round(h / 24) + ' d'
}
export function AgeTip({ model, iso, by }: { model: Model; iso: unknown; by?: unknown }) {
  const a = shortAgo(iso)
  if (!a) return null
  const who = by ? displayName(model, by) : ''
  return (
    <span className="age" data-tipt={(who ? `from ${who} · ` : '') + a + ' ago'}>
      {a}
    </span>
  )
}

/** A to-do as a Next item (same id everywhere: 'todo:<path>'). */
export function todoAsItem(t: Doc, model: Model): NextItem {
  const m = model as unknown as NextModel
  return {
    kind: isDecision(t, m) ? 'decision' : 'todo',
    id: 'todo:' + t.path,
    text: todoTitle(t),
    project: projectOfTodo(t, m),
    path: t.path,
    from: t.data.by ? String(t.data.by) : undefined,
    since: t.data.created ? String(t.data.created) : undefined,
  }
}

/** The control a to-do row gets: Decide (an open decision) or a tick. Ticking an open to-do goes through the Next
 *  actions (the bar with the same id fills); un-ticking calls `onReopen`. */
export function TodoControl({ todo, model, onReopen }: { todo: Doc; model: Model; onReopen?: (t: Doc) => void }) {
  const { act, completing } = useNextActions()
  const open = isOpenTodo(todo)
  const item = todoAsItem(todo, model)
  const busy = completing === item.id
  if (open && item.kind === 'decision')
    return (
      <button className="btn sm dec" type="button" onClick={() => act(item)}>
        Decide
      </button>
    )
  return (
    <button
      className="cbx"
      type="button"
      role="checkbox"
      aria-checked={!open || busy}
      aria-label={(open ? 'Done: ' : 'Reopen: ') + item.text}
      data-tick=""
      disabled={busy}
      onClick={() => (open ? act({ ...item, kind: 'todo' }) : onReopen?.(todo))}
    >
      <Icon name="check" />
    </button>
  )
}

/** Move a to-do (setTodoStatus) with an Undo that restores the exact bytes when nothing else changed the file. */
export async function moveTodo(src: Source, me: Me, todo: Doc, status: 'todo' | 'doing' | 'done', reload: () => Promise<void>, text: string) {
  try {
    const before = await src.read(todo.path)
    const ok = await setTodoStatus(src, me, todo, status)
    if (!ok) return
    const after = await src.read(todo.path)
    await reload()
    toast(text, 'ok', {
      undo: () => {
        src
          .update(todo.path, (cur) => (cur !== null && cur === after && before !== null ? before : cur), `todo: undo · ${clip(String(todo.data.title || ''), 40)}`)
          .then(() => reload())
          .then(() => toast('Undone', 'info'))
          .catch((e) => toast('Could not undo: ' + (e?.message || e), 'error'))
      },
    })
  } catch (e: any) {
    toast(String(e?.message || e), 'error')
  }
}

// ---- commits in human words (Home "Recent changes", project activity): lib/changes.ts (the app shell's change toast uses it too) ----
export { humanChange } from '../lib/changes'

/** Section helper: an optional block that renders only with content. */
export const When = ({ on, children }: { on: unknown; children: ReactNode }) => (on ? <>{children}</> : null)
