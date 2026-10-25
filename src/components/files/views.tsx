// The file viewer's data views: the Visual sections of a JSON file (lib/data-shape), records as a list, a gallery or a
// table with their charts, the sortable Table view and the Raw view. Text only: nothing from a file becomes HTML.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { Chart, parseChart } from '../charts'
import { Widget } from '../ui'
import type { Source } from '../../lib/source'
import { extOf, readMedia, readSvg, type FileInfo } from '../../lib/files'
import { resolvePath } from '../../lib/md'
import { groupSpec, jsonTokens, numOf, textOf, timeSpec, topSpec, type Col, type Records, type Section } from '../../lib/data-shape'

const SMALL = new Set(['note', 'props', 'chips', 'numbers'])

/** One cell as a person reads it: numbers grouped, YouTube ids and web links as links, long text cut with a tooltip. */
export function Cell({ col, value }: { col: Col; value: unknown }) {
  if (value === undefined || value === null || value === '') return <span className="muted">–</span>
  if (col.type === 'number') {
    const n = numOf(value)
    return <>{n === null ? textOf(value, 60) : n.toLocaleString('en', { maximumFractionDigits: 4 })}</>
  }
  const s = textOf(value, 2000)
  if (col.type === 'date') {
    const d = new Date(s)
    if (!Number.isNaN(+d)) {
      const timed = /T\d|\s\d{2}:/.test(s)
      return (
        <time dateTime={s} title={s}>
          {timed ? d.toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
        </time>
      )
    }
  }
  if (col.type === 'yt' && /^[A-Za-z0-9_-]{11}$/.test(s))
    return (
      <a href={`https://www.youtube.com/watch?v=${s}`} target="_blank" rel="noopener noreferrer" title="Open on YouTube">
        {s}
      </a>
    )
  if (col.type === 'url' && /^https?:\/\//i.test(s))
    return (
      <a href={s} target="_blank" rel="noopener noreferrer" title={s}>
        {s.replace(/^https?:\/\/(www\.)?/i, '').slice(0, 48)}
      </a>
    )
  return s.length > 140 ? <span title={s}>{s.slice(0, 139)}…</span> : <>{s}</>
}

type Sort = { key: string; dir: 1 | -1 } | null

/** Every row: filter box, click a heading to sort (numbers by value, dates in order), 300 rows at a time. */
export function RecordsTable({ recs, caption, limit = 300, preview = false }: { recs: Records; caption: string; limit?: number; preview?: boolean }) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>(null)
  const [shown, setShown] = useState(limit)
  const cols = recs.cols.filter((c) => c.type !== 'empty')
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let out = needle ? recs.rows.filter((r) => cols.some((c) => textOf(r[c.key], 500).toLowerCase().includes(needle))) : recs.rows
    if (sort) {
      const col = cols.find((c) => c.key === sort.key)
      const num = col?.type === 'number'
      out = [...out].sort((a, b) => {
        const x = a[sort.key]
        const y = b[sort.key]
        if (num) return ((numOf(x) ?? -Infinity) - (numOf(y) ?? -Infinity)) * sort.dir
        return textOf(x, 200).localeCompare(textOf(y, 200), 'en', { numeric: true }) * sort.dir
      })
    }
    return out
  }, [recs, q, sort, cols])
  const flip = (key: string) => setSort((s) => (s?.key !== key ? { key, dir: cols.find((c) => c.key === key)?.type === 'number' ? -1 : 1 } : s.dir === -1 ? { key, dir: 1 } : null))
  return (
    <div className="fv-table">
      {recs.rows.length > 8 && !preview && (
        <input className="inp sm" type="search" placeholder={`Filter ${recs.rows.length.toLocaleString('en')} rows`} aria-label={`Filter ${caption}`} value={q} onChange={(e) => (setQ(e.target.value), setShown(limit))} />
      )}
      <div className="vt-wrap">
        <table className="vtable">
          <caption className="sr">{caption}</caption>
          <thead>
            <tr>
              {cols.map((c) => {
                const on = sort?.key === c.key
                const Arrow = !on ? ArrowUpDown : sort.dir === 1 ? ArrowUp : ArrowDown
                return (
                  <th key={c.key} scope="col" aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={c.type === 'number' ? 'num' : undefined}>
                    <button type="button" onClick={() => flip(c.key)} title={`Sort by ${c.label}`}>
                      {c.label}
                      <Arrow className="i s" aria-hidden />
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c.key} className={c.type === 'number' ? 'num' : undefined}>
                    <Cell col={c} value={r[c.key]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!preview && <p className="sm muted fv-foot">
        {rows.length === recs.rows.length ? `${rows.length.toLocaleString('en')} rows` : `${rows.length.toLocaleString('en')} of ${recs.rows.length.toLocaleString('en')} rows match`}
        {rows.length > shown && (
          <button className="btn sm ghost" type="button" onClick={() => setShown((n) => n + limit)}>
            Show {Math.min(limit, rows.length - shown)} more
          </button>
        )}
      </p>}
    </div>
  )
}

/** The charts a records set earns: over time, by group, and (for an amount) its top rows. ≤2, side by side. */
export function RecordCharts({ recs, top = false, noun }: { recs: Records; top?: boolean; noun?: string }) {
  const specs = [timeSpec(recs, noun), groupSpec(recs, noun), top || recs.measure ? topSpec(recs) : null]
    .map((s) => (s ? parseChart(s) : null))
    .filter((s): s is NonNullable<ReturnType<typeof parseChart>> => !!s)
    .slice(0, 2)
  if (!specs.length) return null
  return (
    <div className={'fv-charts' + (specs.length > 1 ? ' two' : '')}>
      {specs.map((s, i) => (
        <Chart key={i} spec={s} />
      ))}
    </div>
  )
}

/** Records named by a title column: a calm list-grid (title, a line, up to 3 short facts). ≤24, then "Show all". */
function RecordList({ recs }: { recs: Records }) {
  const [all, setAll] = useState(false)
  const facts = recs.cols.filter((c) => c.key !== recs.title && c.key !== recs.sub && !c.key.endsWith('.ar') && ['text', 'number', 'date', 'bool'].includes(c.type)).slice(0, 3)
  const list = all ? recs.rows : recs.rows.slice(0, 24)
  return (
    <>
      <ul className="fv-grid" role="list">
        {list.map((r, i) => {
          const sub = recs.sub ? textOf(r[recs.sub], 220) : ''
          const meta = facts.map((c) => [c.label, textOf(r[c.key], 32)] as const).filter(([, v]) => v)
          return (
            <li key={i} className="fv-it">
              <b>{textOf(r[recs.title!], 90) || `Row ${i + 1}`}</b>
              {sub && <p>{sub}</p>}
              {meta.length > 0 && <span className="fv-meta">{meta.map(([k, v]) => `${k} ${v}`).join(' · ')}</span>}
            </li>
          )
        })}
      </ul>
      {recs.rows.length > 24 && !all && (
        <button className="btn sm ghost" type="button" onClick={() => setAll(true)}>
          Show all {recs.rows.length}
        </button>
      )}
    </>
  )
}

/** Image rows: thumbnails read through the Source when they scroll near, named by the title column. */
function Gallery({ recs, base, source, files }: { recs: Records; base: string; source: Source; files: Set<string> }) {
  const list = recs.rows.slice(0, 120)
  return (
    <ul className="fv-gal" role="list">
      {list.map((r, i) => {
        const raw = textOf(r[recs.image!], 400)
        const p = [resolvePath(base, raw), resolvePath('', raw.replace(/^\/+/, ''))].find((x) => files.has(x)) || ''
        return (
          <li key={i}>
            <Thumb path={p} source={source} alt={recs.title ? textOf(r[recs.title], 90) : raw} />
            {recs.title && <span className="sm">{textOf(r[recs.title], 60)}</span>}
          </li>
        )
      })}
    </ul>
  )
}

/** One lazily read image (blob: typed from its extension; SVG through its text, inside the <img> only). */
export function Thumb({ path, source, alt }: { path: string; source: Source; alt: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(!path)
  useEffect(() => {
    const el = ref.current
    if (!el || !path) return
    let alive = true
    let made: string | null = null
    const load = () =>
      void (extOf(path) === 'svg' ? readSvg(source, path) : readMedia(source, path)).then(
        (b) => {
          if (!alive) return
          if (!b) return setFailed(true)
          made = URL.createObjectURL(b)
          setUrl(made)
        },
        () => alive && setFailed(true),
      )
    const io = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (io?.disconnect(), load()), { rootMargin: '400px 0px' })
    if (io) io.observe(el)
    else load()
    return () => {
      alive = false
      io?.disconnect()
      if (made) URL.revokeObjectURL(made)
    }
  }, [path, source])
  return (
    <span ref={ref} className="fv-thumb" title={path || alt}>
      {url ? <img src={url} alt={alt} loading="lazy" decoding="async" /> : failed ? <span className="sm muted">No preview</span> : <span className="sk" aria-hidden />}
    </span>
  )
}

/** A records section: its charts, then a gallery (image column), a list (named rows, ≤80) or the first rows of the
 *  table with a way into the full Table view. */
function RecordsBlock({ id, s, base, source, files, onTable }: { id: string; s: Extract<Section, { kind: 'records' }>; base: string; source: Source; files: Set<string>; onTable: () => void }) {
  const r = s.recs
  const n = r.rows.length
  const view = r.image ? 'gallery' : r.title && n <= 80 ? 'list' : 'table'
  return (
    <Widget id={id} title={s.label} icon={view === 'gallery' ? 'grid' : view === 'list' ? 'list' : 'table'} count={n}>
      <RecordCharts recs={r} noun={s.label.split(' › ').pop()} />
      {view === 'gallery' && <Gallery recs={r} base={base} source={source} files={files} />}
      {view === 'list' && <RecordList recs={r} />}
      {view === 'table' && (
        <>
          <RecordsTable recs={{ ...r, rows: r.rows.slice(0, 8) }} caption={s.label} limit={8} preview />
          {n > 8 && (
            <button className="btn sm" type="button" onClick={onTable}>
              See all {n.toLocaleString('en')} rows in Table
            </button>
          )}
        </>
      )}
    </Widget>
  )
}

/** The short parts (an about text, settings, chips, a list of numbers), drawn together in one card, in file order. */
function SmallBlock({ id, parts }: { id: string; parts: Section[] }) {
  const about = parts[0].kind === 'note' && parts[0].label === 'About'
  const title = parts.length === 1 ? (about ? 'About this file' : parts[0].label) : about ? 'About this file' : 'Details'
  return (
    <Widget id={id} title={title} icon="info">
      {parts.map((p, i) => (
        <Fragment key={i}>
          {parts.length > 1 && !(i === 0 && about) && <h3 className="fv-h">{p.label}</h3>}
          {p.kind === 'note' && <p className="fv-note">{p.text}</p>}
          {p.kind === 'props' && (
            <dl className="props">
              {p.items.map((it, j) => (
                <Fragment key={j}>
                  <dt>{it.label}</dt>
                  <dd>{it.value}</dd>
                </Fragment>
              ))}
            </dl>
          )}
          {p.kind === 'chips' && (
            <p className="fv-chips">
              {p.items.slice(0, 80).map((c, j) => (
                <span key={j} className="chip">
                  {c}
                </span>
              ))}
              {p.items.length > 80 && <span className="sm muted">+{p.items.length - 80} more</span>}
            </p>
          )}
          {p.kind === 'numbers' && <Numbers values={p.values} label={p.label} />}
        </Fragment>
      ))}
    </Widget>
  )
}

function Numbers({ values, label }: { values: number[]; label: string }) {
  const fin = values.filter(Number.isFinite)
  if (fin.length >= 2 && fin.length <= 60) {
    const spec = parseChart({ type: 'bar', title: label, labels: fin.map((_, i) => String(i + 1)), series: [{ name: label, data: fin }] })
    if (spec) return <Chart spec={spec} />
  }
  const sum = fin.reduce((a, b) => a + b, 0)
  return (
    <p className="sm">
      {fin.length.toLocaleString('en')} numbers{fin.length ? ` · lowest ${Math.min(...fin).toLocaleString('en')} · highest ${Math.max(...fin).toLocaleString('en')} · average ${(sum / fin.length).toLocaleString('en', { maximumFractionDigits: 3 })}` : ''}
    </p>
  )
}

/** The Visual view of a JSON file: small parts grouped into cards, records and trees in their own, in file order. */
export function JsonVisual({ sections, base, source, files, onTable }: { sections: Section[]; base: string; source: Source; files: Set<string>; onTable: () => void }) {
  const out: ReactNode[] = []
  let small: Section[] = []
  const flush = () => {
    if (small.length) out.push(<SmallBlock key={out.length} id={'fv-' + out.length} parts={small} />)
    small = []
  }
  for (const s of sections) {
    if (SMALL.has(s.kind)) {
      small.push(s)
      continue
    }
    flush()
    if (s.kind === 'records') out.push(<RecordsBlock key={out.length} id={'fv-' + out.length} s={s} base={base} source={source} files={files} onTable={onTable} />)
    else if (s.kind === 'tree')
      out.push(
        <Widget key={out.length} id={'fv-' + out.length} title={s.label} icon="layers">
          <details className="fv-tree">
            <summary className="sm">Show the raw part</summary>
            <div className="md">
              <pre>
                <code>{JSON.stringify(s.value, null, 2)?.slice(0, 20_000)}</code>
              </pre>
            </div>
          </details>
        </Widget>,
      )
  }
  flush()
  return <div className="fv-stack">{out}</div>
}

/** The exact text: JSON pretty-printed with key / value colours (≤400 KB), anything else as it is (≤1 MB shown). */
export function RawText({ text, json }: { text: string; json?: unknown }) {
  const pretty = useMemo(() => {
    if (json === undefined) return null
    try {
      const p = JSON.stringify(json, null, 2)
      return p.length <= 400_000 ? p : null
    } catch {
      return null
    }
  }, [json])
  const shown = pretty ?? text.slice(0, 1_000_000)
  const toks = useMemo(() => (pretty ? jsonTokens(pretty) : null), [pretty])
  const [copied, setCopied] = useState(false)
  const copy = () =>
    void navigator.clipboard?.writeText(text).then(
      () => (setCopied(true), setTimeout(() => setCopied(false), 1600)),
      () => {},
    )
  return (
    <div className="fv-raw">
      <p className="fv-foot sm muted">
        {(text.length / 1000).toLocaleString('en', { maximumFractionDigits: 1 })} KB of text{pretty ? ' · formatted' : ''}
        {text.length > shown.length && !pretty ? ' · first 1 MB shown' : ''}
        <button className="btn sm ghost" type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy all'}
        </button>
      </p>
      <div className="md">
        <pre className="fv-code" tabIndex={0}>
          <code>{toks ? toks.map((t, i) => (t.t === 'pun' ? t.s : <span key={i} className={'tk-' + t.t}>{t.s}</span>)) : shown}</code>
        </pre>
      </div>
    </div>
  )
}

/** Paths of every file, for "is it in the repo?" checks. */
export const pathSet = (files: FileInfo[] | null) => new Set((files || []).map((f) => f.path))
