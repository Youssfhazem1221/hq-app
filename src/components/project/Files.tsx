// The project page's Files card: every file in the project's folder that is not a note (data, tables, images, media,
// web pages, code), grouped by top folder like the Pages card, each opening in the file viewer (#/docs/<path>).
// The list is read when the card shows (lib/files: the dev server's /__hq/tree, or one GitHub tree call, then 304s).
// The owner can drop files on the card (or pick them with Upload) and right-click a row to remove it (phase 3).
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useHQ } from '../../lib/hq-context'
import { Icon } from '../../lib/icons'
import type { IconName } from '../../lib/contracts'
import { KIND_LABEL, humanSize, kindOf, listFiles, type FileInfo, type FileKind } from '../../lib/files'
import { humanize } from '../../lib/data-shape'
import { Widget } from '../ui'
import { useFileMenu } from '../edit/file-menu'
import { UploadPanel } from './Upload'

const ICON: Record<FileKind, IconName> = { json: 'db', table: 'table', image: 'grid', svg: 'grid', video: 'play', audio: 'play', html: 'globe', text: 'file', md: 'file', other: 'file' }
const ROWS = 8
const SUMMARY: [FileKind[], string][] = [[['json'], 'data'], [['table'], 'tables'], [['image', 'svg'], 'images'], [['video', 'audio'], 'media'], [['html'], 'web pages'], [['text', 'other'], 'other']]

export function ProjectFiles({ slug, owner = false }: { slug: string; owner?: boolean }) {
  const { source } = useHQ()
  const [all, setAll] = useState<FileInfo[] | null>(null)
  const [n, setN] = useState(0)
  const refresh = () => setN((x) => x + 1)
  useEffect(() => {
    let alive = true
    listFiles(source).then(
      (l) => alive && setAll(l),
      () => alive && setAll([]),
    )
    return () => {
      alive = false
    }
  }, [source, slug, n])
  const base = `projects/${slug}/`
  const files = useMemo(() => (all || []).filter((f) => f.path.startsWith(base) && kindOf(f.path) !== 'md'), [all, base])
  const existing = useMemo(() => new Set((all || []).map((f) => f.path)), [all])
  const groups = useMemo(() => {
    const by = new Map<string, FileInfo[]>()
    for (const f of files) {
      const rel = f.path.slice(base.length)
      const top = rel.includes('/') ? rel.split('/')[0] : ''
      by.set(top, [...(by.get(top) || []), f])
    }
    return [...by].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
  }, [files, base])

  // upload: drop files on the card or pick them; they wait in the panel until Upload
  const [queue, setQueue] = useState<File[] | null>(null)
  const [over, setOver] = useState(false)
  const pick = useRef<HTMLInputElement>(null)
  // copy the files now: a FileList is live (clearing the input empties it) and drop data is locked after the event
  const add = (list: FileList | null) => {
    const picked = list ? Array.from(list) : []
    if (picked.length) setQueue((q) => [...(q || []), ...picked])
  }
  const drop = owner
    ? {
        onDragOver: (e: DragEvent) => {
          if (![...e.dataTransfer.types].includes('Files')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setOver(true)
        },
        onDragLeave: (e: DragEvent) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(false)
        },
        onDrop: (e: DragEvent) => {
          e.preventDefault()
          setOver(false)
          add(e.dataTransfer.files)
        },
      }
    : {}
  const fm = useFileMenu(owner, refresh)

  if (all === null)
    return (
      <Widget id="pfiles" title="Files" icon="folder">
        <span className="sk" style={{ width: '60%' }} aria-label="Loading the files" />
      </Widget>
    )
  if (!files.length && !owner) return null
  const counts = SUMMARY.map(([ks, label]) => [files.filter((f) => ks.includes(kindOf(f.path))).length, label] as const).filter(([c]) => c > 0)
  return (
    <div className={'dz' + (over ? ' on' : '')} {...drop}>
      <Widget
        id="pfiles"
        title="Files"
        icon="folder"
        count={files.length || null}
        act={
          owner && (
            <>
              <input ref={pick} type="file" multiple hidden onChange={(e) => (add(e.target.files), (e.target.value = ''))} />
              <button className="btn sm" type="button" onClick={() => pick.current?.click()}>
                <Icon name="plus" size="s" />
                Upload
              </button>
            </>
          )
        }
      >
        {queue && queue.length > 0 && <UploadPanel slug={slug} files={queue} existing={existing} onClose={() => setQueue(null)} onDone={refresh} />}
        {files.length > 0 ? (
          <p className="sm muted">
            {counts.map(([c, l]) => `${c} ${l}`).join(' · ')}. Open any of them to see it drawn: charts, tables, galleries, live pages.
            {owner && ' Drop files here to add more; right-click one to remove it.'}
          </p>
        ) : (
          !queue && <p className="sm muted">No files yet. Drop pictures, data (JSON, CSV, TSV), notes or web pages here, or use Upload.</p>
        )}
        {groups.map(([top, list]) => (
          <FileGroup key={top || 'main'} label={top ? humanize(top) : 'In the main folder'} list={list} open={groups.length === 1 || list.length <= ROWS} bind={fm.bind} />
        ))}
        {fm.menu}
      </Widget>
    </div>
  )
}

function FileGroup({ label, list, open, bind }: { label: string; list: FileInfo[]; open: boolean; bind: ReturnType<typeof useFileMenu>['bind'] }) {
  const [all, setAll] = useState(false)
  const shown = all ? list : list.slice(0, ROWS)
  return (
    <details className="tg pg-grp" open={open}>
      <summary>
        <Icon name="chevR" size="s" className="chev" />
        <Icon name="folder" size="s" />
        <span className="pg-label">{label}</span>
        <span className="count">{list.length}</span>
      </summary>
      <div className="tg-body rows">
        {shown.map((f) => {
          const k = kindOf(f.path)
          return (
            <div key={f.path} className="row pg-row2" {...bind(f.path)}>
              <a className="pg-main" href={'#/docs/' + f.path} title={f.path}>
                <Icon name={ICON[k]} size="s" />
                <span className="t sm">{f.path.split('/').pop()}</span>
              </a>
              <span className="chip">{KIND_LABEL[k]}</span>
              <span className="sm muted">{humanSize(f.size)}</span>
            </div>
          )
        })}
        {list.length > ROWS && !all && (
          <button className="btn sm ghost" type="button" onClick={() => setAll(true)}>
            +{list.length - ROWS} more
          </button>
        )}
      </div>
    </details>
  )
}
