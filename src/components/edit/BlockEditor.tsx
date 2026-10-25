// The block editor (HQ as a portfolio, phase 3): a note's body as its blocks, each drawn as it reads. Click a block
// (or focus it and press Enter) to edit just that block: only its text changes in the file, every other byte stays.
// Right-click (long-press, Shift+F10) for Edit · Insert below · Move up · Move down · Remove. A ```chart or
// ```explainer block must still be valid JSON to save. The page's status, summary and next are click-to-edit above.
// "Edit all text" opens the raw box (the Docs reader's own editor). Lazy chunk, opened from the Docs reader's Edit.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useHQ } from '../../lib/hq-context'
import { Icon } from '../../lib/icons'
import type { IconName } from '../../lib/contracts'
import type { Doc } from '../../lib/md'
import { setTopKeys } from '../../lib/people-core'
import { StalePartError, insertBlock, moveBlock, removeBlock, replaceBlock, splitBlocks, type Block } from '../../lib/fm-edit'
import { Markdown, StatusPill } from '../ui'
import { toast } from '../toast'
import { InlineText, useContextMenu, useSave } from './kit'

const STATUSES = ['active', 'waiting', 'done', 'parked'] as const
const ICON: Record<(typeof STATUSES)[number], IconName> = { active: 'zap', waiting: 'clock', done: 'ok', parked: 'pause' }
const KIND_NAME: Record<Block['kind'], string> = { heading: 'Heading', para: 'Paragraph', list: 'List', table: 'Table', quote: 'Quote', code: 'Code', chart: 'Chart', explainer: 'Explainer', rule: 'Line', html: 'HTML' }
const MONO = new Set<Block['kind']>(['table', 'code', 'chart', 'explainer', 'html'])
const str = (v: unknown) => (v == null ? '' : String(v))

/** A ```chart / ```explainer block's JSON must still parse (else the reader would show it as code). '' = fine. */
function jsonProblem(src: string): string {
  const m = src.match(/^\s*(`{3,}|~{3,})\s*(chart|explainer)\b[^\n]*\n([\s\S]*?)\n\s*\1\s*$/)
  if (!m) return /^\s*(`{3,}|~{3,})\s*(chart|explainer)\b/.test(src) ? 'Close the block with ``` on its own line' : ''
  try {
    JSON.parse(m[3])
    return ''
  } catch (e) {
    return `The ${m[2]} JSON has an error: ${String((e as Error).message || e).slice(0, 120)}`
  }
}

export default function BlockEditor({ doc, onDone, onRaw }: { doc: Doc; onDone: () => void; onRaw: () => void }) {
  const { source } = useHQ()
  const save = useSave()
  const ctx = useContextMenu()
  const [text, setText] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ at: number; insert: boolean } | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const load = () =>
    source.read(doc.path).then(
      (t) => setText(t ?? ''),
      (e) => toast(String(e?.message || e), 'error'),
    )
  useEffect(() => void load(), [doc.path, doc.body])
  const blocks = useMemo(() => (text === null ? [] : splitBlocks(text)), [text])
  useEffect(() => {
    if (editing) requestAnimationFrame(() => box.current?.focus())
  }, [editing])
  const name = str(doc.data.title || doc.path.split('/').pop()).slice(0, 40)

  /** One change to the file: `fn` gets the current text and its blocks; the block shown at `i` must still be there. */
  const change = async (i: number | null, fn: (cur: string, now: Block[]) => string, message: string, done: string) => {
    const shown = i === null ? null : blocks[i]
    setBusy(true)
    try {
      await save(
        doc.path,
        (cur) => {
          const now = splitBlocks(cur)
          if (shown && now[i!]?.src !== shown.src) throw new StalePartError()
          return fn(cur, now)
        },
        `docs: ${message} · ${name}`,
        done,
      )
      await load()
      return true
    } catch (e: any) {
      toast(String(e?.message || e), 'error')
      return false
    } finally {
      setBusy(false)
    }
  }
  const start = (at: number, insert = false) => {
    setDraft(insert ? '' : blocks[at]?.src ?? '')
    setEditing({ at, insert })
  }
  const commit = async () => {
    if (!editing) return
    const { at, insert } = editing
    const t = draft.replace(/\s+$/, '')
    const bad = jsonProblem(t)
    if (bad) return toast(bad, 'error')
    if (insert) {
      if (!t.trim()) return setEditing(null)
      const ok = await change(at >= 0 ? at : null, (cur, now) => insertBlock(cur, at >= 0 ? now[at] : null, t), 'add a block', 'Block added')
      if (ok) setEditing(null)
      return
    }
    if (t === blocks[at]?.src) return setEditing(null)
    const ok = await change(at, (cur, now) => replaceBlock(cur, now[at], t), t.trim() ? 'edit a block' : 'remove a block', t.trim() ? 'Saved' : 'Block removed')
    if (ok) setEditing(null)
  }
  const menu = (i: number) => [
    { label: 'Edit', icon: 'edit' as const, run: () => start(i) },
    { label: 'Insert a block below', icon: 'plus' as const, run: () => start(i, true) },
    { label: 'Move up', icon: 'up' as const, disabled: i === 0, run: () => void change(i, (cur, now) => moveBlock(cur, now, i, -1), 'move a block', 'Moved up') },
    { label: 'Move down', icon: 'down' as const, disabled: i === blocks.length - 1, run: () => void change(i, (cur, now) => moveBlock(cur, now, i, 1), 'move a block', 'Moved down') },
    { label: 'Remove', icon: 'x' as const, run: () => void change(i, (cur, now) => removeBlock(cur, now[i]), 'remove a block', 'Block removed') },
  ]
  const setProp = (key: string, value: string) => change(null, (cur) => setTopKeys(cur, { [key]: value || null, updated: new Date().toISOString().slice(0, 10) }), `${key}`, `${key[0].toUpperCase()}${key.slice(1)} saved`)
  const status = str(doc.data.status).toLowerCase()
  const statusMenu = () => STATUSES.map((s) => ({ label: s === status ? `${s} (now)` : s, icon: ICON[s], disabled: s === status, run: () => void setProp('status', s) }))

  const editor = (
    <div className="fv-stack">
      <textarea
        ref={box}
        className="inp"
        value={draft}
        disabled={busy}
        rows={Math.min(24, Math.max(3, draft.split('\n').length + 1, Math.ceil(draft.length / 60)))}
        style={editing && !editing.insert && MONO.has(blocks[editing.at]?.kind) ? { fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)' } : undefined}
        aria-label={editing?.insert ? 'New block (Markdown)' : 'Block text (Markdown)'}
        placeholder="Write Markdown: a paragraph, a list (- item), a table (| a | b |), a ## heading…"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), setEditing(null))
          else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.preventDefault(), void commit())
        }}
      />
      <div className="fv-foot">
        <button className="btn sm primary" type="button" disabled={busy} onClick={() => void commit()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button className="btn sm ghost" type="button" disabled={busy} onClick={() => setEditing(null)}>
          Cancel
        </button>
        <span className="sm muted">Ctrl+Enter saves · Esc cancels{editing && !editing.insert ? ' · an empty block is removed' : ''}</span>
      </div>
    </div>
  )

  return (
    <div className="blk-ed">
      <div className="doc-acts">
        <button className="btn sm primary" type="button" onClick={onDone}>
          <Icon name="check" size="s" />
          Done editing
        </button>
        <button className="btn sm ghost" type="button" onClick={onRaw}>
          <Icon name="file" size="s" />
          Edit all text
        </button>
        <span className="sm muted">Click a block to change it. Right-click one (or long-press it) to move, add or remove blocks.</span>
      </div>
      <dl className="props">
        <div className="prop">
          <dt>Status</dt>
          <dd>
            <button type="button" className="ie" aria-haspopup="menu" aria-label={`Status: ${status || 'none'}. Change it`} onClick={(e) => ctx.show(e.clientX || e.currentTarget.getBoundingClientRect().left, e.clientY || e.currentTarget.getBoundingClientRect().bottom, statusMenu(), 'Status', e.currentTarget)}>
              {status ? <StatusPill status={status} /> : <span className="muted">Add a status</span>}
            </button>
          </dd>
        </div>
        <div className="prop">
          <dt>Summary</dt>
          <dd>
            <InlineText value={str(doc.data.summary)} label="summary" multiline max={400} onSave={(v) => setProp('summary', v.trim())} />
          </dd>
        </div>
        <div className="prop">
          <dt>Next</dt>
          <dd>
            <InlineText value={str(doc.data.next)} label="next step" max={140} onSave={(v) => setProp('next', v.trim())} />
          </dd>
        </div>
      </dl>
      {text === null ? (
        <span className="sk" style={{ width: '100%', height: 120 }} aria-label="Loading the page" />
      ) : (
        <div className="fv-stack" style={{ gap: 'var(--s2)' }}>
          {blocks.map((b, i) => {
            const bind = ctx.bind(() => menu(i), `${KIND_NAME[b.kind]} ${i + 1}`)
            return editing && !editing.insert && editing.at === i ? (
              <div key={'e' + i}>{editor}</div>
            ) : (
              <div key={i}>
                <div
                  className="blk"
                  tabIndex={0}
                  role="group"
                  aria-label={`${KIND_NAME[b.kind]} ${i + 1} of ${blocks.length}. Enter to edit, Shift+F10 for more`}
                  {...bind}
                  onKeyDown={(e) => {
                    bind.onKeyDown(e)
                    if (!e.defaultPrevented && e.key === 'Enter' && e.target === e.currentTarget) (e.preventDefault(), start(i))
                  }}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('a, button, input, textarea, select, summary, iframe, [role="button"]')) return
                    start(i)
                  }}
                >
                  <Markdown md={b.src} base={doc.path} />
                </div>
                {editing?.insert && editing.at === i && <div style={{ marginTop: 'var(--s2)' }}>{editor}</div>}
              </div>
            )
          })}
          {editing?.insert && editing.at === -1 ? (
            editor
          ) : (
            <button className="btn sm ghost" type="button" style={{ justifySelf: 'start' }} onClick={() => start(-1, true)}>
              <Icon name="plus" size="s" />
              Add a block at the end
            </button>
          )}
        </div>
      )}
      {ctx.menu}
    </div>
  )
}
