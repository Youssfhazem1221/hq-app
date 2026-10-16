// The Pages card, grouped: main pages, then one collapsible section per top-level folder (named by its README), one
// row per sub-folder with its other notes as chips. A folder the board already shows starts closed.
import { useMemo } from 'react'
import { useHQ } from '../../lib/hq-context'
import type { Doc } from '../../lib/md'
import { Icon } from '../../lib/icons'
import { boardConfig, pageGroups } from '../../lib/project-board'
import { Widget } from '../ui'

const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : typeof v === 'string' && v.trim() ? v.split(',').map((x) => x.trim()) : [])

export function ProjectPages({ p, slug }: { p: Doc; slug: string }) {
  const { model } = useHQ()
  const hub = String(p.data.hub || '')
  const groups = useMemo(() => {
    const paths = new Set([hub, ...listOf(p.data.docs)].filter(Boolean))
    const docs = [...(model.projectFiles.get(slug) || []), ...[...paths].map((x) => model.byPath.get(x)).filter(Boolean)] as Doc[]
    return pageGroups(slug, docs, { hub, boardFolder: boardConfig(p, slug)?.folder || null, order: [...paths] })
  }, [model, p, slug, hub])
  const total = groups.reduce((a, g) => a + g.count, 0)

  return (
    <Widget id="files" title="Pages" icon="folder" count={total || null}>
      {!groups.length && <p className="sm muted">No pages yet. Any note saved in this project’s folder shows up here.</p>}
      {groups.map((g) => (
        <details key={g.key || 'main'} className="tg pg-grp" open={!g.board}>
          <summary>
            <Icon name="chevR" size="s" className="chev" />
            <Icon name={g.key ? 'folder' : 'file'} size="s" />
            <span className="pg-label">{g.label}</span>
            <span className="count">{g.count}</span>
            {g.board && <span className="chip">on the board</span>}
          </summary>
          <div className="tg-body rows">
            {g.index && (
              <a className="row" href={'#/docs/' + g.index}>
                <Icon name="info" size="s" />
                <span className="t sm">About this folder</span>
              </a>
            )}
            {g.rows.map((r) => (
              <div key={r.path} className="row pg-row2">
                <a className="pg-main" href={'#/docs/' + r.path} title={r.path}>
                  <Icon name="file" size="s" />
                  <span className="t sm">{r.title}</span>
                </a>
                {r.path === hub && <span className="chip">main page</span>}
                {r.links.map((l) => (
                  <a key={l.path} className="chip line" href={'#/docs/' + l.path} title={l.title}>
                    {/\/script\.md$/i.test(l.path) ? 'Script' : l.title.slice(0, 24)}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </details>
      ))}
    </Widget>
  )
}
