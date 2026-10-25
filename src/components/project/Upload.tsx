// Upload into a project (phase 3): files dropped on the Files card or picked with Upload. Each one gets a checked place
// (STRUCTURE.md: notes and pages in the folder, data in data/, pictures and media in media/; the path can be changed),
// a quick preview, then one commit each: text through the write policy, media as bytes. Never overwrites a file.
// Undo removes the whole batch.
import { useEffect, useMemo, useState } from 'react'
import { useHQ } from '../../lib/hq-context'
import { Icon } from '../../lib/icons'
import { humanSize, kindOf, KIND_LABEL } from '../../lib/files'
import { safeFileName, uploadMax, uploadPath } from '../../lib/fm-edit'
import { createBytes, createText, removeFile, saveKind } from '../../lib/edit-io'
import { delimitedRecords, jsonSections, parseDelimited } from '../../lib/data-shape'
import { toast } from '../toast'

type Item = { file: File; rel: string; state: 'ready' | 'saving' | 'saved' | 'error'; error?: string; text?: string }
const extOf = (n: string) => /\.([a-z0-9]+)$/i.exec(n)?.[1].toLowerCase() || ''

/** The path under the project folder an upload goes to by default ("media/cover.jpg"), or '' when HQ does not take it. */
const defaultRel = (slug: string, name: string) => (uploadPath(slug, name) || '').replace(`projects/${slug}/`, '')

export function UploadPanel({ slug, files, existing, onClose, onDone }: { slug: string; files: File[]; existing: Set<string>; onClose: () => void; onDone: () => void }) {
  const { source, reload } = useHQ()
  const [items, setItems] = useState<Item[]>(() => files.map((file) => ({ file, rel: defaultRel(slug, file.name), state: 'ready' })))
  useEffect(() => setItems((cur) => [...cur, ...files.filter((f) => !cur.some((c) => c.file === f)).map((file) => ({ file, rel: defaultRel(slug, file.name), state: 'ready' as const }))]), [files, slug])
  const [busy, setBusy] = useState(false)

  // what is wrong with an item, in plain words ('' = good to go)
  const problem = (it: Item, all: Item[]): string => {
    const dir = it.rel.includes('/') ? it.rel.slice(0, it.rel.lastIndexOf('/')) : ''
    const path = uploadPath(slug, it.rel.split('/').pop() || '', dir)
    if (!path) return `HQ doesn't take .${extOf(it.file.name) || '?'} files here`
    if (it.file.size > uploadMax(extOf(path))) return `Too big: ${humanSize(it.file.size)} (up to ${humanSize(uploadMax(extOf(path)))})`
    if (existing.has(path)) return 'A file with this name is already there: change the name'
    if (all.filter((x) => x !== it && x.rel === it.rel).length) return 'Two files would get the same name'
    return ''
  }
  const fullPath = (it: Item) => {
    const dir = it.rel.includes('/') ? it.rel.slice(0, it.rel.lastIndexOf('/')) : ''
    return uploadPath(slug, it.rel.split('/').pop() || '', dir) || ''
  }
  const ready = items.filter((it) => it.state === 'ready' && !problem(it, items))
  const run = async () => {
    setBusy(true)
    const saved: { path: string; text?: string; blob?: Blob }[] = []
    for (const it of ready) {
      const path = fullPath(it)
      const n = path.split('/').pop()
      setItems((cur) => cur.map((x) => (x === it ? { ...x, state: 'saving' } : x)))
      try {
        if (saveKind(path) === 'text') {
          const text = await it.file.text()
          await createText(source, path, text, `files: upload ${n}`)
          saved.push({ path, text })
        } else {
          await createBytes(source, path, it.file, `files: upload ${n}`)
          saved.push({ path, blob: it.file })
        }
        setItems((cur) => cur.map((x) => (x.file === it.file ? { ...x, state: 'saved' } : x)))
      } catch (e: any) {
        setItems((cur) => cur.map((x) => (x.file === it.file ? { ...x, state: 'error', error: String(e?.message || e) } : x)))
      }
    }
    setBusy(false)
    if (!saved.length) return
    await reload().catch(() => {})
    onDone()
    toast(`Uploaded ${saved.length} file${saved.length === 1 ? '' : 's'}`, 'ok', {
      undo: () =>
        void (async () => {
          for (const s of saved) await removeFile(source, s.path, `files: undo upload ${s.path.split('/').pop()}`, s.text).catch((e) => toast(String(e?.message || e), 'error'))
          await reload().catch(() => {})
          onDone()
        })(),
    })
  }
  const allDone = items.length > 0 && items.every((it) => it.state === 'saved')

  return (
    <div className="fv-stack" role="region" aria-label="Upload files">
      <ul className="rows" role="list">
        {items.map((it) => (
          <UploadRow
            key={`${it.file.name}:${it.file.size}:${it.file.lastModified}`}
            it={it}
            slug={slug}
            why={it.state === 'ready' ? problem(it, items) : ''}
            busy={busy}
            href={'#/docs/' + fullPath(it)}
            onRel={(rel) => setItems((cur) => cur.map((x) => (x === it ? { ...x, rel } : x)))}
            onDrop={() => setItems((cur) => cur.filter((x) => x !== it))}
          />
        ))}
      </ul>
      <div className="fv-foot">
        {!allDone && (
          <button className="btn sm primary" type="button" disabled={!ready.length || busy} onClick={() => void run()}>
            <Icon name="send" size="s" />
            {busy ? 'Uploading…' : `Upload ${ready.length || ''} file${ready.length === 1 ? '' : 's'}`}
          </button>
        )}
        <button className="btn sm ghost" type="button" disabled={busy} onClick={onClose}>
          {allDone ? 'Done' : 'Cancel'}
        </button>
        <span className="sm muted">Each file is one commit. Nothing is overwritten.</span>
      </div>
    </div>
  )
}

/** A quick look before saving: images as a thumbnail, notes as their first lines, data as what HQ will draw. */
function useLook(file: File) {
  const kind = kindOf(file.name)
  const [url, setUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    if (kind === 'image' || kind === 'svg') {
      const u = URL.createObjectURL(file.slice(0, file.size, kind === 'svg' ? 'image/svg+xml' : file.type || 'image/png'))
      setUrl(u)
      return () => URL.revokeObjectURL(u)
    }
    if (['md', 'json', 'table', 'text', 'html'].includes(kind) && file.size <= 2_000_000) void file.text().then(setText, () => setText(null))
  }, [file, kind])
  const line = useMemo(() => {
    if (text === null) return ''
    try {
      if (kind === 'json') {
        const s = jsonSections(JSON.parse(text))
        const recs = s.filter((x) => x.kind === 'records').reduce((a, x) => a + (x.kind === 'records' ? x.recs.rows.length : 0), 0)
        return `${s.length} part${s.length === 1 ? '' : 's'}${recs ? ` · ${recs} rows` : ''}: HQ draws it as cards, charts and tables`
      }
      if (kind === 'table') {
        const r = delimitedRecords(parseDelimited(text, extOf(file.name)), extOf(file.name))
        return `${r.rows.length} rows · ${r.cols.map((c) => c.label).slice(0, 4).join(', ')}`
      }
    } catch {
      return 'This file has an error: HQ will show it as text'
    }
    return text.replace(/^---[\s\S]*?\n---\s*/, '').replace(/\s+/g, ' ').slice(0, 140)
  }, [text, kind, file.name])
  return { kind, url, line }
}

const BOX = { width: 56, height: 56, borderRadius: 8, background: 'var(--pane-2)', flex: 'none', display: 'grid', placeItems: 'center', overflow: 'hidden' } as const

function Thumb({ look }: { look: ReturnType<typeof useLook> }) {
  if (look.url) return <img src={look.url} alt="" style={{ ...BOX, objectFit: 'cover' }} />
  const k = look.kind
  return (
    <span style={BOX} aria-hidden="true">
      <Icon name={k === 'json' ? 'db' : k === 'table' ? 'table' : k === 'video' || k === 'audio' ? 'play' : k === 'html' ? 'globe' : 'file'} />
    </span>
  )
}

/** One file in the upload list: its look, where it goes (editable), and what is wrong with it, if anything. */
function UploadRow({ it, slug, why, busy, href, onRel, onDrop }: { it: Item; slug: string; why: string; busy: boolean; href: string; onRel: (rel: string) => void; onDrop: () => void }) {
  const look = useLook(it.file)
  return (
    <li className="row pg-row2" style={{ alignItems: 'flex-start' }}>
      <Thumb look={look} />
      <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 4 }}>
        <span className="t sm">
          <b>{it.file.name}</b> · {KIND_LABEL[look.kind]} · {humanSize(it.file.size)}
        </span>
        {look.line && <span className="sm muted">{look.line}</span>}
        <label className="sm muted" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          projects/{slug}/
          <input
            className="inp sm"
            style={{ flex: 1, minWidth: 160 }}
            value={it.rel}
            disabled={it.state !== 'ready' || busy}
            aria-label={`Where ${it.file.name} goes`}
            onChange={(e) => onRel(e.target.value)}
            onBlur={(e) => {
              // keep the folder, clean the name
              const v = e.target.value
              const dir = v.includes('/') ? v.slice(0, v.lastIndexOf('/') + 1) : ''
              onRel(dir + safeFileName(v.split('/').pop() || it.file.name))
            }}
          />
        </label>
        {why && (
          <span className="sm" style={{ color: 'var(--warn-ink)' }}>
            <Icon name="alert" size="s" /> {why}
          </span>
        )}
        {it.state === 'saving' && <span className="sm muted">Saving…</span>}
        {it.state === 'saved' && (
          <a className="sm" href={href}>
            <Icon name="ok" size="s" /> Saved: open it
          </a>
        )}
        {it.state === 'error' && <span className="sm" style={{ color: 'var(--bad-ink)' }}>{it.error}</span>}
      </div>
      {it.state === 'ready' && (
        <button className="icon-btn" type="button" aria-label={`Leave out ${it.file.name}`} disabled={busy} onClick={onDrop}>
          <Icon name="x" />
        </button>
      )}
    </li>
  )
}
