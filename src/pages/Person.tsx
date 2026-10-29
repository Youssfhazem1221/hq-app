// Person page (module D, blueprint §8.5/8.6/8.12 + spec §6.4). Own page: header tiles from my log settings (this week
// vs last), the global Next (C1's resolver), Check-ins (status, week dots, 12-week heatmap and the ONLY Check in button
// on the page), For you, Time per project (8 weeks) + Energy (own page only), Projects (same 8-week window), Log ("team
// can see", edit own rows ≤7 days, My logging settings). Someone else's page: their status line (with "I can help" when they
// have an open blocker), no For you / Check in / edit / settings. #/people/claude = Claude's work, grouped by person.
// No profile on my own page → "Set up my profile".
import { useMemo, useRef, useState } from 'react'
import { useHQ, usePrefsApi } from '../lib/hq-context'
import { displayName, postMessage, projectSlug, type Model } from '../lib/hq'
import type { Me } from '../lib/source'
import type { NextItem, PageProps, PersonWidget, TileSpec } from '../lib/contracts'
import { appendLog, askForHelp, personCtx, type PersonCtx } from '../lib/people'
import { CLAUDE_LOG_CONFIG, TEAM_TZ, entryLogPath, slugOf, zonedParts, type Entry } from '../lib/people-core'
import { Icon } from '../lib/icons'
import { NextActionsProvider, useNext } from '../components/NextActions'
import { PageHeader } from '../components/shell/PageHeader'
import { Popover, type MenuEntry } from '../components/shell/Popover'
import { colorSlot } from '../components/shell/shell-core'
import { Avatar, Empty, Widget } from '../components/ui'
import { openCheckin, toast } from '../components/toast'
import { WeekDots } from '../components/visuals/WeekDots'
import { Heatmap } from '../components/visuals/Heatmap'
import CheckInSheet from '../components/people/CheckIn'
import ForYouList, { useForYouItems } from '../components/people/ForYouList'
import { LogRows } from '../components/people/LogRows'
import { LogSettings } from '../components/people/LogSettings'
import { Onboarding } from '../components/people/Onboarding'
import { Sheet } from '../components/people/Sheet'
import { EnergyLine, TimeByProject, totalMinutes } from '../components/people/TimeByProject'
import { fmtMinutes, heatCells, moveWidget, personTiles, plural, scaleField, subParts, todayCount, weekCounts, weeklyAverage } from '../components/people/people-ui-core'

export const v3 = true

const same = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
const DEFAULT_ORDER: PersonWidget[] = ['checkins', 'foryou', 'time', 'energy', 'projects', 'log']
const SPAN: Record<PersonWidget, string> = { checkins: 'c7', foryou: 'c5', time: 'c8', energy: 'c4', projects: 'c6', log: 'c6' }
const WIDGET_TITLE: Record<PersonWidget, string> = { checkins: 'Check-ins', foryou: 'For you', time: 'Time per project', energy: 'Energy', projects: 'Projects', log: 'Log' }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export default function Person({ route }: PageProps) {
  return (
    <NextActionsProvider>
      <PersonPage slug={String(route.person || '').toLowerCase()} />
      <CheckInSheet />
    </NextActionsProvider>
  )
}

function PersonPage({ slug }: { slug: string }) {
  const { model, me } = useHQ()
  if (!slug || slug === '@me') return <div className="page-loading" aria-busy="true" />
  if (slug === 'claude') return <ClaudePage />
  const person = model.roster.find((p) => p.slug === slug)
  const login = person?.login || model.knownLogins.find((l) => slugOf(l) === slug) || ''
  const isMe = slugOf(me.login) === slug
  if (isMe && !person)
    return (
      <div className="pp person-page">
        <PageHeader glyph={<Avatar name={me.name || me.login} size={56} />} title={me.name || me.login} sub={<span>No profile yet</span>} />
        <Onboarding />
      </div>
    )
  if (!login)
    return (
      <div className="pp person-page">
        <PageHeader icon="users" title="Not found" />
        <Empty icon="users" text={`No one called "${slug}" is in Pinwheel yet.`}>
          <a className="btn sm" href="#/people">
            Back to People
          </a>
        </Empty>
      </div>
    )
  return <PersonView login={login} isMe={isMe} model={model} me={me} />
}

function PersonView({ login, isMe, model, me }: { login: string; isMe: boolean; model: Model; me: Me }) {
  const prefs = usePrefsApi()
  const now = new Date().toISOString()
  const ctx: PersonCtx = useMemo(() => personCtx(model, login, now, { viewer: me.login }), [model, login, me.login]) // eslint-disable-line react-hooks/exhaustive-deps
  const [settings, setSettings] = useState(false)
  const person = ctx.person
  const name = person?.name || login
  const cfg = ctx.cfg
  const ghost = !person

  const tiles: TileSpec[] = ghost ? [] : personTiles(cfg.tiles, ctx.week.counts, ctx.lastWeek.counts)
  const sub = (ghost ? ['no profile yet'] : subParts(person)).map((s) => <span key={s}>{s}</span>)

  // the global Next on my own page: the same hook as Home/Projects/Tasks (held while its bar fills, so ticking moves all
  // of them together); a check-in nudge stays out: the Check-ins widget has the one button
  const { first } = useNext()
  const next: NextItem | null = isMe && first && first.kind !== 'checkin' ? first : null
  // nothing logged yet on my page: one quiet card instead of three empty ones (time, energy, log)
  const fresh = isMe && !ghost && ctx.entries.length === 0

  const order = (prefs.prefs.person_order?.length ? prefs.prefs.person_order : DEFAULT_ORDER).filter((w) => DEFAULT_ORDER.includes(w))
  const hidden = isMe ? prefs.prefs.person_hidden || [] : []
  const sc = scaleField(cfg)
  const avail = (w: PersonWidget) =>
    fresh && (w === 'time' || w === 'energy') ? false : w === 'foryou' || w === 'energy' ? isMe && !ghost && (w !== 'energy' || !!sc) : true
  const shown = order.filter((w) => avail(w) && !hidden.includes(w))
  const menuFor = (w: PersonWidget): MenuEntry[] | undefined => {
    if (!isMe) return undefined
    const items: MenuEntry[] = [
      { label: 'Move up', icon: 'up', run: () => prefs.apply({ person_order: moveWidget(order, hidden, w, -1) }, `Moved ${WIDGET_TITLE[w]} up`) },
      { label: 'Move down', icon: 'down', run: () => prefs.apply({ person_order: moveWidget(order, hidden, w, 1) }, `Moved ${WIDGET_TITLE[w]} down`) },
      { label: 'Hide on my page', icon: 'eyeOff', run: () => prefs.apply({ person_hidden: [...hidden, w] }, `Hid ${WIDGET_TITLE[w]}`) },
    ]
    if (w === 'log') items.unshift({ label: 'My logging settings', icon: 'gear', run: () => setSettings(true) })
    return items
  }

  const today = zonedParts(now, ctx.tz).date
  const yesterday = zonedParts(new Date(Date.parse(now) - 864e5).toISOString(), ctx.tz).date
  const W: Record<PersonWidget, () => React.ReactNode> = {
    checkins: () => <CheckinsWidget ctx={ctx} isMe={isMe} menu={menuFor('checkins')} now={now} />,
    foryou: () => <ForYouWidget menu={menuFor('foryou')} />,
    time: () => (
      <Widget id="time" title="Time per project" icon="chart" menu={menuFor('time')} secondary className="pw-chart">
        <TimeByProject time={ctx.time} model={model} empty={isMe ? 'Log time like “45m +project” and a weekly chart appears here.' : `${name} hasn't logged time yet.`} />
      </Widget>
    ),
    energy: () =>
      sc ? (
        <Widget id="energy" title={sc.label} icon="leaf" menu={menuFor('energy')} secondary className="pw-chart" chip={<span className="chip line" data-tipt="Only you see this chart">only you</span>}>
          <EnergyLine field={sc} weeks={ctx.time.map((w) => w.week)} data={weeklyAverage(ctx.entries, cfg, sc.key, ctx.time.map((w) => w.week))} />
        </Widget>
      ) : null,
    projects: () => <ProjectsWidget ctx={ctx} model={model} menu={menuFor('projects')} />,
    log: () => (
      <Widget
        id="log"
        title={`Log · ${MONTHS[Number(today.slice(5, 7)) - 1] || ''}`}
        icon="learned"
        menu={menuFor('log')}
        act={
          <span className="chip line" data-tipt="Everyone on the team and Pinwheel's AI can read logs">
            <Icon name="eye" />
            team can see
          </span>
        }
      >
        {ctx.entries.length ? (
          <LogRows entries={ctx.entries} cfg={cfg} slug={ctx.slug} mine={isMe} today={today} yesterday={yesterday} />
        ) : (
          <Empty icon="learned" text={isMe ? 'Your first check-in starts this log and the time and energy charts.' : `${name} hasn't logged anything yet.`} />
        )}
      </Widget>
    ),
  }

  return (
    <div className="pp person-page">
      <PageHeader glyph={<Avatar name={name} size={56} />} title={name} sub={sub} tiles={tiles} next={next} />
      {!isMe && !ghost && <StatusLine ctx={ctx} me={me} />}
      {isMe && ctx.openBlockers.length > 0 && <Blockers ctx={ctx} model={model} me={me} />}
      <div className="grid pgrid">
        {shown.map((w) => {
          const node = W[w]()
          if (!node) return null
          const span = !isMe && (w === 'checkins' || w === 'time') ? 'c6' : SPAN[w]
          return (
            <div className={span} key={w}>
              {node}
            </div>
          )
        })}
      </div>
      {isMe && hidden.length > 0 && (
        <p className="hint pp-hidden">
          {plural(hidden.length, 'block')} hidden on your page ·{' '}
          <button className="more" type="button" onClick={() => prefs.apply({ person_hidden: [] }, 'Showed every block')}>
            Show all
          </button>
        </p>
      )}
      {settings && (
        <Sheet open onClose={() => setSettings(false)} labelledBy="ls-title" wide>
          <LogSettings onDone={() => setSettings(false)} />
        </Sheet>
      )}
    </div>
  )
}

// ---- widgets ----

function CheckinsWidget({ ctx, isMe, menu, now }: { ctx: PersonCtx; isMe: boolean; menu?: MenuEntry[]; now: string }) {
  const wk = weekCounts(ctx.entries, ctx.cfg, ctx.tz, now)
  const heat = heatCells(ctx.entries, ctx.cfg, ctx.tz, now, 12)
  const n = todayCount(ctx.entries, ctx.tz, now)
  const goal = ctx.goals.find((g) => g.goal.metric === 'checkins')
  return (
    <Widget
      id="checkins"
      title="Check-ins"
      icon="cal"
      menu={menu}
      act={
        isMe ? (
          // not primary: the page's one primary action is its Next (mock: ciBtn = btn sm)
          <button className="btn sm" type="button" onClick={() => openCheckin()}>
            <Icon name="plus" size="s" />
            Check in
            <span className="kbd">L</span>
          </button>
        ) : undefined
      }
    >
      <div className="wk-top">
        <span className={'cistate' + (n ? ' ok' : ctx.quiet ? ' quiet' : '')}>
          <i aria-hidden="true" />
          {n ? `${plural(n, 'check-in')} today` : ctx.lastCheckin ? 'Not logged today' : 'No check-ins yet'}
        </span>
        {goal && (
          <span className="hint">
            {goal.actual >= goal.goal.target ? `${goal.actual} this ${goal.goal.per === 'week' ? 'week' : 'month'} · goal ${goal.goal.target} met` : goal.label}
          </span>
        )}
      </div>
      <div className="ci-pics">
        <div className="ci-week">
          <WeekDots counts={wk.counts} today={wk.today} start={ctx.cfg.week_starts} />
        </div>
        {heat.total > 0 && (
          <div className="ci-heat">
            <p className="hint">12 weeks</p>
            <Heatmap cells={heat.cells} start={heat.start} label="12 weeks of check-ins" />
          </div>
        )}
      </div>
    </Widget>
  )
}

function ForYouWidget({ menu }: { menu?: MenuEntry[] }) {
  const { items } = useForYouItems(false)
  return (
    <Widget id="foryou" title="For you" icon="inbox" count={items.length || null} menu={menu}>
      <ForYouList limit={4} />
    </Widget>
  )
}

function ProjectsWidget({ ctx, model, menu }: { ctx: PersonCtx; model: Model; menu?: MenuEntry[] }) {
  const totals = new Map<string, number>()
  for (const w of ctx.time) for (const [k, v] of Object.entries(w.byProject)) totals.set(k, (totals.get(k) || 0) + v)
  const max = Math.max(1, ...totals.values())
  const anyTime = totalMinutes(ctx.time) > 0
  const open = (slug: string) => model.todos.filter((t) => same(t.data.owner, ctx.login) && String(t.data.status || 'todo') !== 'done' && t.data.project === slug).length
  return (
    <Widget id="projects" title="Projects" icon="projects" count={ctx.projects.length || null} menu={menu} secondary>
      {ctx.projects.length ? (
        <>
          <div className="rows" role="list">
            {ctx.projects.map((p) => {
              const d = model.projects.find((x) => projectSlug(x) === p.slug)
              const m = totals.get(p.slug) || 0
              const o = open(p.slug)
              return (
                <a className="row prow" role="listitem" key={p.slug} href={'#/projects/' + p.slug}>
                  <i className={'pdot pc' + colorSlot(d?.data.color)} aria-hidden="true" />
                  <span className="t">{p.title}</span>
                  <span className="meta">
                    {(p.part || p.role !== 'owner') && (
                      <span className="chip line hide-m">
                        <Icon name={p.role === 'owner' ? 'flag' : 'users'} />
                        {p.part || p.role}
                      </span>
                    )}
                    {o > 0 && <span>{plural(o, 'open to-do')}</span>}
                    {anyTime && (
                      <>
                        <span className={'pmeter hide-m pc' + colorSlot(d?.data.color)} aria-hidden="true">
                          <i style={{ width: `${Math.round((m / max) * 100)}%` }} />
                        </span>
                        <span className="num pm-h">{fmtMinutes(m) || '0 h'}</span>
                      </>
                    )}
                  </span>
                </a>
              )
            })}
          </div>
          {anyTime && <p className="hint">Time · last 8 weeks (same as the chart)</p>}
        </>
      ) : (
        <p className="sm muted">Not on a project yet. Owners add people; ask to join from a project's page.</p>
      )}
    </Widget>
  )
}

/** Someone else's page: the blueprint status line, with "I can help" when they have an open blocker. */
function StatusLine({ ctx, me }: { ctx: PersonCtx; me: Me }) {
  const { source, reload } = useHQ()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const blocker = ctx.openBlockers[0]
  const what = blocker ? String(Object.values(blocker.fields || {}).find((v) => typeof v === 'string' && v.trim()) || 'their blocker') : ''
  const name = ctx.person?.name || ctx.login
  const send = async () => {
    if (busy) return
    setBusy(true)
    try {
      await postMessage(source, me, { type: 'question', forClaude: false, to: ctx.login, project: blocker?.project || undefined, body: `I can help with: ${what}` })
      toast(`Sent to ${name} · it shows in their For you`, 'ok')
      setOpen(false)
      await reload()
    } catch (e: any) {
      toast(String(e?.message || e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="pp-status" role="note">
      <Icon name="user" />
      <span>{ctx.next.text}</span>
      {ctx.next.action === 'help' && blocker && (
        <>
          <button ref={btn} className="btn sm" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <Icon name="users" size="s" />
            I can help
          </button>
          <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} role="dialog" label={`Tell ${name} you can help`} width={300}>
            <div className="fy-rev">
              <p>
                Send {name} a note on the Board: <b>“I can help with: {what}”</b>
              </p>
              <div className="pp-ctrl">
                <button className="btn primary sm" type="button" onClick={send} disabled={busy}>
                  Send
                </button>
                <button className="btn ghost sm" type="button" onClick={() => setOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </Popover>
        </>
      )}
      <span style={{ flex: 1 }} />
      <span className="hint">Logs are self-reported</span>
    </div>
  )
}

/** My open blockers: mark one unblocked (a 🔓 row that points at it) or ask a teammate (a help to-do in their For you). */
function Blockers({ ctx, model, me }: { ctx: PersonCtx; model: Model; me: Me }) {
  const { source, reload } = useHQ()
  const [busy, setBusy] = useState(false)
  const textOf = (e: Entry) => String(Object.values(e.fields || {}).find((v) => typeof v === 'string' && v.trim()) || 'blocked')
  const mates = model.roster.filter((p) => p.status === 'active' && !same(p.login, me.login))
  const unblock = async (e: Entry) => {
    if (busy) return
    setBusy(true)
    try {
      const textKey = ctx.cfg.fields.find((f) => f.type === 'text')?.key || 'did'
      await appendLog(source, me, { at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), kind: 'unblocked', project: e.project, fields: { [textKey]: `unblocked: ${textOf(e)}`.slice(0, 280) }, ref: ['↳ ' + e.when] }, { cfg: ctx.cfg, tz: ctx.tz })
      toast('Marked unblocked', 'ok')
      await reload()
    } catch (x: any) {
      toast(String(x?.message || x), 'error')
    } finally {
      setBusy(false)
    }
  }
  const ask = async (e: Entry, to: string) => {
    if (busy || !to) return
    setBusy(true)
    try {
      await askForHelp(source, me, { logPath: entryLogPath(ctx.slug, e), when: e.when, to, title: textOf(e), project: e.project || undefined })
      toast(`Asked ${displayName(model, to)} · it shows in their For you`, 'ok')
      await reload()
    } catch (x: any) {
      toast(String(x?.message || x), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="w pp-block" aria-labelledby="pb-h">
      <div className="wh">
        <h2 id="pb-h">
          <Icon name="blocked" />
          <span>Open blockers</span>
          <span className="count">{ctx.openBlockers.length}</span>
        </h2>
      </div>
      <div className="rows" role="list">
        {ctx.openBlockers.slice(0, 4).map((e) => {
          const key = `${entryLogPath(ctx.slug, e)}#${e.when}`
          const help = model.todos.find((t) => String(t.data.blocker || '') === key && String(t.data.status || 'todo') !== 'done')
          const asked = help ? { on: String(help.data.owner || '') } : null
          return (
            <div className="row" role="listitem" key={e.when}>
              <span className="kind k-blocked" aria-hidden="true">
                <Icon name="blocked" />
              </span>
              <span className="t">{textOf(e)}</span>
              <span className="meta">
                {asked ? <span>waiting on {displayName(model, asked.on)}</span> : null}
                <button className="btn sm" type="button" onClick={() => unblock(e)} disabled={busy}>
                  Unblocked
                </button>
                {!asked && mates.length > 0 && (
                  <select className="inp sm" aria-label={`Ask a teammate about: ${textOf(e)}`} value="" disabled={busy} onChange={(x) => ask(e, x.target.value)}>
                    <option value="">Ask…</option>
                    {mates.map((p) => (
                      <option key={p.login} value={p.login}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ---- Claude ----

function ClaudePage() {
  const { model } = useHQ()
  const now = new Date().toISOString()
  const entries = model.logEntries.get('claude') || []
  const work = model.events.filter((e) => same(e.actor, 'claude') && (e.kind === 'claude.run' || e.kind === 'claude.log' || e.kind === 'todo.done' || e.kind === 'post' || e.kind === 'todo.created'))
  const groups = new Map<string, typeof work>()
  for (const e of [...work].sort((a, b) => (a.at < b.at ? 1 : -1))) {
    const k = e.for || String(e.fields?.owner || '') || ''
    groups.set(k, [...(groups.get(k) || []), e])
  }
  const today = zonedParts(now, TEAM_TZ).date
  const yesterday = zonedParts(new Date(Date.parse(now) - 864e5).toISOString(), TEAM_TZ).date
  const word: Record<string, string> = { 'claude.run': 'answered', 'claude.log': 'logged', 'todo.done': 'finished', post: 'posted', 'todo.created': 'wrote a to-do' }
  return (
    <div className="pp person-page">
      <PageHeader glyph={<Avatar name="Claude" size={56} bot />} title="Claude" sub={[<span key="a">AI helper</span>, <span key="b">not in team numbers</span>]} />
      <div className="grid pgrid">
        <div className="c6">
          <Widget id="work" title="Work for people" icon="bot" count={work.length || null}>
            {groups.size ? (
              [...groups.entries()].map(([who, evs]) => (
                <div className="cl-group" key={who || '-'}>
                  <h3 className="hint">{who ? `For ${displayName(model, who)}` : 'For the team'}</h3>
                  <div className="rows" role="list">
                    {evs.slice(0, 6).map((e) => (
                      <div className="row" role="listitem" key={e.id}>
                        <span className="t sm">
                          <span className="muted">{word[e.kind] || e.kind} · </span>
                          {e.title}
                        </span>
                        <span className="meta">{e.at ? e.at.slice(0, 10) : 'date unknown'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="sm muted">Nothing yet. Flag a Board post for Claude and its work shows here.</p>
            )}
          </Widget>
        </div>
        <div className="c6">
          <Widget id="log" title="Claude's log" icon="learned">
            {entries.length ? <LogRows entries={entries} cfg={CLAUDE_LOG_CONFIG} slug="claude" mine={false} today={today} yesterday={yesterday} /> : <p className="sm muted">No log rows yet.</p>}
          </Widget>
        </div>
      </div>
    </div>
  )
}
