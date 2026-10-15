import { useEffect, useState } from 'react'
import {
  ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Bot, CalendarClock, Check, Circle, FileText, Files, Flag, FolderKanban,
  History, Link2, ListChecks, Minus, Sparkles, TrendingUp,
} from 'lucide-react'
import { useHQ } from '../App'
import { BridgeChip } from '../components/bridge'
import { Chart } from '../components/charts'
import { Ago, Avatar, Badge, Card, Empty, toneOf } from '../components/ui'
import { askClaudeToRefresh, displayName, freshness, metrics, milestones, projectFolder, projectSlug } from '../lib/hq'
import { title, type Doc } from '../lib/md'
import type { Commit } from '../lib/source'
import { go } from '../lib/router'
import { store } from '../lib/util'

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : [])
const shortDate = (d?: string) => (d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '')

export default function Projects({ slug }: { slug: string }) {
  const { model } = useHQ()
  if (slug) {
    const p = model.projects.find((x) => projectSlug(x) === slug)
    return p ? <ProjectView p={p} /> : <Empty icon={<FolderKanban className="i" />} text={`No project called "${slug}".`} />
  }
  const byOwner = new Map<string, Doc[]>()
  for (const p of model.projects) {
    const o = String(p.data.owner || 'unassigned')
    byOwner.set(o, [...(byOwner.get(o) || []), p])
  }
  return (
    <>
      <div className="row between wrap">
        <span className="muted small">{model.projects.length} project{model.projects.length === 1 ? '' : 's'}</span>
        <BridgeChip />
      </div>
      {[...byOwner.entries()].map(([owner, ps]) => (
        <section key={owner} className="group">
          <h2 className="group-h">
            <Avatar name={displayName(model, owner)} size={30} /> {displayName(model, owner)}'s projects <span className="muted">{ps.length}</span>
          </h2>
          <div className="proj-grid">
            {ps.map((p) => <ProjectCard key={p.path} p={p} />)}
          </div>
        </section>
      ))}
      {!model.projects.length && <Empty icon={<FolderKanban className="i" />} text="No projects yet. Ask Claude to start one." />}
      <p className="muted small">
        New project? Post on the board with "Flag for Claude", or run <code>node scripts/hq.mjs project new "Title"</code>.
        Each project is a folder: <code>projects/&lt;slug&gt;/project.md</code> plus any docs you put next to it.
      </p>
    </>
  )
}

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max ? Math.round((value / max) * 100) : 0
  return (
    <div className="meter">
      <div className="meter-track" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
        <div className="meter-fill" style={{ width: pct + '%' }} />
      </div>
      <span className="small muted num">{value}/{max} {label}</span>
    </div>
  )
}

export function Fresh({ updated }: { updated: unknown }) {
  const f = freshness(updated)
  return (
    <span className={`fresh tone-${f.tone}`} title={String(updated || '')}>
      <CalendarClock className="i sm" /> {f.label}
    </span>
  )
}

export function ProjectCard({ p, compact = false }: { p: Doc; compact?: boolean }) {
  const ms = milestones(p)
  const snaps = metrics(p)
  const last = snaps[snaps.length - 1]
  const labels = (p.data.metric_labels || {}) as Record<string, string>
  const firstKey = last ? Object.keys(last.values)[0] : undefined
  return (
    <a className="proj" href={'#/projects/' + projectSlug(p)}>
      <div className="proj-h">
        <b>{p.data.title}</b>
        <Badge tone={toneOf(p.data.status)}>{p.data.status}</Badge>
      </div>
      {!compact && p.data.summary && <p className="muted small">{p.data.summary}</p>}
      {ms.length > 0 && <Meter value={ms.filter((m) => m.done).length} max={ms.length} label="milestones" />}
      <div className="proj-f">
        <Fresh updated={p.data.updated} />
        {firstKey && (
          <span className="small muted">
            {labels[firstKey] || firstKey}: <b className="num">{String(last!.values[firstKey])}</b>
          </span>
        )}
      </div>
      {p.data.next && (
        <p className="next">
          <ArrowRight className="i sm" /> {p.data.next}
        </p>
      )}
    </a>
  )
}

function StatTile({ label, value, delta, since }: { label: string; value: unknown; delta?: number; since?: string }) {
  const dir = delta === undefined ? null : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  return (
    <div className="stat">
      <span className="stat-l">{label}</span>
      <span className="stat-v">{typeof value === 'number' ? value.toLocaleString() : String(value ?? '–')}</span>
      {dir && (
        <span className={'stat-d tone-' + (dir === 'up' ? 'ok' : dir === 'down' ? 'bad' : 'muted')}>
          {dir === 'up' ? <ArrowUpRight className="i sm" /> : dir === 'down' ? <ArrowDownRight className="i sm" /> : <Minus className="i sm" />}
          {delta! > 0 ? '+' : ''}
          {delta} since {shortDate(since)}
        </span>
      )}
    </div>
  )
}

function ProjectView({ p }: { p: Doc }) {
  const { model, me, source, reload, loadedAt } = useHQ()
  const slug = projectSlug(p)
  const ms = milestones(p)
  const done = ms.filter((m) => m.done).length
  const snaps = metrics(p)
  const labels = (p.data.metric_labels || {}) as Record<string, string>
  const keys = [...new Set([...Object.keys(labels), ...snaps.flatMap((s) => Object.keys(s.values))])].filter((k) =>
    snaps.some((s) => s.values[k] !== undefined),
  )
  const latest = snaps[snaps.length - 1]
  const prev = snaps[snaps.length - 2]
  const todos = model.todos.filter((t) => t.data.project === slug)
  const posts = model.board.filter((b) => b.data.project === slug)
  const docs = list(p.data.docs).map((x) => model.byPath.get(x)).filter(Boolean) as Doc[]
  const folder = projectFolder(p)
  const files = model.projectFiles.get(slug) || []
  const owner = displayName(model, p.data.owner)
  const [acts, setActs] = useState<Commit[] | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // A folder project's history covers every file in its folder.
    const paths = [folder || p.path, p.data.hub].filter(Boolean) as string[]
    Promise.all(paths.map((x) => source.activity(x).catch(() => [] as Commit[])))
      .then((rs) => {
        const seen = new Set<string>()
        setActs(rs.flat().filter((c) => !seen.has(c.sha) && seen.add(c.sha)).sort((a, b) => b.date.localeCompare(a.date)))
      })
  }, [source, loadedAt, p.path, folder])

  const refresh = async () => {
    setBusy(true)
    try {
      await askClaudeToRefresh(source, me, p)
      await reload()
      setMsg('Posted on the board, flagged for Claude. It runs in the next Claude session.')
    } catch (e: any) {
      setMsg('Could not post: ' + (e?.message || e))
    } finally {
      setBusy(false)
    }
  }
  const askAbout = () => {
    store.set('hq.askPrefill', { q: `Where does the "${p.data.title}" project stand, and what are the next 3 steps?`, project: slug })
    go('/ask')
  }
  const num = (s: typeof latest | undefined, k: string) => (s && typeof s.values[k] === 'number' ? (s.values[k] as number) : undefined)

  return (
    <>
      <div className="doc-head">
        <a href="#/projects" className="small meta-line"><ArrowLeft className="i sm" /> All projects</a>
        <h2>{p.data.title}</h2>
        <div className="row wrap">
          <Badge tone={toneOf(p.data.status)}>{p.data.status}</Badge>
          <Fresh updated={p.data.updated} />
          <span className="meta-line small"><Avatar name={owner} size={20} /> {owner}</span>
          {p.data.started && <span className="muted small">started {String(p.data.started)}</span>}
        </div>
      </div>

      <div className="callouts">
        {p.data.goal && <div className="callout tone-info"><Flag className="i" /> <span><b>Goal:</b> {p.data.goal}</span></div>}
        {p.data.next && <div className="callout tone-warn"><ArrowRight className="i" /> <span><b>Next:</b> {p.data.next}</span></div>}
      </div>

      <div className="row wrap">
        <button className="btn primary" disabled={busy} onClick={refresh}><Bot className="i sm" /> Ask Claude to refresh</button>
        <BridgeChip />
        <button className="btn" onClick={askAbout}><Sparkles className="i sm" /> Ask AI about it</button>
        {p.data.hub && <a className="btn ghost" href={'#/docs/' + p.data.hub}><FileText className="i sm" /> Open hub doc</a>}
        <a className="btn ghost" href={'#/docs/' + p.path}><FileText className="i sm" /> Project file</a>
        {msg && <span className="small">{msg}</span>}
      </div>

      {snaps.length > 0 && (
        <Card icon={<TrendingUp className="i" />} title="Tracker" extra={<span className="muted small">{snaps.length} snapshot{snaps.length === 1 ? '' : 's'} · latest {shortDate(latest.date)}</span>}>
          <div className="stats">
            {keys.map((k) => {
              const a = num(latest, k)
              const b = num(prev, k)
              return <StatTile key={k} label={labels[k] || k} value={latest.values[k]} delta={a !== undefined && b !== undefined ? a - b : undefined} since={prev?.date} />
            })}
          </div>
          {snaps.length < 2 && <p className="muted small">Change vs. last time shows up after the next snapshot. "Ask Claude to refresh" adds one.</p>}
          {snaps.length >= 2 && (
            <div className="trend-grid">
              {keys.map((k) => (
                <Chart
                  key={k}
                  spec={{
                    type: 'line',
                    title: labels[k] || k,
                    labels: snaps.map((s) => shortDate(s.date)),
                    series: [{ name: labels[k] || k, data: snaps.map((s) => (typeof s.values[k] === 'number' ? (s.values[k] as number) : null)) }],
                  }}
                />
              ))}
            </div>
          )}
          <div className="table-wrap">
            <table className="cmp">
              <thead>
                <tr><th>Date</th>{keys.map((k) => <th key={k}>{labels[k] || k}</th>)}<th>Source</th></tr>
              </thead>
              <tbody>
                {[...snaps].reverse().map((s) => (
                  <tr key={s.date}>
                    <td className="nowrap">{shortDate(s.date)}</td>
                    {keys.map((k) => <td key={k}>{String(s.values[k] ?? '–')}</td>)}
                    <td className="small muted">{s.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid two">
        <Card icon={<Flag className="i" />} title="Milestones" extra={<span className="muted small num">{done}/{ms.length}</span>}>
          {ms.length ? (
            <>
              <Meter value={done} max={ms.length} label="done" />
              <ol className="timeline">
                {ms.map((m, i) => (
                  <li key={i} className={m.done ? 'done' : ''}>
                    {m.done ? <Check className="i sm" /> : <Circle className="i sm" />}
                    <span>{m.text}</span>
                    {m.date && <span className="muted small nowrap">{shortDate(m.date)}</span>}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <Empty icon={<Flag className="i" />} text="No milestones yet." />
          )}
        </Card>
        <Card icon={<ListChecks className="i" />} title="To-dos" extra={<a className="small" href="#/todos">Add one</a>}>
          {todos.length ? (
            <ul className="check-list">
              {todos.map((t) => (
                <li key={t.path}>
                  <Badge tone={toneOf(t.data.status)}>{t.data.status}</Badge>
                  <span>{t.data.title}</span>
                  <span className="small muted">{displayName(model, t.data.owner)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={<ListChecks className="i" />} text="No to-dos tagged with this project yet." />
          )}
        </Card>
      </div>

      <div className="grid two">
        <Card icon={<Files className="i" />} title="Files in this project" extra={<span className="muted small num">{files.length}</span>}>
          {files.length ? (
            <ul className="link-list">
              {files.map((d) => (
                <li key={d.path}>
                  <a href={'#/docs/' + d.path}>{title(d)}</a>
                  <span className="muted small" title={d.path}>{d.path.slice(`projects/${slug}/`.length)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              icon={<Files className="i" />}
              text={folder ? <>No other files yet. Any <code>.md</code> saved in <code>{folder}/</code> shows up here.</> : <>Old single-file project. Move it to <code>projects/{slug}/project.md</code> to keep docs next to it.</>}
            />
          )}
        </Card>
        <Card icon={<Link2 className="i" />} title="Linked docs">
          {docs.length ? (
            <ul className="link-list">
              {docs.map((d) => (
                <li key={d.path}>
                  <a href={'#/docs/' + d.path}>{String(d.data.title || title(d))}</a>
                  {d.data.updated && <span className="muted small">updated {String(d.data.updated)}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={<FileText className="i" />} text="No linked docs." />
          )}
        </Card>
      </div>

      <Card icon={<History className="i" />} title="Activity">
        {posts.length > 0 && (
          <ul className="feed">
            {posts.slice(0, 5).map((b) => (
              <li key={b.path}>
                <Avatar name={displayName(model, b.data.author)} size={22} />
                <a className="feed-msg" href="#/board">{b.body.trim().split('\n')[0].replace(/\*\*/g, '')}</a>
                <Ago iso={b.data.created} />
              </li>
            ))}
          </ul>
        )}
        {acts === null ? (
          <span className="muted">Loading…</span>
        ) : acts.length ? (
          <ul className="feed">
            {acts.slice(0, 8).map((c) => (
              <li key={c.sha}>
                <Avatar name={c.author} src={c.avatar} size={22} />
                <span className="feed-msg">{c.message}</span>
                <Ago iso={c.date} />
              </li>
            ))}
          </ul>
        ) : (
          !posts.length && <Empty icon={<History className="i" />} text="File history appears once the repo is on GitHub." />
        )}
      </Card>
    </>
  )
}
