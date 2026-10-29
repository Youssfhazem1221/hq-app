// Sidebar (252 px, 60 px rail; a left sheet on phones): workspace · Search or jump · Check in (+ today dot, L) · nav ·
// Pinned · Pages · people row · Settings.
import { useState } from 'react'
import { Icon } from '../../lib/icons'
import { useHQMaybe, usePrefsApi } from '../../lib/hq-context'
import { firstName, same, store } from '../../lib/util'
import type { Route } from '../../lib/contracts'
import { PagesTree } from './PagesTree'
import { PinwheelMark } from './PinwheelMark'
import { NAV, initials, navList, pinnedNow } from './shell-core'

const GROUPS_KEY = 'hq.sb.groups'
export const MOD_KEY = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'

/** People nav badge (blueprint §8.1): new For-you items that are not to-dos; quiet = my last check-in is older than my
 *  nudge days (a small amber dot, never red). Computed by lib/foryou-toasts peopleNavBadge. */
export type PeopleBadge = { count: number; quiet: boolean }

type Props = {
  route: Route
  loggedToday: boolean
  peopleBadge?: PeopleBadge
  onPalette: () => void
  onRail: () => void
  onCheckin: () => void
}

export function Sidebar({ route, loggedToday, peopleBadge, onPalette, onRail, onCheckin }: Props) {
  const hq = useHQMaybe()
  const { prefs } = usePrefsApi()
  const [groups, setGroups] = useState<{ pins: boolean; tree: boolean }>(() => ({ pins: true, tree: true, ...store.get(GROUPS_KEY, {}) }))
  const flip = (k: 'pins' | 'tree') =>
    setGroups((g) => {
      const next = { ...g, [k]: !g[k] }
      store.set(GROUPS_KEY, next)
      return next
    })

  const model = hq?.model || null
  const me = hq?.me || null
  const counts: Partial<Record<string, number>> = model
    ? {
        projects: model.projects.length,
        tasks: model.todos.filter((t) => t.data.status !== 'done' && same(t.data.owner, me?.login)).length,
        people: peopleBadge?.count || 0,
      }
    : {}
  const pins = pinnedNow(prefs, model, me)
  const mySlug = model && me ? model.roster.find((p) => same(p.login, me.login))?.slug : undefined
  const ws = 'pinwheel'

  return (
    <aside className="sb" id="sb" aria-label="Sidebar">
      <div className="sb-top">
        <a className="ws" href="#/" aria-label={`${ws}, go home`}>
          <PinwheelMark className="ws-mark" />
          <b>{ws}</b>
        </a>
        <button className="icon-btn" type="button" onClick={onRail} aria-label={`Collapse sidebar (${MOD_KEY}+\\)`} data-tipt={`Collapse sidebar · ${MOD_KEY}+\\`}>
          <Icon name="sidebar" />
        </button>
      </div>
      <button className="sb-search" type="button" onClick={onPalette} data-tipt={`Search or jump · ${MOD_KEY} K`}>
        <Icon name="search" size="s" />
        <span>Search or jump</span>
        <span className="kbd">{MOD_KEY} K</span>
      </button>
      <button
        className={'sb-ci' + (loggedToday ? ' logged' : '')}
        id="sb-ci"
        type="button"
        onClick={onCheckin}
        aria-label={`Check in · ${loggedToday ? 'logged today' : 'not logged today'} · L`}
        data-tipt="Check in · L"
      >
        <Icon name="plus" size="s" />
        <span className="lbl">Check in</span>
        <i className="cidot" aria-hidden="true" />
        <span className="kbd">L</span>
      </button>
      <nav className="nav" aria-label="Main">
        {navList(prefs).map((k) => {
          const n = NAV[k]
          const c = counts[k]
          return (
            <a key={k} href={'#' + n.path} aria-current={route.nav === k ? 'page' : undefined} data-tipt={n.label}>
              <Icon name={n.icon} />
              <span className="lbl">{n.label}</span>
              {c ? (
                <span className="badge" aria-label={k === 'people' ? `${c} new for you` : `${c} ${c === 1 ? 'item' : 'items'}`}>
                  {c}
                </span>
              ) : k === 'people' && peopleBadge?.quiet ? (
                <i className="qdot" role="img" aria-label="No check-in for a while" />
              ) : null}
            </a>
          )
        })}
      </nav>
      {pins.length > 0 && (
        <div className="sb-group">
          <button className="sb-h" type="button" aria-expanded={groups.pins} onClick={() => flip('pins')}>
            <Icon name="chevD" />
            Pinned
          </button>
          {groups.pins && (
            <div className="pin">
              {pins.map((p) => {
                const here =
                  (p.kind === 'project' && route.page === 'Project' && p.href === '#/projects/' + route.slug) ||
                  (p.kind === 'doc' && route.doc && p.href === '#/docs/' + route.doc)
                return (
                  <a key={p.id} href={p.href} aria-current={here ? 'page' : undefined} title={p.title}>
                    {p.kind === 'project' ? <i className={'pdot pc' + (p.color || 1)} aria-hidden="true" /> : <Icon name={p.kind === 'doc' ? 'file' : 'user'} />}
                    <span className="lbl">{p.title}</span>
                  </a>
                )
              })}
            </div>
          )}
        </div>
      )}
      <PagesTree currentDoc={route.page === 'Docs' ? route.doc : undefined} open={groups.tree} onToggle={() => flip('tree')} />
      <div className="sb-foot">
        {me && model && (
          <div className="people-row">
            <a href={mySlug ? '#/people/' + mySlug : '#/people'} data-tipt={`${firstName(me.name)} · you`} aria-label={`${me.name} (you)`}>
              {me.avatar ? <img className="av" src={me.avatar} width={28} height={28} alt="" /> : <span className="av">{initials(me.name || me.login)}</span>}
            </a>
            <a href="#/people/claude" data-tipt="Claude · helper" aria-label="Claude">
              <span className="av bot">
                <Icon name="bot" />
              </span>
            </a>
            <a className="av ghost" href="#/people" data-tipt="Invite someone" aria-label="Invite someone">
              <Icon name="plus" />
            </a>
          </div>
        )}
        <nav className="nav" aria-label="Settings">
          <a href="#/settings" aria-current={route.nav === 'settings' ? 'page' : undefined} data-tipt="Settings">
            <Icon name="settings" />
            <span className="lbl">Settings</span>
          </a>
        </nav>
      </div>
    </aside>
  )
}
