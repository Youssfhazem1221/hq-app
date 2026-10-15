import { useMemo, useState, type ReactNode } from 'react'
import { ArrowRight, Briefcase, ExternalLink, FileQuestion, FileText, Folder, FolderKanban, Lightbulb, ListTree, Pin, Sparkles, Telescope } from 'lucide-react'
import { useHQ } from '../App'
import { Badge, Card, Empty, Markdown, Segmented, toneOf } from '../components/ui'
import { isProjectFile, projectOfPath, projectSlug } from '../lib/hq'
import { sections, stripH1, title, type Doc } from '../lib/md'
import { go } from '../lib/router'
import { store } from '../lib/util'

const FOLDER_ICON: Record<string, ReactNode> = { '': <Pin className="i sm" />, investigations: <Telescope className="i sm" />, linkedin: <Briefcase className="i sm" /> }

/** Group key: a project folder (projects/<slug>) is its own group; otherwise the top folder ('' = root). */
const groupOf = (p: string) => {
  const project = p.match(/^projects\/([^/]+)\//)?.[1]
  return project ? `projects/${project}` : p.includes('/') ? p.split('/')[0] : ''
}

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
    for (const d of hits) g.set(groupOf(d.path), [...(g.get(groupOf(d.path)) || []), d])
    // Inside a project folder, project.md comes first.
    for (const docs of g.values()) docs.sort((a, b) => Number(isProjectFile(b.path)) - Number(isProjectFile(a.path)) || a.path.localeCompare(b.path))
    return [...g.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
  }, [model, q])

  const label = (key: string) => {
    const slug = key.match(/^projects\/(.+)$/)?.[1]
    if (!slug) return key || 'Core'
    return String(model.projects.find((p) => projectSlug(p) === slug)?.data.title || slug)
  }

  return (
    <div className="docs">
      <aside className={'doc-list' + (doc ? ' has-doc' : '')}>
        <input placeholder="Search docs…" value={q} onChange={(e) => setQ(e.target.value)} />
        {groups.map(([key, docs]) => (
          <div key={key} className={'doc-group' + (key.startsWith('projects/') ? ' is-project' : '')}>
            <div className="doc-group-h" title={key || 'Top-level files'}>
              {key.startsWith('projects/') ? <FolderKanban className="i sm" /> : FOLDER_ICON[key] || <Folder className="i sm" />} {label(key)}
            </div>
            {docs.map((d) => (
              <a key={d.path} href={'#/docs/' + d.path} className={'doc-link' + (d.path === path ? ' on' : '')} title={d.path}>
                <span>{key.startsWith('projects/') && isProjectFile(d.path) ? 'Project overview' : title(d)}</span>
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
  const { source, model } = useHQ()
  const [mode, setModeState] = useState<'outline' | 'full'>(store.get('hq.docmode', 'outline'))
  const setMode = (m: 'outline' | 'full') => {
    store.set('hq.docmode', m)
    setModeState(m)
  }
  const [openAll, setOpenAll] = useState<boolean | null>(null)
  const body = stripH1(doc.body)
  const secs = sections(body)
  const intro = secs[0] && !secs[0].title ? secs[0] : null
  const rest = intro ? secs.slice(1) : secs
  const web = source.webUrl(doc.path)
  const slug = projectOfPath(doc.path)
  const project = slug ? model.projects.find((p) => projectSlug(p) === slug) : undefined

  // Summaries stream on the Ask page like any question.
  const summarize = () => {
    store.set('hq.askPrefill', {
      q: `Summarize ${doc.path} for me: top line first, then at most 7 bullets, then the single next step.`,
      kind: 'summarize',
      target: doc.path,
      project: slug,
      auto: true,
    })
    go('/ask')
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
          {project && (
            <a className="proj-chip" href={'#/projects/' + slug} title="Open the project page">
              <FolderKanban className="i sm" /> {String(project.data.title || slug)}
            </a>
          )}
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
          <button className="btn sm" onClick={summarize}>
            <Sparkles className="i sm" /> Summarize
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
