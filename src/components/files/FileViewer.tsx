// File viewer (spec: HQ as a portfolio, phase 2): #/docs/<path> for every file that is not a note. JSON, TSV / CSV,
// images, SVG, video, audio, web pages and code, each drawn from the file itself:
//   Visual = the picture the data makes · Table = every row (sort, filter) · Raw = the exact text.
// A lazy chunk the Docs page loads for non-.md paths. Reads go through the active Source; nothing from a file becomes
// HTML in this page (web pages run in a sandboxed frame). An old path follows STRUCTURE.md's `moved:` list.
import { useEffect, useMemo, useState } from 'react'
import { Braces, FileAudio, FileCode, FileImage, FileQuestion, FileVideo, Globe, Sheet, type LucideIcon } from 'lucide-react'
import { useHQ } from '../../lib/hq-context'
import { Icon } from '../../lib/icons'
import { PageHeader } from '../shell/PageHeader'
import { Callout, Empty, Segmented } from '../ui'
import { KIND_LABEL, TEXT_MAX, baseName, extOf, folderOf, humanSize, kindOf, listFiles, type FileInfo, type FileKind } from '../../lib/files'
import { delimitedRecords, jsonSections, jsonTable, parseDelimited, recordStats } from '../../lib/data-shape'
import { movedTo } from '../../lib/moved'
import { JsonVisual, RawText, RecordCharts, RecordsTable, pathSet } from './views'
import { MediaView, PageFrame } from './media'

type Mode = 'visual' | 'table' | 'raw'
const MODES: Record<FileKind, Mode[]> = {
  json: ['visual', 'table', 'raw'], table: ['visual', 'table', 'raw'], html: ['visual', 'raw'], svg: ['visual', 'raw'],
  image: ['visual'], video: ['visual'], audio: ['visual'], text: ['raw'], md: ['raw'], other: [],
}
const MODE_LABEL: Record<Mode, string> = { visual: 'Visual', table: 'Table', raw: 'Raw' }
const KIND_ICON: Record<FileKind, LucideIcon> = {
  json: Braces, table: Sheet, image: FileImage, svg: FileImage, video: FileVideo, audio: FileAudio, html: Globe, text: FileCode, md: FileCode, other: FileQuestion,
}
const TEXT_KINDS = new Set<FileKind>(['json', 'table', 'html', 'svg', 'text', 'md'])
const MODE_KEY = 'hq.fileMode'

const modeFor = (kind: FileKind): Mode => {
  const all = MODES[kind]
  try {
    const want = localStorage.getItem(MODE_KEY + '.' + kind) as Mode | null
    if (want && all.includes(want)) return want
  } catch {
    /* storage blocked: the first mode */
  }
  return all[0] || 'raw'
}

export default function FileViewer({ path: asked }: { path: string }) {
  const { source, model } = useHQ()
  const [files, setFiles] = useState<FileInfo[] | null>(null)
  const [listErr, setListErr] = useState('')
  useEffect(() => {
    let alive = true
    listFiles(source).then(
      (l) => alive && setFiles(l),
      (e) => alive && (setFiles([]), setListErr(String(e?.message || e))),
    )
    return () => {
      alive = false
    }
  }, [source])

  // an old link (chat history, logs) to a file that moved: STRUCTURE.md's moved: list
  const path = useMemo(() => {
    if (!files || files.some((f) => f.path === asked)) return asked
    const to = movedTo(model.byPath.get('STRUCTURE.md')?.data.moved, asked)
    return to && files.some((f) => f.path === to) ? to : asked
  }, [files, asked, model])
  const info = files?.find((f) => f.path === path)
  const kind = kindOf(path)
  const [mode, setMode] = useState<Mode>(() => modeFor(kind))
  useEffect(() => setMode(modeFor(kind)), [kind, path])
  const pick = (m: Mode) => {
    setMode(m)
    try {
      localStorage.setItem(MODE_KEY + '.' + kind, m)
    } catch {
      /* a per-browser convenience only */
    }
  }

  // text files: read once (≤ TEXT_MAX); undefined = loading, null = missing
  const big = !!info && TEXT_KINDS.has(kind) && kind !== 'svg' && info.size > TEXT_MAX
  const [text, setText] = useState<string | null | undefined>(undefined)
  const [readErr, setReadErr] = useState('')
  useEffect(() => {
    if (!TEXT_KINDS.has(kind) || big || (kind === 'svg' && mode !== 'raw')) return
    let alive = true
    setText(undefined)
    setReadErr('')
    source.read(path).then(
      (t) => alive && setText(t),
      (e) => alive && (setText(null), setReadErr(String(e?.message || e))),
    )
    return () => {
      alive = false
    }
  }, [source, path, kind, big, mode])

  const parsed = useMemo(() => {
    if (kind !== 'json' || typeof text !== 'string') return { ok: false as const }
    try {
      return { ok: true as const, value: JSON.parse(text.replace(/^﻿/, '')) }
    } catch (e) {
      return { ok: false as const, error: String((e as Error).message || e) }
    }
  }, [kind, text])
  const sections = useMemo(() => (parsed.ok ? jsonSections(parsed.value) : null), [parsed])
  // a table without a header row can be named by the nearest README above it (frontmatter `columns: [Views, …]`)
  const columns = useMemo(() => {
    const parts = folderOf(path).split('/').filter(Boolean)
    for (let n = parts.length; n > 0 && n >= parts.length - 3; n--) {
      const c = model.byPath.get(`${parts.slice(0, n).join('/')}/README.md`)?.data.columns
      if (Array.isArray(c)) return c
    }
    return undefined
  }, [model, path])
  const table = useMemo(() => {
    if (kind === 'table' && typeof text === 'string') {
      const names = Array.isArray(columns) ? columns.map((c) => String(c ?? '')) : []
      return { label: baseName(path), recs: delimitedRecords(parseDelimited(text, extOf(path)), extOf(path), names) }
    }
    if (parsed.ok) return jsonTable(parsed.value, sections || undefined)
    return null
  }, [kind, text, path, parsed, sections, columns])

  const webUrl = source.webUrl(path)
  const slug = path.match(/^projects\/([^/]+)\//)?.[1]
  const project = slug ? model.byPath.get(`projects/${slug}/project.md`) : undefined
  const KindIcon = KIND_ICON[kind]
  const modes = MODES[kind]
  const tiles = table && mode !== 'raw' ? recordStats(table.recs).slice(0, 3).map((s) => ({ value: s.value, label: s.label })) : undefined
  const missing = files !== null && !info && (text === null || !TEXT_KINDS.has(kind))
  const crumbs = folderOf(path).split('/').filter(Boolean)

  if (missing)
    return (
      <div className="work-page fv-page-w">
        <PageHeader icon="file" title="File not found" />
        <Empty icon="file" text={`There's no file at ${asked}.`}>
          <a className="btn" href="#/docs">
            All pages
          </a>
        </Empty>
      </div>
    )

  return (
    <div className="work-page fv-page-w">
      <PageHeader
        glyph={
          <span className="ph-ico">
            <KindIcon className="i" aria-hidden />
          </span>
        }
        title={baseName(path)}
        sub={
          <>
            {KIND_LABEL[kind]}
            {info && ` · ${humanSize(info.size)}`}
            {' · '}
            <span className="fv-crumbs">
              {project && slug ? (
                <a href={`#/projects/${slug}`}>{String(project.data.title || slug)}</a>
              ) : (
                <span>{crumbs[0] || 'Pinwheel'}</span>
              )}
              {crumbs.slice(slug ? 2 : 1).map((c, i) => (
                <span key={i}> / {c}</span>
              ))}
            </span>
          </>
        }
        tiles={tiles}
      />
      <div className="fv-bar">
        {modes.length > 1 && <Segmented label="View" value={mode} onChange={pick} options={modes.map((m) => [m, MODE_LABEL[m]] as [Mode, string])} />}
        <span className="fv-acts">
          {webUrl && (
            <a className="btn sm ghost" href={webUrl} target="_blank" rel="noopener noreferrer">
              <Icon name="ext" size="s" />
              Open on GitHub
            </a>
          )}
        </span>
      </div>
      {listErr && <Callout icon="alert">{listErr}</Callout>}
      <Body
        kind={kind}
        mode={mode}
        path={path}
        text={text}
        readErr={readErr}
        big={big}
        info={info}
        files={files}
        parsed={parsed}
        sections={sections}
        table={table}
        webUrl={webUrl}
        onTable={() => pick('table')}
      />
    </div>
  )
}

function Body(p: {
  kind: FileKind
  mode: Mode
  path: string
  text: string | null | undefined
  readErr: string
  big: boolean
  info?: FileInfo
  files: FileInfo[] | null
  parsed: { ok: true; value: unknown } | { ok: false; error?: string }
  sections: ReturnType<typeof jsonSections> | null
  table: ReturnType<typeof jsonTable> | null
  webUrl: string | null
  onTable: () => void
}) {
  const { source } = useHQ()
  const files = useMemo(() => pathSet(p.files), [p.files])
  const gh = p.webUrl && (
    <a href={p.webUrl} target="_blank" rel="noopener noreferrer">
      Open it on GitHub
    </a>
  )
  if (p.kind === 'other')
    return (
      <Empty icon="file" text={`Pinwheel can't draw .${extOf(p.path) || 'this kind of'} files yet.`}>
        {gh}
      </Empty>
    )
  if (['image', 'video', 'audio'].includes(p.kind) || (p.kind === 'svg' && p.mode === 'visual'))
    return <MediaView source={source} path={p.path} kind={p.kind} info={p.info} webUrl={p.webUrl} />
  if (p.big)
    return (
      <Callout icon="info">
        {humanSize(p.info!.size)} is too big to read here (up to {humanSize(TEXT_MAX)}). {gh}
      </Callout>
    )
  if (p.text === undefined || (p.kind === 'html' && p.mode === 'visual' && p.files === null))
    return (
      <div className="fv-stack" aria-busy="true">
        <span className="sk" style={{ width: '40%', height: 18 }} />
        <span className="sk" style={{ width: '100%', height: 160 }} />
      </div>
    )
  if (p.text === null) return <Callout icon="alert">{p.readErr || 'This file could not be read.'}</Callout>
  if (p.mode === 'raw') return <RawText text={p.text} json={p.parsed.ok ? p.parsed.value : undefined} />
  if (p.kind === 'json' && !p.parsed.ok)
    return (
      <>
        <Callout icon="alert">This JSON has an error, so only the Raw view works: {p.parsed.error}</Callout>
        <RawText text={p.text} />
      </>
    )
  if (p.kind === 'html') return <PageFrame source={source} path={p.path} html={p.text} files={p.files || []} />
  if (p.mode === 'table' && p.table) return <RecordsTable recs={p.table.recs} caption={p.table.label} />
  if (p.kind === 'json' && p.sections) return <JsonVisual sections={p.sections} base={p.path} source={source} files={files} onTable={p.onTable} />
  if (p.kind === 'table' && p.table) {
    const r = p.table.recs
    if (!r.rows.length) return <Empty icon="table" text="This table has no rows." />
    return (
      <div className="fv-stack">
        <RecordCharts recs={r} top />
        <RecordsTable recs={{ ...r, rows: r.rows.slice(0, 12) }} caption={p.table.label} limit={12} preview />
        {r.rows.length > 12 && (
          <button className="btn sm" type="button" onClick={p.onTable}>
            See all {r.rows.length.toLocaleString('en')} rows in Table
          </button>
        )}
      </div>
    )
  }
  return <RawText text={p.text} />
}
