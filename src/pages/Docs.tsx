import { useMemo, useState, type ReactNode } from 'react'
import { ArrowRight, Briefcase, ExternalLink, FileQuestion, FileText, Folder, Lightbulb, ListTree, Pin, Sparkles, Telescope } from 'lucide-react'
import { useHQ } from '../App'
import { Badge, Card, Empty, Markdown, Segmented, toneOf } from '../components/ui'
import { askAi } from '../lib/hq'
import { sections, stripH1, title, type Doc } from '../lib/md'
import { go } from '../lib/router'
import { store } from '../lib/util'

const FOLDER_ICON: Record<string, ReactNode> = { '': <Pin className="i sm" />, investigations: <Telescope className="i sm" />, linkedin: <Briefcase className="i sm" /> }

export default function Docs({ path }: { path: string }) {
  const { model } = useHQ()
  const [q, setQ] = useState('')
  const doc = path ? model.byPath.get(path) : undefined

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const hits = model.knowledge.filter(
      (d) => !needle || title(d).toLowerCase().includes(needle) || d.path.toLowerCase().includes(needle) || d.body.toLowerCase().includes(needle),
    )
    const g = new Map<string, Doc[]>()
    for (const d of hits) {
      const folder = d.path.includes('/') ? d.path.split('/')[0] : ''
      g.set(folder, [...(g.get(folder) || []), d])
    }
    return [...g.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
  }, [model, q])

  return (
    <div className="docs">
      <aside className={'doc-list' + (doc ? ' has-doc' : '')}>
        <input placeholder="Search docs…" value={q} onChange={(e) => setQ(e.target.value)} />
        {groups.map(([folder, docs]) => (
          <div key={folder} className="doc-group">
            <div className="doc-group-h">
              {FOLDER_ICON[folder] || <Folder className="i sm" />} {folder || 'Core'}
            </div>
            {docs.map((d) => (
              <a key={d.path} href={'#/docs/' + d.path} className={'doc-link' + (d.path === path ? ' on' : '')}>
                <span>{title(d)}</span>
                {d.data.status && <Badge tone={toneOf(d.data.status)}>{d.data.status}</Badge>}
              </a>
            ))}
          </div>
        ))}
        {!groups.length && <div className="muted small pad">No matches.</div>}
      </aside>
      <div className="doc-view">
        {doc ? (
          <DocView key={doc.path} doc={doc} />
        ) : path ? (
          <Empty icon={<FileQuestion className="i" />} text={`Not found: ${path}`} />
        ) : (
          <Overview />
        )}
      </div>
    </div>
  )
}

function Overview() {
  const { model } = useHQ()
  return (
    <div className="cards">
      {model.knowledge.map((d) => (
        <a key={d.path} className="mini" href={'#/docs/' + d.path}>
          <div className="mini-h">
            <b>{title(d)}</b>
            {d.data.status && <Badge tone={toneOf(d.data.status)}>{d.data.status}</Badge>}
          </div>
          <p className="muted small">{d.data.summary || d.path}</p>
        </a>
      ))}
    </div>
  )
}

function DocView({ doc }: { doc: Doc }) {
  const { source, me, reload } = useHQ()
  const [mode, setModeState] = useState<'outline' | 'full'>(store.get('hq.docmode', 'outline'))
  const setMode = (m: 'outline' | 'full') => {
    store.set('hq.docmode', m)
    setModeState(m)
  }
  const [openAll, setOpenAll] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const body = stripH1(doc.body)
  const secs = sections(body)
  const intro = secs[0] && !secs[0].title ? secs[0] : null
  const rest = intro ? secs.slice(1) : secs
  const web = source.webUrl(doc.path)

  const summarize = async () => {
    setBusy(true)
    try {
      const id = await askAi(source, me, {
        kind: 'summarize',
        target: doc.path,
        question: `Summarize ${doc.path} for me: top line first, then at most 7 bullets, then the single next step.`,
      })
      if (source.runAi) await source.runAi(id)
      await reload()
      go('/ask')
    } catch (e: any) {
      alert(e?.message || e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="doc-head">
        <h2>{title(doc)}</h2>
        <div className="row wrap">
          {doc.data.type && <Badge>{doc.data.type}</Badge>}
          {doc.data.status && <Badge tone={toneOf(doc.data.status)}>{doc.data.status}</Badge>}
          {doc.data.updated && <span className="muted small">updated {String(doc.data.updated)}</span>}
          <span className="muted small">· {doc.path}</span>
          {web && <a className="small meta-line" href={web} target="_blank" rel="noopener">GitHub <ExternalLink className="i sm" /></a>}
        </div>
      </div>

      {(doc.data.summary || doc.data.next) && (
        <div className="callouts">
          {doc.data.summary && <div className="callout tone-info"><Lightbulb className="i" /> <span>{doc.data.summary}</span></div>}
          {doc.data.next && <div className="callout tone-warn"><ArrowRight className="i" /> <span><b>Next:</b> {doc.data.next}</span></div>}
        </div>
      )}

      <div className="row between wrap toolbar">
        <Segmented value={mode} onChange={setMode} options={[['outline', <><ListTree className="i sm" /> Outline</>], ['full', <><FileText className="i sm" /> Full</>]]} />
        <div className="row">
          {mode === 'outline' && (
            <>
              <button className="btn ghost sm" onClick={() => setOpenAll(true)}>Expand all</button>
              <button className="btn ghost sm" onClick={() => setOpenAll(false)}>Collapse all</button>
            </>
          )}
          <button className="btn sm" disabled={busy} onClick={summarize}>
            <Sparkles className="i sm" /> {busy ? 'Asking…' : 'Summarize'}
          </button>
        </div>
      </div>

      <Card>
        {mode === 'full' ? (
          <Markdown md={body} base={doc.path} />
        ) : (
          <>
            {intro && <Markdown md={intro.md} base={doc.path} />}
            {rest.map((s, i) => (
              <details key={`${openAll}-${i}`} className="sec" open={openAll ?? i === 0}>
                <summary>{s.title}</summary>
                <Markdown md={s.md} base={doc.path} />
              </details>
            ))}
          </>
        )}
      </Card>
    </>
  )
}
