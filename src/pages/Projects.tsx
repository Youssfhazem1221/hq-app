// Projects (spec §6.2): header tiles (milestones done, active) + the global Next → Gallery (your projects first, then
// by owner; cards: glyph, title, status, goal, beads as one picture, the project's Next, a metric, stale dot only) ·
// Board (active / waiting / parked) · Timeline (only with ≥3 dated milestones: dated marks on an axis │ a break │ a
// "Queue · no date" box). New project = create-only, I become its owner (people.ts createProject). `N` opens it.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useHQ } from '../lib/hq-context'
import { HQ_EVENTS, type PageProps } from '../lib/contracts'
import { Icon } from '../lib/icons'
import { go } from '../lib/router'
import { store } from '../lib/util'
import { displayName, metrics, milestones, projectSlug } from '../lib/hq'
import type { Doc } from '../lib/md'
import { createProject } from '../lib/people'
import { nextFor, projectSlugOf } from '../lib/next-core'
import { PageHeader } from '../components/shell/PageHeader'
import { Avatar, Empty, Segmented, StatusPill } from '../components/ui'
import { Beads } from '../components/visuals/Beads'
import { NextActionsProvider, nextOpts, useNext } from '../components/NextActions'
import { ProjectGlyph, StaleDot, plural, same, slotOf } from '../components/work-ui'
import { toast } from '../components/toast'

export const v3 = true

type View = 'gallery' | 'board' | 'timeline'
const VIEW_KEY = 'hq.projects.view'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const listOf = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',').map((s) => s.trim()) : [])
const isMember = (p: Doc, login: string) => same(p.data.owner, login) || listOf(p.data.members).some((m) => same(m, login))
const datedCount = (ps: Doc[]) => ps.reduce((a, p) => a + milestones(p).filter((m) => m.date && /^\d{4}-\d{2}-\d{2}/.test(m.date)).length, 0)

export default function ProjectsPage(_: PageProps) {
  return (
    <NextActionsProvider>
      <Projects />
    </NextActionsProvider>
  )
}

function Projects() {
  const { model } = useHQ()
  const { first } = useNext()
  const [view, setView] = useState<View>(() => store.get<View>(VIEW_KEY, 'gallery'))
  const [adding, setAdding] = useState(false)
  const timeline = datedCount(model.projects) >= 3
  const shown: View = view === 'timeline' && !timeline ? 'gallery' : view
  const ms = model.projects.flatMap(milestones)
  const done = ms.filter((m) => m.done).length
  const active = model.projects.filter((p) => String(p.data.status || '') === 'active').length

  useEffect(() => {
    const onNew = (e: Event) => {
      if ((e as CustomEvent).detail?.page !== 'Projects') return
      e.preventDefault()
      setAdding(true)
    }
    addEventListener(HQ_EVENTS.newItem, onNew)
    return () => removeEventListener(HQ_EVENTS.newItem, onNew)
  }, [])
  const pick = (v: View) => {
    setView(v)
    store.set(VIEW_KEY, v)
  }

  const views: [View, React.ReactNode][] = [
    ['gallery', <><Icon name="grid" />Gallery</>],
    ['board', <><Icon name="cols" />Board</>],
    ...(timeline ? ([['timeline', <><Icon name="gantt" />Timeline</>]] as [View, React.ReactNode][]) : []),
  ]
  return (
    <div className="work-page">
      <PageHeader
        icon="projects"
        title="Projects"
        tiles={[
          ms.length ? { value: <>{done}<small>/{ms.length}</small></>, label: 'milestones done' } : null,
          active ? { value: active, label: 'active' } : null,
        ]}
        next={first}
      />
      <div className="toolbar">
        <Segmented value={shown} options={views} onChange={pick} label="View" />
        <span className="sp" />
        {!adding && (
          <button className="btn" type="button" onClick={() => setAdding(true)}>
            <Icon name="plus" size="s" />
            New project
          </button>
        )}
      </div>
      {adding && <NewProject onDone={() => setAdding(false)} />}
      {!model.projects.length ? (
        <div className="w">
          <Empty icon="projects" text="No projects yet. Start one: you become its owner.">
            {!adding && (
              <button className="btn sm" type="button" onClick={() => setAdding(true)}>
                <Icon name="plus" size="s" />
                New project
              </button>
            )}
          </Empty>
        </div>
      ) : shown === 'gallery' ? (
        <Gallery />
      ) : shown === 'board' ? (
        <StatusBoardView />
      ) : (
        <TimelineView />
      )}
    </div>
  )
}

function NewProject({ onDone }: { onDone: () => void }) {
  const { model, me, source, reload } = useHQ()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = title.trim()
    if (!t || busy) return
    setBusy(true)
    try {
      const r = await createProject(source, me, { title: t }, model)
      await reload()
      toast('New project · you own it', 'ok')
      onDone()
      go('/projects/' + r.slug)
    } catch (err: any) {
      toast(String(err?.message || err), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="askbar newp" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onDone()}>
      <Icon name="projects" />
      <label className="sr" htmlFor="newp-title">
        New project title
      </label>
      <input ref={input} id="newp-title" placeholder="Project title…" autoComplete="off" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
      <button className="btn ghost sm" type="button" onClick={onDone}>
        Cancel
      </button>
      <button className="btn primary sm" type="submit" disabled={!title.trim() || busy}>
        Create
      </button>
    </form>
  )
}

// ---- gallery ----

function Gallery() {
  const { model, me } = useHQ()
  const opts = useMemo(() => nextOpts(model, me), [model, me])
  const mine = model.projects.filter((p) => isMember(p, me.login))
  const byOwner = new Map<string, Doc[]>()
  for (const p of model.projects.filter((x) => !isMember(x, me.login))) {
    const o = String(p.data.owner || '').trim() || 'unassigned'
    byOwner.set(o, [...(byOwner.get(o) || []), p])
  }
  const card = (p: Doc) => <GalleryCard key={p.path} p={p} nextText={nextFor(model, me, projectSlugOf(p), Date.now(), opts)?.text} />
  return (
    <div className="page-enter">
      {mine.length > 0 && (
        <>
          <h2 className="grp">
            <Avatar name={displayName(model, me.login)} size={22} />
            Your projects
          </h2>
          <div className="gallery">{mine.map(card)}</div>
        </>
      )}
      {[...byOwner.entries()].map(([owner, ps]) => (
        <section key={owner}>
          <h2 className="grp">
            <Avatar name={displayName(model, owner)} size={22} />
            {displayName(model, owner)}’s projects
          </h2>
          <div className="gallery">{ps.map(card)}</div>
        </section>
      ))}
    </div>
  )
}

function GalleryCard({ p, nextText }: { p: Doc; nextText?: string }) {
  const { model } = useHQ()
  const slug = projectSlugOf(p)
  const snaps = metrics(p)
  const last = snaps[snaps.length - 1]
  const labels = (p.data.metric_labels || {}) as Record<string, string>
  const key = last ? Object.keys(last.values).find((k) => typeof last.values[k] === 'number') : undefined
  const owner = displayName(model, p.data.owner)
  return (
    <a className="gcard" data-pc={slotOf(p)} href={'#/projects/' + slug}>
      <div className="top-row">
        <ProjectGlyph project={p} />
        <h3>{String(p.data.title || slug)}</h3>
        <StatusPill status={p.data.status} />
      </div>
      {p.data.goal ? <p className="pgoal">{String(p.data.goal)}</p> : p.data.summary ? <p className="pgoal">{String(p.data.summary)}</p> : <span />}
      <Beads project={p} count />
      {nextText ? (
        <div className="nx">
          <Icon name="arrow" size="s" />
          <span>{nextText}</span>
        </div>
      ) : (
        <span />
      )}
      <div className="ptile-f">
        <Avatar name={owner} size={22} />
        {key && (
          <span className="metric">
            <b className="num">{Number(last!.values[key]).toLocaleString('en')}</b>
            {String(labels[key] || key).toLowerCase()}
          </span>
        )}
        <span className="sp" />
        <StaleDot updated={p.data.updated} />
      </div>
    </a>
  )
}

// ---- board (by status) ----

function StatusBoardView() {
  const { model } = useHQ()
  const cols = ['active', 'waiting', 'parked', 'done']
  const extra = model.projects.some((p) => !cols.includes(String(p.data.status || '')))
  const shown = cols.filter((s) => s !== 'done' || model.projects.some((p) => p.data.status === 'done'))
  const groups: [string, Doc[]][] = shown.map((s) => [s, model.projects.filter((p) => String(p.data.status || '') === s)])
  if (extra) groups.push(['other', model.projects.filter((p) => !cols.includes(String(p.data.status || '')))])
  return (
    <div className="kb pboard page-enter" data-cols={groups.length}>
      {groups.map(([s, ps]) => (
        <div key={s} className="kcol">
          <h3>
            {s === 'other' ? <span className="st other">other</span> : <StatusPill status={s} />}
            <span className="n">{ps.length}</span>
          </h3>
          {ps.map((p) => (
            <a key={p.path} className="kcard plink" data-pc={slotOf(p)} href={'#/projects/' + projectSlugOf(p)}>
              <div className="kt">
                <ProjectGlyph project={p} />
                <span>{String(p.data.title || projectSlugOf(p))}</span>
              </div>
              <Beads project={p} count />
            </a>
          ))}
        </div>
      ))}
    </div>
  )
}

// ---- timeline ----

const parseDay = (d: string) => Date.parse(d.slice(0, 10) + 'T00:00:00Z')
const fmtDay = (t: number) => {
  const d = new Date(t)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}
/** Axis from the earliest dated milestone (or today) to the latest (or two weeks after today), on 1st/15th ticks. */
function axisFor(dates: number[], today: number) {
  const lo = Math.min(today, ...dates)
  const hi = Math.max(today + 14 * 864e5, ...dates)
  const snapDown = (t: number) => {
    const d = new Date(t)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() >= 15 ? 15 : 1)
  }
  const snapUp = (t: number) => {
    const d = new Date(t)
    if (d.getUTCDate() < 15) return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 15)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
  }
  const start = snapDown(lo)
  const end = Math.max(snapUp(hi), start + 14 * 864e5)
  const ticks: number[] = []
  for (let t = start; t <= end; t = snapUp(t + 864e5)) ticks.push(t)
  const step = ticks.length > 7 ? 2 : 1
  return { start, end, ticks: ticks.filter((_, i) => i % step === 0) }
}

function TimelineView() {
  const { model } = useHQ()
  const today = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')
  const all = model.projects.flatMap((p) => milestones(p).filter((m) => m.date && /^\d{4}-\d{2}-\d{2}/.test(m.date)).map((m) => parseDay(m.date!)))
  const ax = axisFor(all.filter(Number.isFinite), today)
  const pos = (t: number) => Math.max(0, Math.min(100, (100 * (t - ax.start)) / (ax.end - ax.start)))
  return (
    <div className="w page-enter">
      <div className="fig-scroll">
        <div className="gantt">
          {model.projects.map((p) => {
            const ms = milestones(p)
            const groups = new Map<string, { t: number; done: boolean; items: string[] }>()
            for (const m of ms) {
              if (!m.date || !/^\d{4}-\d{2}-\d{2}/.test(m.date)) continue
              const k = m.date.slice(0, 10) + (m.done ? 'd' : 'p')
              const g = groups.get(k) || { t: parseDay(m.date), done: m.done, items: [] }
              g.items.push(m.text)
              groups.set(k, g)
            }
            const queue = ms.filter((m) => !m.done && !(m.date && /^\d{4}-\d{2}-\d{2}/.test(m.date)))
            const name = String(p.data.title || projectSlug(p))
            return (
              <div key={p.path} className="gantt-row" data-pc={slotOf(p)}>
                <a className="nm" href={'#/projects/' + projectSlugOf(p)}>
                  <ProjectGlyph project={p} />
                  <span>{name}</span>
                </a>
                <div className="gantt-track">
                  <span className="now" style={{ left: pos(today) + '%' }} aria-hidden="true" />
                  {[...groups.values()].map((g) => {
                    const head = `${g.done ? plural(g.items.length, 'done', 'done') : 'Planned'} · ${fmtDay(g.t)}`
                    return (
                      <button
                        key={g.t + (g.done ? 'd' : 'p')}
                        type="button"
                        className={'mb' + (g.done ? ' done' : '')}
                        style={{ left: pos(g.t) + '%' }}
                        data-tipt={head + ': ' + g.items.slice(0, 6).join('; ')}
                        aria-label={`${name}: ${head}: ${g.items.join('; ')}`}
                      >
                        {g.items.length > 1 && <b>{g.items.length}</b>}
                      </button>
                    )
                  })}
                </div>
                <span className="gbreak" aria-hidden="true" />
                <div className="gq" tabIndex={0} data-tipt={queue.length ? 'No date yet: ' + queue.slice(0, 6).map((m) => m.text).join('; ') : 'Nothing waiting without a date'} aria-label={`${name}: ${plural(queue.length, 'milestone')} without a date`}>
                  {queue.slice(0, 6).map((m, i) => (
                    <i key={i} className={i === 0 ? 'first' : ''} />
                  ))}
                  <span>{queue.length}</span>
                </div>
              </div>
            )
          })}
          <div className="gantt-axis" aria-hidden="true">
            <span />
            <div className="ticks">
              {ax.ticks.map((t) => (
                <span key={t} style={{ left: pos(t) + '%' }}>
                  {fmtDay(t)}
                  {t === today ? ' · today' : ''}
                </span>
              ))}
            </div>
            <span />
            <span className="qlab">Queue · no date</span>
          </div>
        </div>
      </div>
      <div className="legend gl">
        <span><i className="lg-dot done" />done</span>
        <span><i className="lg-dot" />planned</span>
        <span><i className="lg-bar" />today</span>
      </div>
    </div>
  )
}
