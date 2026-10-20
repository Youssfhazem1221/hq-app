// Ask AI changes under an answer: what the AI proposes, as a preview with Apply and Undo. Nothing is saved until the
// person it was proposed for clicks Apply; each Apply is one commit in their name (GitHub) or one dev-server write
// (local). Every click re-checks the file version and the house rules (lib/ai-apply.ts). Lazy: only answers with
// proposals load it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useHQ } from '../lib/hq-context'
import { Icon } from '../lib/icons'
import type { IconName } from '../lib/contracts'
import { routeFor } from '../lib/hq'
import type { Change } from '../lib/ai-changes'
import { STATE_WORDS, applyChange, priorText, refusalOf, stateOf, undoChange, type ChangeState } from '../lib/ai-apply'
import { toast } from './toast'

const ICON: Record<Change['kind'], IconName> = { file: 'file', todo: 'tasks', post: 'board', reply: 'send', status: 'check' }
const errText = (e: unknown) => String((e as Error)?.message || e).split('\n')[0].slice(0, 200)
type Known = { cur: string | null; next: string }
type Row = { state: ChangeState | 'checking' | 'error'; refusal?: string; canUndo?: boolean; known?: Known }

/** Where a change's file opens in the app (null = a code or config file: shown as its path). */
function linkOf(path: string): string | null {
  if (path.startsWith('todos/')) return '#/tasks'
  const reply = path.match(/^board\/replies\/([^/]+?)--[^/]+\.md$/)
  if (reply) return `#/board?post=${encodeURIComponent(reply[1])}`
  const post = path.match(/^board\/([^/]+)\.md$/)
  if (post) return `#/board?post=${encodeURIComponent(post[1])}`
  return /\.md$/i.test(path) ? '#' + routeFor(path) : null
}

const lineKind = (l: string) => (l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : l[0] === '@' ? 'hunk' : l[0] === '…' ? 'more' : '')

/** A short fingerprint of a note as loaded (FNV-1a over its text): a card re-checks its file when this changes. */
function print(d: { body: string; data: unknown } | undefined) {
  if (!d) return '-'
  const s = d.body + '|' + JSON.stringify(d.data)
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36) + '.' + s.length
}

export default function AiChanges({ changes, mine, forName }: { changes: Change[]; mine: boolean; forName?: string }) {
  const { me, model, source, reload } = useHQ()
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])
  const set = (id: string, row: Row) => alive.current && setRows((r) => ({ ...r, [id]: row }))

  /** Read the file and work out the row: ready (and allowed?), applied (and undoable?), or out of date. */
  const check = async (c: Change, known?: Known) => {
    try {
      const cur = await source.read(c.path)
      const state = await stateOf(c, cur)
      if (state === 'ready') return set(c.id, { state, refusal: (await refusalOf(source, me, c, cur)) || undefined })
      const canUndo = state === 'applied' && (!!known || (cur !== null && (await priorText(c, cur)) !== undefined))
      set(c.id, { state, canUndo, known })
    } catch {
      set(c.id, { state: 'error' })
    }
  }
  const key = changes.map((c) => c.id + c.after).join()
  // re-check when one of these notes changes anywhere (another card, another tab, a push); code files on actions only
  const stamp = useMemo(() => changes.map((c) => print(model.byPath.get(c.path))).join(), [model, key])
  useEffect(() => {
    if (busy) return
    if (mine) for (const c of changes) void check(c, rows[c.id]?.known)
  }, [key, mine, me.login, stamp])

  const ready = changes.filter((c) => rows[c.id]?.state === 'ready' && !rows[c.id]?.refusal)

  const undo = async (list: { c: Change; known?: Known }[]) => {
    setBusy(true)
    let n = 0
    try {
      for (const { c, known } of [...list].reverse()) {
        await undoChange(source, me, c, known ?? rows[c.id]?.known)
        n++
      }
      toast(n === 1 ? `Undone: ${list[0].c.summary}` : `Undid ${n} changes`, 'ok')
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      await reload().catch(() => {})
      for (const { c } of list) await check(c)
      if (alive.current) setBusy(false)
    }
  }

  const apply = async (list: Change[]) => {
    if (!list.length) return
    setBusy(true)
    const done: { c: Change; known: Known }[] = []
    try {
      for (const c of list) {
        const known = await applyChange(source, me, c)
        done.push({ c, known })
        set(c.id, { state: 'applied', canUndo: true, known })
      }
    } catch (e) {
      toast(errText(e), 'error')
    }
    await reload().catch(() => {})
    if (done.length) {
      toast(done.length === 1 ? `Applied: ${done[0].c.summary}` : `Applied ${done.length} changes`, source.kind === 'local' ? 'local' : 'commit', {
        undo: () => void undo(done),
        ms: 12_000,
      })
    }
    for (const c of list.filter((x) => !done.some((d) => d.c.id === x.id))) await check(c)
    if (alive.current) setBusy(false)
  }

  return (
    <section className="aichg" aria-label="Proposed changes">
      <div className="aichg-h">
        <Icon name="edit" />
        <b>{changes.length === 1 ? 'Proposed change' : `${changes.length} proposed changes`}</b>
        <span className="hint">{mine ? 'Nothing is saved until you click Apply' : `Proposed for ${forName || 'someone else'}: only they can apply it`}</span>
        {mine && ready.length > 1 && (
          <button className="btn sm primary" type="button" disabled={busy} onClick={() => void apply(ready)}>
            Apply all ({ready.length})
          </button>
        )}
      </div>
      <ul>
        {changes.map((c) => {
          const row = rows[c.id] || { state: mine ? 'checking' : 'error' }
          const href = linkOf(c.path)
          const code = !/\.md$/i.test(c.path)
          const late = row.state === 'changed' || row.state === 'gone' || row.state === 'exists'
          return (
            <li key={c.id} className="aichg-row">
              <div className="aichg-top">
                <Icon name={ICON[c.kind]} className="aichg-ico" />
                <div className="aichg-t">
                  <b>{c.summary}</b>
                  <span className="aichg-meta">
                    {href && row.state === 'applied' ? <a href={href}>{c.path}</a> : <code>{c.path}</code>}
                    {code && <span className="chip warn">code</span>}
                    <span>
                      <i className="add">+{c.added}</i> <i className="del">−{c.removed}</i>
                    </span>
                  </span>
                  {c.why && <span className="aichg-note">{c.why}</span>}
                  {mine && (late || row.refusal || row.state === 'error') && (
                    <span className="aichg-note warn" role="status">
                      <Icon name={row.refusal ? 'lock' : 'alert'} size="s" />
                      {row.refusal || (row.state === 'error' ? 'Couldn’t check this file right now.' : STATE_WORDS[row.state as 'changed'])}
                    </span>
                  )}
                </div>
                {mine && (
                  <div className="aichg-act" aria-live="polite">
                    {row.state === 'checking' && <Icon name="loader" className="spin muted" />}
                    {row.state === 'ready' && !row.refusal && (
                      <button className="btn sm primary" type="button" disabled={busy} aria-label={`Apply: ${c.summary}`} onClick={() => void apply([c])}>
                        Apply
                      </button>
                    )}
                    {row.state === 'applied' && (
                      <>
                        <span className="chip ok">
                          <Icon name="ok" />
                          Applied
                        </span>
                        {row.canUndo && (
                          <button className="btn sm ghost" type="button" disabled={busy} aria-label={`Undo: ${c.summary}`} onClick={() => void undo([{ c, known: row.known }])}>
                            <Icon name="undo" size="s" />
                            Undo
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
              {c.diff.length > 0 && (
                <details className="aichg-diff" open={changes.length === 1 && row.state !== 'applied' ? true : undefined}>
                  <summary>Show the change</summary>
                  <pre>
                    {c.diff.map((l, i) => (
                      <span key={i} className={'dl ' + lineKind(l)}>
                        {l || ' '}
                      </span>
                    ))}
                  </pre>
                </details>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
