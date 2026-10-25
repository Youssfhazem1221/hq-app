// The project page's Files card: every file in the project's folder that is not a note (data, tables, images, media,
// web pages, code), grouped by top folder like the Pages card, each opening in the file viewer (#/docs/<path>).
// The list is read when the card shows (lib/files: the dev server's /__hq/tree, or one GitHub tree call, then 304s).
import { useEffect, useMemo, useState } from 'react'
import { useHQ } from '../../lib/hq-context'
import { Icon } from '../../lib/icons'
import type { IconName } from '../../lib/contracts'
import { KIND_LABEL, humanSize, kindOf, listFiles, type FileInfo, type FileKind } from '../../lib/files'
import { humanize } from '../../lib/data-shape'
import { Widget } from '../ui'

const ICON: Record<FileKind, IconName> = { json: 'db', table: 'table', image: 'grid', svg: 'grid', video: 'play', audio: 'play', html: 'globe', text: 'file', md: 'file', other: 'file' }
const ROWS = 8
const SUMMARY: [FileKind[], string][] = [[['json'], 'data'], [['table'], 'tables'], [['image', 'svg'], 'images'], [['video', 'audio'], 'media'], [['html'], 'web pages'], [['text', 'other'], 'other']]

export function ProjectFiles({ slug }: { slug: string }) {
  const { source } = useHQ()
  const [files, setFiles] = useState<FileInfo[] | null>(null)
  useEffect(() => {
    let alive = true
    const base = `projects/${slug}/`
    listFiles(source).then(
      (l) => alive && setFiles(l.filter((f) => f.path.startsWith(base) && kindOf(f.path) !== 'md')),
      () => alive && setFiles([]),
    )
    return () => {
      alive = false
    }
  }, [source, slug])
  const groups = useMemo(() => {
    const by = new Map<string, FileInfo[]>()
    for (const f of files || []) {
      const rel = f.path.slice(`projects/${slug}/`.length)
      const top = rel.includes('/') ? rel.split('/')[0] : ''
      by.set(top, [...(by.get(top) || []), f])
    }
    return [...by].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
  }, [files, slug])
  if (files === null)
    return (
      <Widget id="pfiles" title="Files" icon="folder">
        <span className="sk" style={{ width: '60%' }} aria-label="Loading the files" />
      </Widget>
    )
  if (!files.length) return null
  const counts = SUMMARY.map(([ks, label]) => [files.filter((f) => ks.includes(kindOf(f.path))).length, label] as const).filter(([n]) => n > 0)
  return (
    <Widget id="pfiles" title="Files" icon="folder" count={files.length}>
      <p className="sm muted">{counts.map(([n, l]) => `${n} ${l}`).join(' · ')}. Open any of them to see it drawn: charts, tables, galleries, live pages.</p>
      {groups.map(([top, list]) => (
        <FileGroup key={top || 'main'} label={top ? humanize(top) : 'In the main folder'} list={list} open={groups.length === 1 || list.length <= ROWS} />
      ))}
    </Widget>
  )
}

function FileGroup({ label, list, open }: { label: string; list: FileInfo[]; open: boolean }) {
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
            <div key={f.path} className="row pg-row2">
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
