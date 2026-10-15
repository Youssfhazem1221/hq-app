// Sidebar "Pages": built from model.knowledge only (titles + icons, folders as buttons with counts). projects/ lives under
// Projects; people/, ai/, board/, todos/ are never listed. Open folders are a per-device convenience.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Icon } from '../../lib/icons'
import { useHQMaybe } from '../../lib/hq-context'
import { store } from '../../lib/util'
import { pagesTree } from './shell-core'

const OPEN_KEY = 'hq.sb.tree'
const docHref = (p: string) => '#/docs/' + encodeURI(p)

export function PagesTree({ currentDoc, open: groupOpen, onToggle }: { currentDoc?: string; open: boolean; onToggle: () => void }) {
  const hq = useHQMaybe()
  const tree = useMemo(() => pagesTree(hq?.model || null), [hq?.model])
  const [open, setOpen] = useState<Record<string, boolean>>(() => store.get(OPEN_KEY, {}))
  const cur = currentDoc || ''
  // The folder holding the page you're reading opens by itself.
  useEffect(() => {
    const dir = cur.includes('/') ? cur.slice(0, cur.indexOf('/')) : ''
    if (dir && !open[dir]) setOpen((o) => ({ ...o, [dir]: true }))
  }, [cur]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!tree.dirs.length && !tree.files.length) return null
  const toggle = (dir: string) =>
    setOpen((o) => {
      const next = { ...o, [dir]: !o[dir] }
      store.set(OPEN_KEY, next)
      return next
    })
  return (
    <div className="sb-group">
      <button className="sb-h" type="button" aria-expanded={groupOpen} onClick={onToggle}>
        <Icon name="chevD" />
        Pages
      </button>
      {groupOpen && (
        <div className="tree">
          {tree.dirs.map((d) => (
            <Fragment key={d.dir}>
              <button type="button" className="tdir" aria-expanded={!!open[d.dir]} onClick={() => toggle(d.dir)}>
                <Icon name="chevR" className="tchev" />
                <Icon name="folder" />
                <span className="lbl">{d.label}</span>
                <span className="badge">{d.items.length}</span>
              </button>
              {open[d.dir] &&
                d.items.map((it) => (
                  <a key={it.path} className="ind" href={docHref(it.path)} aria-current={cur === it.path ? 'page' : undefined} title={it.title}>
                    <Icon name={it.icon} />
                    <span className="lbl">{it.title}</span>
                  </a>
                ))}
            </Fragment>
          ))}
          {tree.files.map((it) => (
            <a key={it.path} href={docHref(it.path)} aria-current={cur === it.path ? 'page' : undefined} title={it.title}>
              <Icon name={it.icon} />
              <span className="lbl">{it.title}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
