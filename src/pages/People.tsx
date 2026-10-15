// People (module D, blueprint §8.1–8.4 + spec §6.4): tabs Team · Together. Team = real cards (me first, Claude as a
// helper, known logins without a profile as ghost cards) + "Waiting on whom". Cards never compare people: no counts
// except a person's own open blockers. No profile yet → "Set up my profile" replaces my card. Together = team and
// pairs over the last 14 days. Dev only: "Preview layout" shows a made-up team under a "Sample layout" watermark; it
// is display data and never reaches the roster, For you, pickers or the AI.
import { useMemo, useState } from 'react'
import { useHQ } from '../lib/hq-context'
import { displayName, projectSlug, type Model } from '../lib/hq'
import type { Me } from '../lib/source'
import type { NextItem, PageProps } from '../lib/contracts'
import { forYouFor } from '../lib/people'
import { blockerOpen, collabHints, collabStats, entryLogPath, isBot, projectsOf, slugOf, teamMatrix, waitingOn } from '../lib/people-core'
import { nextQueue } from '../lib/next-core'
import { go } from '../lib/router'
import { Icon } from '../lib/icons'
import { NextActionsProvider } from '../components/NextActions'
import { PageHeader } from '../components/shell/PageHeader'
import { colorSlot } from '../components/shell/shell-core'
import { Avatar, Switch, Widget } from '../components/ui'
import { openCheckin } from '../components/toast'
import CheckInSheet from '../components/people/CheckIn'
import { JoinGuideButton } from '../components/people/JoinGuide'
import { Onboarding } from '../components/people/Onboarding'
import { Sheet } from '../components/people/Sheet'
import { Together } from '../components/people/Together'
import {
  freshWord, peopleSoFar, plural, subParts, togetherTiles, waitWhat, type PersonCardView, type SampleTeam, type TogetherData, type WaitView,
} from '../components/people/people-ui-core'

export const v3 = true

const same = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
const DAY_MS = 864e5

/** Team cards from the model: active profiles (me first), then ghosts (known logins without a profile). */
export function teamCards(model: Model, me: Me, now: string): PersonCardView[] {
  const card = (login: string, name: string, slug: string, sub: string[], ghost: boolean): PersonCardView => {
    const person = model.roster.find((p) => same(p.login, login))
    const entries = model.logEntries.get(slug) || []
    const last = entries.map((e) => e.at).filter(Boolean).sort().pop() || null
    const blockers = person ? entries.filter((e) => e.kind === 'blocked' && blockerOpen(e, entryLogPath(slug, e), entries, model.todos)).length : 0
    const waits = waitingOn(model.all, model.logEntries, now).filter((w) => same(w.waiter, login))
    return {
      login, slug, name, sub, ghost, me: same(login, me.login),
      fresh: person ? freshWord(last, person.timezone, now, person.log.nudge_days) : null,
      on: projectsOf(login, model.all).filter((p) => p.status !== 'done').map((p) => {
        const d = model.projects.find((x) => projectSlug(x) === p.slug)
        return { slug: p.slug, title: p.title, role: p.role, part: p.part, color: colorSlot(d?.data.color) }
      }),
      blockers,
      // whom their open blockers wait on (hand-offs and posts are not blockers)
      waitsOn: [...new Set(waits.filter((w) => waitWhat(w.what).blocker).map((w) => displayName(model, w.on)))],
      askMeAbout: person?.askMeAbout || [],
    }
  }
  const people = model.roster.filter((p) => p.status === 'active')
  const out = people.map((p) => card(p.login, p.name, p.slug, subParts(p).filter((x) => x !== p.role), false))
  out.sort((a, b) => Number(!!b.me) - Number(!!a.me))
  for (const l of model.knownLogins) {
    if (isBot(l) || model.roster.some((p) => same(p.login, l))) continue
    out.push(card(l, l, slugOf(l), ['no profile yet'], true))
  }
  return out
}

/** "Waiting on whom": open waits, oldest first, ≤8. */
export function waitRows(model: Model, now: string): WaitView[] {
  return waitingOn(model.all, model.logEntries, now)
    .sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0))
    .slice(0, 8)
    .map((w) => ({ who: w.waiter, on: w.on, what: w.what, since: ageText(w.since, now) }))
}

/** The Together tab's data (last 14 days; team and pairs only). */
export function togetherOf(model: Model, now: string): TogetherData {
  const from = new Date(Date.parse(now) - 14 * DAY_MS).toISOString()
  const people = model.roster.filter((p) => p.status === 'active' && !isBot(p.login)).length
  try {
    const stats = collabStats(model.events, model.all, model.roster, from, now)
    const m = teamMatrix(model.events, model.roster, model.all, 14, now)
    const columns = [...new Set(Object.values(m.cells).flatMap((r) => Object.keys(r)))]
    const ordered = [...columns.filter((c) => c !== 'claude'), ...columns.filter((c) => c === 'claude')]
    return { people, tiles: togetherTiles(stats.team), columns: ordered, projects: m.projects, cells: m.cells, pairs: stats.pairs, ideas: collabHints(model.roster, model.all, stats, now) }
  } catch {
    return { people, tiles: [], columns: [], projects: [], cells: {}, pairs: [], ideas: [] }
  }
}

function ageText(since: string, now: string) {
  const h = (Date.parse(now) - Date.parse(since)) / 36e5
  if (!Number.isFinite(h)) return ''
  return h < 1 ? 'just now' : h < 24 ? `${Math.floor(h)} h` : plural(Math.floor(h / 24), 'day')
}

export default function People({ route }: PageProps) {
  return (
    <NextActionsProvider>
      <PeoplePage tab={route.tab === 'together' ? 'together' : 'team'} />
      <CheckInSheet />
    </NextActionsProvider>
  )
}

function PeoplePage({ tab }: { tab: 'team' | 'together' }) {
  const { model, me } = useHQ()
  const now = new Date().toISOString()
  const mine = model.roster.find((p) => same(p.login, me.login))
  const [obOpen, setObOpen] = useState(!mine)
  const [update, setUpdate] = useState(false)
  const [sample, setSample] = useState<SampleTeam | null>(null)
  const [preview, setPreview] = useState(false)
  const cards = useMemo(() => teamCards(model, me, now), [model, me]) // eslint-disable-line react-hooks/exhaustive-deps
  const waits = useMemo(() => waitRows(model, now), [model]) // eslint-disable-line react-hooks/exhaustive-deps
  const together = useMemo(() => (tab === 'together' ? togetherOf(model, now) : null), [model, tab]) // eslint-disable-line react-hooks/exhaustive-deps
  const real = cards.filter((c) => !c.ghost).length

  // Next: only a real item for me (someone blocked asked me · a join/leave request on my project)
  const next: NextItem | null = useMemo(() => {
    try {
      const q = nextQueue(model, me, Date.now(), { forYou: forYouFor(model, me), nameOf: (l) => displayName(model, l) }) as NextItem[]
      return q.find((x) => x.kind === 'help' || x.kind === 'join') || null
    } catch {
      return null
    }
  }, [model, me])

  const togglePreview = async (on: boolean) => {
    if (!import.meta.env.DEV) return
    if (on && !sample) {
      const m = await import('../dev/sample-team')
      setSample(m.SAMPLE_TEAM)
    }
    setPreview(on)
  }
  const showSample = import.meta.env.DEV && preview && !!sample
  const nameOf = (l: string) => (showSample && sample!.cards.some((c) => c.login === l) ? l : displayName(model, l))
  const titleOf = (s: string) => String(model.projects.find((d) => projectSlug(d) === s)?.data.title || s)

  const sub = [peopleSoFar(real), real < 2 ? 'Teammates appear here once they set up a profile' : ''].filter(Boolean).map((x) => <span key={x}>{x}</span>)

  return (
    <div className="pp people-page">
      <PageHeader icon="users" title="People" sub={sub} next={next} />
      <div className="pp-toolbar">
        <div className="seg" role="tablist" aria-label="People views">
          <button type="button" role="tab" aria-selected={tab === 'team'} onClick={() => go('/people')}>
            <Icon name="users" />
            Team
          </button>
          <button type="button" role="tab" aria-selected={tab === 'together'} onClick={() => go('/people/_team')}>
            <Icon name="link" />
            Together
          </button>
        </div>
        <span style={{ flex: 1 }} />
        {mine && (
          <button className="btn ghost sm" type="button" onClick={() => setUpdate(true)}>
            <Icon name="user" size="s" />
            Update my profile
          </button>
        )}
        <JoinGuideButton />
        {import.meta.env.DEV && (
          <span className="sm muted swl">
            Preview layout
            <Switch on={preview} onChange={togglePreview} label="Preview the layout with a sample team (dev only)" />
          </span>
        )}
      </div>

      {showSample && (
        <div className="smark" role="note">
          <Icon name="eye" size="s" />
          <b>Sample layout</b> These people are made up. Real teammates appear once they set up a profile.
        </div>
      )}

      {tab === 'team' ? (
        <div className="pp-team">
          {(!mine || obOpen) && <Onboarding onDone={() => setObOpen(false)} />}
          <div className="pcards">
            {cards
              .filter((c) => !(c.ghost && c.me))
              .map((c) => (
                <PersonCard key={c.login} c={c} hasProfile={!!mine} />
              ))}
            <ClaudeCard model={model} />
            {showSample && sample!.cards.map((c) => <PersonCard key={'s-' + c.login} c={c} hasProfile={false} />)}
          </div>
          {(waits.length > 0 || showSample) && (
            <Widget id="waits" title="Waiting on whom" icon="history" count={(showSample ? sample!.waits : waits).length} className={showSample && !waits.length ? 'is-sample' : ''}>
              <div className="rows" role="list">
                {(waits.length ? waits : sample!.waits).map((w, i) => {
                  const ww = waitWhat(w.what)
                  return (
                    <div className="row" role="listitem" key={i}>
                      <Avatar name={nameOf(w.who)} />
                      <Icon name="arrow" size="s" />
                      <Avatar name={nameOf(w.on)} />
                      <Icon name={ww.icon} size="s" className="muted" />
                      <span className="t sm">
                        <span className="sr">
                          {nameOf(w.who)} waits on {nameOf(w.on)}:{' '}
                        </span>
                        {ww.text}
                      </span>
                      <span className="meta">{w.since}</span>
                    </div>
                  )
                })}
              </div>
            </Widget>
          )}
        </div>
      ) : (
        <Together
          data={showSample ? sample!.together : together || togetherOf(model, now)}
          sample={showSample}
          nameOf={nameOf}
          titleOf={titleOf}
          onPreview={import.meta.env.DEV ? () => togglePreview(true) : undefined}
        />
      )}

      {update && (
        <Sheet open onClose={() => setUpdate(false)} labelledBy="ob-title" wide className="ob-sheet">
          <Onboarding compact onDone={() => setUpdate(false)} />
        </Sheet>
      )}
    </div>
  )
}

function PersonCard({ c, hasProfile }: { c: PersonCardView; hasProfile: boolean }) {
  const href = '#/people/' + c.slug
  return (
    <article className={'pcard' + (c.sample ? ' is-sample' : '') + (c.ghost ? ' ghost' : '')} aria-label={c.name + (c.me ? ' (you)' : '')}>
      <div className="hd">
        <Avatar name={c.name} size={40} />
        <div className="pc-id">
          <b>
            {c.name}
            {c.me && <span className="muted"> · you</span>}
          </b>
          {c.sub.length > 0 && (
            <span className="pc-sub">
              {c.sub.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </span>
          )}
        </div>
        {c.fresh && (
          <span className={'fresh' + (c.fresh.amber ? ' amber' : '')}>
            <i aria-hidden="true" />
            {c.fresh.text}
          </span>
        )}
      </div>
      {c.on.length > 0 && (
        <div className="pp-chips" aria-label="Projects">
          {c.on.slice(0, 5).map((p) => (
            <span key={p.slug} className="chip line" title={p.role === 'owner' ? 'owner' : p.part ? 'member · ' + p.part : 'member'}>
              <i className={'pdot pc' + p.color} aria-hidden="true" />
              {p.title}
              {p.part && <span className="muted"> · {p.part}</span>}
            </span>
          ))}
          {c.on.length > 5 && <span className="chip line">+{c.on.length - 5}</span>}
        </div>
      )}
      {!c.ghost && (
        <p className={'sm ' + (c.blockers ? 'fg2' : 'muted')}>
          {c.blockers ? (
            <>
              <Icon name="blocked" size="s" /> {plural(c.blockers, 'open blocker')}
              {c.waitsOn.length ? ` · waiting on ${c.waitsOn.join(', ')}` : ''}
            </>
          ) : (
            'No open blockers'
          )}
        </p>
      )}
      {c.askMeAbout.length > 0 && <p className="sm fg2 pc-ask">Ask me about: {c.askMeAbout.slice(0, 4).join(' · ')}</p>}
      {!c.sample && (
        <div className="pp-ctrl">
          {c.me && hasProfile && (
            <button className="btn primary sm" type="button" onClick={() => openCheckin()}>
              <Icon name="plus" size="s" />
              Check in
              <span className="kbd">L</span>
            </button>
          )}
          <a className="btn ghost sm" href={href}>
            Open
            <Icon name="arrow" size="s" />
          </a>
        </div>
      )}
    </article>
  )
}

function ClaudeCard({ model }: { model: Model }) {
  const todos = model.todos.filter((t) => same(t.data.by, 'claude')).length
  const posts = model.board.filter((p) => same(p.data.author, 'claude')).length
  const bits = [todos ? plural(todos, 'to-do') : '', posts ? plural(posts, 'post') : ''].filter(Boolean)
  return (
    <article className="pcard" aria-label="Claude">
      <div className="hd">
        <Avatar name="Claude" size={40} bot />
        <div className="pc-id">
          <b>Claude</b>
          <span className="pc-sub">
            <span>helper</span>
            <span>not in team numbers</span>
          </span>
        </div>
      </div>
      <p className="sm fg2">{bits.length ? `Wrote ${bits.join(' and ')}.` : 'Helps when you flag a post for Claude.'}</p>
      <div className="pp-ctrl">
        <a className="btn ghost sm" href="#/people/claude">
          Open
          <Icon name="arrow" size="s" />
        </a>
      </div>
    </article>
  )
}
