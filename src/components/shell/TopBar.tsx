// Top bar (48 px, sticky): ☰ (phone) · breadcrumbs (phone: current page only) · sync dot · Ask · Adjust look · theme.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Icon } from '../../lib/icons'
import { useHQMaybe, useIsDark, usePrefsApi } from '../../lib/hq-context'
import type { Doorbell } from '../../lib/doorbell'
import type { Source } from '../../lib/source'
import type { Crumb } from './shell-core'
import { MOD_KEY } from './Sidebar'

type Props = {
  crumbs: Crumb[]
  rail: boolean
  source: Source | null | undefined
  bell: Doorbell | null
  busy: boolean
  error: string
  onReload: () => void
  onMenu: () => void
  onRail: () => void
  onPalette: () => void
  onAdjust: () => void
}

const noSub = () => () => {}

/** "● Synced": green when loaded; the tooltip says how (live doorbell, minute checks, or the local folder). Click = reload. */
function SyncChip({ source, bell, busy, error, onReload }: Pick<Props, 'source' | 'bell' | 'busy' | 'error' | 'onReload'>) {
  useSyncExternalStore(bell ? bell.subscribe : noSub, () => bell?.version ?? 0)
  const hq = useHQMaybe()
  if (!source) return null
  const live = bell?.status === 'live'
  const local = source.kind === 'local'
  const state = busy ? 'busy' : error ? 'warn' : hq ? 'ok' : 'busy'
  const label = state === 'busy' ? 'Syncing…' : state === 'warn' ? 'Offline' : local ? 'Local' : 'Synced'
  const tip =
    state === 'warn'
      ? `Can't reach your notes right now · click to retry`
      : local
        ? 'Reading the local folder · updates as files change · click to reload'
        : `Synced with GitHub · ${live ? 'live updates on' : 'checking every minute'} · click to reload`
  return (
    <button className={'sync hide-m is-' + state} type="button" onClick={onReload} disabled={busy} data-tipt={tip} aria-label={`${label}. ${tip}`}>
      <i aria-hidden="true" />
      {label}
    </button>
  )
}

export function TopBar(p: Props) {
  const { apply } = usePrefsApi()
  const dark = useIsDark()
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const f = () => setScrolled(scrollY > 4)
    addEventListener('scroll', f, { passive: true })
    return () => removeEventListener('scroll', f)
  }, [])
  const toggleTheme = () => apply({ theme: dark ? 'light' : 'dark' }, dark ? 'Light theme' : 'Dark theme')
  return (
    <header className={'top' + (scrolled ? ' scrolled' : '')}>
      <button className="icon-btn only-m" type="button" onClick={p.onMenu} aria-label="Open menu">
        <Icon name="menu" />
      </button>
      {p.rail && (
        <button className="icon-btn hide-m" type="button" onClick={p.onRail} aria-label="Expand sidebar" data-tipt={`Expand sidebar · ${MOD_KEY}+\\`}>
          <Icon name="sidebar" />
        </button>
      )}
      <nav className="crumbs" aria-label="Breadcrumb">
        {p.crumbs.map((c, i) => {
          const last = i === p.crumbs.length - 1
          const body = (
            <>
              {c.icon && <Icon name={c.icon} size="s" />}
              <span className="ct">{c.label}</span>
            </>
          )
          return (
            <span key={i} className="crumb">
              {i > 0 && (
                <span className="sep" aria-hidden="true">
                  /
                </span>
              )}
              {last || !c.href ? <span aria-current={last ? 'page' : undefined}>{body}</span> : <a href={c.href}>{body}</a>}
            </span>
          )
        })}
      </nav>
      <SyncChip source={p.source} bell={p.bell} busy={p.busy} error={p.error} onReload={p.onReload} />
      <a className="tbtn hide-m" href="#/ask">
        <Icon name="spark" size="s" />
        Ask
      </a>
      <button className="tbtn" type="button" onClick={p.onAdjust} aria-label={`Adjust look (${MOD_KEY}+.)`} data-tipt={`Change how HQ looks · ${MOD_KEY}+.`}>
        <Icon name="wand" size="s" />
        <span className="hide-m">Adjust look</span>
      </button>
      <button className="icon-btn" type="button" onClick={toggleTheme} aria-label={dark ? 'Switch to light' : 'Switch to dark'} data-tipt={dark ? 'Light theme' : 'Dark theme'}>
        <Icon name={dark ? 'sun' : 'moon'} />
      </button>
      <button className="icon-btn only-m" type="button" onClick={p.onPalette} aria-label="Search">
        <Icon name="search" />
      </button>
    </header>
  )
}
