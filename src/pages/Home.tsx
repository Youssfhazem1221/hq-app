// Home (spec §6.1): the Next sentence IS the headline. Small greeting + ≤2 tiles → hero Next with "Then …" → Ask bar
// (2 suggestion chips from the workspace, 2 more on focus) → For you (D's list) + My week (my own check-ins: today's
// state, week dots, time by project; Check in in its header) → project tiles (beads as one picture) → Recent changes in
// human words. Widget ⋯ = Move up / Move down / Hide on Home (look prefs home_order / home_hidden). No sample data.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useHQ, usePrefsApi } from '../lib/hq-context'
import type { HomeWidget, PageProps } from '../lib/contracts'
import { Icon } from '../lib/icons'
import { askAnywhere } from '../lib/router'
import { rememberFocus } from '../lib/focus'
import { displayName, milestones } from '../lib/hq'
import type { Doc } from '../lib/md'
import type { Commit } from '../lib/source'
import { entryMinutes, weekStart, zonedParts, type Entry } from '../lib/people-core'
import { localTz } from '../lib/people'
import { nextFor, projectSlugOf } from '../lib/next-core'
import { PageHeader } from '../components/shell/PageHeader'
import { Avatar, StatusPill, Toggle, Widget } from '../components/ui'
import type { MenuEntry } from '../components/shell/Popover'
import { Beads } from '../components/visuals/Beads'
import { WeekDots } from '../components/visuals/WeekDots'
import ForYouList, { useForYouItems } from '../components/people/ForYouList'
import { NextActionsProvider, nextOpts, useNext } from '../components/NextActions'
import { openCheckin } from '../components/toast'
import { AgeTip, ProjectGlyph, StaleDot, humanChange, plural, same, shortAgo, shortTitle, slotOf } from '../components/work-ui'

export const v3 = true

const ALL: HomeWidget[] = ['ask', 'foryou', 'week', 'projects', 'activity']
const NAME: Record<HomeWidget, string> = { ask: 'Ask bar', foryou: 'For you', week: 'My week', projects: 'Projects', activity: 'Recent changes' }
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const fmtH = (min: number) => {
  const h = min / 60
  return (h >= 10 ? Math.round(h) : Math.round(h * 10) / 10) + ' h'
}

export default function HomePage(_: PageProps) {
  return (
    <NextActionsProvider>
      <Home />
    </NextActionsProvider>
  )
}

/** My week from my own log: per-day check-ins (week order, future days null), minutes per project, today's rows. */
function useMyWeek() {
  const { model, me } = useHQ()
  return useMemo(() => {
    const person = model.roster.find((p) => same(p.login, me.login))
    const tz = person?.timezone || localTz()
    const now = new Date().toISOString()
    const z = zonedParts(now, tz)
    const starts = person?.log?.week_starts || 'sun'
    const start = weekStart(z.date, starts) || z.date
    const rows: Entry[] = person ? model.logEntries.get(person.slug) || [] : []
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
    const counts = days.map((d) => (d > z.date ? null : rows.filter((r) => r.date === d).length))
    const week = rows.filter((r) => r.date >= start && r.date <= z.date)
    const byProject = new Map<string, number>()
    for (const r of week) {
      const m = entryMinutes(r.fields, person?.log)
      if (m > 0) byProject.set(r.project || '', (byProject.get(r.project || '') || 0) + m)
    }
    const minutes = [...byProject.values()].reduce((a, b) => a + b, 0)
    return { person, tz, z, start: starts, counts, today: counts.findIndex((_, i) => days[i] === z.date), todayRows: rows.filter((r) => r.date === z.date).length, byProject, minutes }
  }, [model, me])
}

function Home() {
  const { model, me, source, loadedAt } = useHQ()
  const { prefs, apply } = usePrefsApi()
  const { first, then } = useNext()
  const wk = useMyWeek()
  // the same items D's list shows (seen state as it was when the page opened)
  const fyCount = useForYouItems(false).items.length
  const [acts, setActs] = useState<Commit[] | null>(null)
  useEffect(() => {
    let off = false
    source
      .activity()
      .then((c) => !off && setActs(c))
      .catch(() => !off && setActs([]))
    return () => {
      off = true
    }
  }, [source, loadedAt])

  // greeting in my time zone
  const hour = Number(wk.z.hm.slice(0, 2))
  const part = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const first0 = (wk.person?.name || displayName(model, me.login) || me.name || '').split(/\s+/)[0]
  const d = wk.z.date
  const when = d ? `${DOW[wk.z.dow] || ''} ${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]} · ${wk.z.hm}` : ''
  const ms = model.projects.flatMap(milestones)
  const done = ms.filter((m) => m.done).length

  // widgets
  const order = (prefs.home_order?.length ? prefs.home_order : ALL).filter((w) => ALL.includes(w))
  const hidden = (prefs.home_hidden || []).filter((w) => ALL.includes(w))
  const visible = order.filter((w) => !hidden.includes(w))
  const menu = (w: HomeWidget): MenuEntry[] => {
    const i = order.indexOf(w)
    const move = (dir: number) => {
      const o = order.slice()
      const j = Math.max(0, Math.min(o.length - 1, i + dir))
      o.splice(i, 1)
      o.splice(j, 0, w)
      apply({ home_order: o }, 'Moved ' + NAME[w])
    }
    return [
      { label: 'Move up', icon: 'up', run: () => move(-1), disabled: i <= 0 },
      { label: 'Move down', icon: 'down', run: () => move(1), disabled: i >= order.length - 1 },
      { label: 'Hide on Home', icon: 'eyeOff', run: () => apply({ home_hidden: [...hidden, w] }, 'Hid ' + NAME[w]) },
    ]
  }
  const pairs = (w: HomeWidget) => {
    const i = visible.indexOf(w)
    const other = w === 'foryou' ? 'week' : w === 'week' ? 'foryou' : null
    return other !== null && Math.abs(visible.indexOf(other) - i) === 1 && visible.includes(other)
  }
  const span = (w: HomeWidget) => (pairs(w) ? (w === 'foryou' ? 'g7' : 'g5') : 'g12')

  const W: Record<HomeWidget, ReactNode> = {
    ask: <AskBar />,
    foryou: (
      <Widget id="foryou" title="For you" icon="inbox" count={fyCount || null} menu={menu('foryou')} act={<a className="btn ghost sm" href="#/tasks">All</a>}>
        <ForYouList limit={6} />
      </Widget>
    ),
    week: <MyWeek wk={wk} menu={menu('week')} />,
    projects: <ProjectTiles menu={menu('projects')} />,
    activity: (
      <Widget id="activity" title="Recent changes" icon="history" secondary menu={menu('activity')}>
        {acts === null ? (
          <p className="sm muted">Loading…</p>
        ) : acts.length ? (
          <Toggle title={<span className="sm">{plural(acts.length, 'change')} · last {shortAgo(acts[0].date)} ago</span>}>
            <div className="rows">
              {acts.slice(0, 6).map((c) => (
                <div key={c.sha} className="row">
                  <Avatar name={displayName(model, c.actor)} bot={/^(claude|hq-ai|hq-digest)$/i.test(c.actor)} size={24} />
                  <span className="t sm">{humanChange(c, (l) => displayName(model, l))}</span>
                  <span className="meta">
                    <AgeTip model={model} iso={c.date} />
                  </span>
                </div>
              ))}
            </div>
          </Toggle>
        ) : (
          <p className="sm muted">No history yet. It appears once the notes are in git.</p>
        )}
      </Widget>
    ),
  }

  return (
    <div className="work-page home">
      <PageHeader
        hero
        title="Home"
        sub={
          <>
            {part}
            {first0 ? ', ' + first0 : ''} <span>{when}</span>
          </>
        }
        tiles={[
          ms.length ? { value: <>{done}<small>/{ms.length}</small></>, label: 'milestones done' } : null,
          wk.minutes > 0 ? { value: fmtH(wk.minutes), label: 'this week' } : null,
        ]}
        next={first}
        then={then}
      />
      {/* Focus mode: ONE count of what is hidden (focus-hidden blocks + blocks hidden on Home) */}
      <FocusBar n={visible.filter((w) => w === 'week' || w === 'projects' || w === 'activity').length + hidden.length} />
      <div className="wg">
        {visible.map((w) => (
          <div key={w} className={span(w) + (w === 'ask' ? '' : ' hw')} data-hw={w}>
            {W[w]}
          </div>
        ))}
      </div>
      {hidden.length > 0 && prefs.focus !== 'on' && (
        <p className="hint hidden-note">
          {hidden.length} hidden on Home ·{' '}
          <button className="more" type="button" onClick={() => apply({ home_hidden: [] }, 'Showing all blocks')}>
            Show all
          </button>
        </p>
      )}
    </div>
  )
}

function FocusBar({ n }: { n: number }) {
  const { apply } = usePrefsApi()
  if (!n) return null
  return (
    <div className="focusbar">
      <Icon name="focus" />
      <span>
        <b>Focus mode</b> · {plural(n, 'block')} hidden
      </span>
      <span className="sp" />
      <button className="btn sm" type="button" onClick={() => apply({ focus: 'off' }, 'Focus mode off')}>
        Exit focus
      </button>
    </div>
  )
}

// ---- Ask bar ----

function AskBar() {
  const { model } = useHQ()
  const [q, setQ] = useState('')
  const optDoc = model.knowledge.find((d) => Array.isArray(d.data.options) && d.data.options.length > 0)
  const withNumbers = model.projects.find((p) => Array.isArray(p.data.metrics) && p.data.metrics.length > 0)
  const sugg = [
    'What’s waiting on me?',
    'Where is each project?',
    ...(optDoc ? [`Compare the options in “${String(optDoc.data.title || '').replace(/^[^:]*:\s*/, '') || 'my notes'}”`] : []),
    ...(withNumbers ? [`Chart ${String(withNumbers.data.title || 'my')} numbers`] : []),
  ]
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (q.trim()) askAnywhere(q.trim())
  }
  return (
    <section className="w flat askw" data-w="ask" aria-label="Ask HQ">
      <form className="askbar" onSubmit={submit}>
        <Icon name="spark" />
        <label className="sr" htmlFor="homeask">
          Ask HQ
        </label>
        <input id="homeask" placeholder="Ask HQ anything…" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
        {/* primary only once there is a question: the hero Next is the screen's one primary button */}
        <button className={'btn sm' + (q.trim() ? ' primary' : '')} type="submit">
          Ask
        </button>
      </form>
      <div className="sugg">
        {sugg.map((s, i) => (
          <button key={s} className={'qchip' + (i > 1 ? ' more-s' : '')} type="button" onClick={() => askAnywhere(s)}>
            {s}
          </button>
        ))}
      </div>
    </section>
  )
}

// ---- My week ----

function MyWeek({ wk, menu }: { wk: ReturnType<typeof useMyWeek>; menu: MenuEntry[] }) {
  const { model, me } = useHQ()
  const checkin = () => {
    rememberFocus()
    openCheckin()
  }
  const mine = model.projects.find((p) => same(p.data.owner, me.login) && String(p.data.status) === 'active') || model.projects[0]
  const token = mine ? '+' + projectSlugOf(mine).split('-')[0] : '+project'
  const parts = [...wk.byProject.entries()].filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1])
  const pDoc = (slug: string) => model.projects.find((p) => projectSlugOf(p) === slug)
  const name = (slug: string) => (slug ? shortTitle(pDoc(slug), slug) : 'Other')
  return (
    <Widget
      id="week"
      title="My week"
      icon="cal"
      secondary
      menu={menu}
      act={
        <button className="btn sm" type="button" onClick={checkin}>
          <Icon name="plus" size="s" />
          Check in
          <span className="kbd">L</span>
        </button>
      }
    >
      <div className="wk-top">
        {wk.todayRows ? (
          <span className="cistate ok">
            <i />
            {plural(wk.todayRows, 'check-in')} today
          </span>
        ) : (
          <span className="cistate">
            <i />
            Not logged today
          </span>
        )}
      </div>
      <WeekDots counts={wk.counts} today={wk.today >= 0 ? wk.today : undefined} start={wk.start} />
      {parts.length ? (
        <div className="tbp">
          <div
            className="tbar"
            role="img"
            aria-label={'This week: ' + parts.map(([s, m]) => `${name(s)} ${fmtH(m)}`).join(', ')}
          >
            {parts.map(([s, m]) => (
              <span key={s} data-pc={slotOf(pDoc(s))} style={{ flexGrow: m }} data-tipt={`${name(s)} · ${fmtH(m)} this week`} />
            ))}
          </div>
          <div className="legend">
            {parts.map(([s, m]) => (
              <span key={s}>
                <i data-pc={slotOf(pDoc(s))} />
                {name(s)} {fmtH(m)}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="sm muted wk-hint">Log time like “45m {token}” to see where your week goes.</p>
      )}
    </Widget>
  )
}

// ---- project tiles ----

function ProjectTiles({ menu }: { menu: MenuEntry[] }) {
  const { model, me } = useHQ()
  const opts = useMemo(() => nextOpts(model, me), [model, me])
  const isMine = (p: Doc) => same(p.data.owner, me.login) || (Array.isArray(p.data.members) && p.data.members.some((x: unknown) => same(x, me.login)))
  const ps = [...model.projects.filter(isMine), ...model.projects.filter((p) => !isMine(p))]
  const shown = ps.slice(0, 8)
  return (
    <Widget id="projects" title="Projects" icon="projects" count={model.projects.length || null} secondary menu={menu} act={<a className="btn ghost sm" href="#/projects">All</a>}>
      {shown.length ? (
        <div className="ptiles">
          {shown.map((p) => {
            const slug = projectSlugOf(p)
            const it = nextFor(model, me, slug, Date.now(), opts)
            return (
              <a key={p.path} className="ptile" data-pc={slotOf(p)} href={'#/projects/' + slug}>
                <div className="ptile-h">
                  <ProjectGlyph project={p} />
                  <b>{String(p.data.title || slug)}</b>
                  <StatusPill status={p.data.status} />
                </div>
                <Beads project={p} count />
                {it && (
                  <div className="nx">
                    <Icon name="arrow" />
                    <span>{it.text}</span>
                  </div>
                )}
                <StaleDot updated={p.data.updated} />
              </a>
            )
          })}
        </div>
      ) : (
        <p className="sm muted">No projects yet.</p>
      )}
      {ps.length > shown.length && (
        <a className="more" href="#/projects">
          +{ps.length - shown.length} more
        </a>
      )}
    </Widget>
  )
}
