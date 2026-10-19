import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileEntry, GhConfig, Me, Source } from './lib/source'
import { buildModel, displayName } from './lib/hq'
import type { Doorbell } from './lib/doorbell'
import { slugOf, zonedParts } from './lib/people-core'
import { SUPABASE_REF } from './config'
import { same, store } from './lib/util'
import { docTitle, go, parseRoute, useRoute } from './lib/router'
import { HQ_EVENTS, fire, type Route } from './lib/contracts'
import { HQContext, PrefsContext, RouteContext, useHQMaybe, type HQCtx } from './lib/hq-context'
import { usePrefs } from './lib/prefs'
import { focusPageTitle, isTyping, onEscape, rememberFocus, restoreFocus, runEscape, setPaletteReturn } from './lib/focus'
import { Icon } from './lib/icons'
import { isStaleChunk, reloadFresh, STALE_MSG } from './lib/net'
import { Toasts, openCheckin, toast } from './components/toast'
import { Boundary, PageSnag } from './components/ErrorBoundary'
import { Sidebar, type PeopleBadge } from './components/shell/Sidebar'
import { TopBar } from './components/shell/TopBar'
import { BottomBar } from './components/shell/BottomBar'
import { TipLayer } from './components/shell/Popover'
import { crumbsFor, keyAction } from './components/shell/shell-core'
import { PageView } from './routes'

// App-wide surfaces that listen for shell events (each in its own lazy chunk, mounted once right after the first
// paint): the Adjust look drawer (hq:adjust-look + the palette's Look items), the check-in sheet (hq:checkin) and the
// For-you toasts + People nav badge, which watch every model rebuild (local and GitHub mode alike).
const loadPalette = () => import('./components/shell/Palette')
const Palette = lazy(() => loadPalette().then((m) => ({ default: m.Palette })))
const AdjustLook = lazy(() => import('./components/AdjustLook'))
const CheckInSheet = lazy(() => import('./components/people/CheckIn'))
const ForYouWatch = lazy(() =>
  import('./lib/foryou-toasts').then((m) => ({
    default: function ForYouWatch({ onBadge }: { onBadge: (b: PeopleBadge) => void }) {
      const hq = useHQMaybe()
      const model = hq?.model || null
      const me = hq?.me || null
      m.useForYouToasts(model, me)
      useEffect(() => {
        onBadge(model && me ? m.peopleNavBadge(model, me.login) : { count: 0, quiet: false })
      }, [model, me, onBadge])
      return null
    },
  })),
)

const CHECK_EVERY_MS = 60_000
const PUSH_DEBOUNCE_MS = 500
const RAIL_KEY = 'hq.sb.rail'

// The sources (and the GitHub sync) load on demand so the first paint stays small (spec §9 entry budget).
async function pickSource(): Promise<Source | null> {
  const { GitHubSource, LocalSource } = await import('./lib/source')
  const mode = store.get<string | null>('hq.mode', null)
  const gh = store.get<GhConfig | null>('hq.github', null)
  if (mode !== 'github' && import.meta.env.DEV) {
    try {
      if ((await fetch('/__hq/me')).ok) return new LocalSource()
    } catch { /* not running the dev server */ }
  }
  return gh?.token ? new GitHubSource(gh) : null
}

/** Focus the page title once the (lazy) page has rendered it. */
function focusTitleSoon() {
  if (focusPageTitle()) return
  const main = document.getElementById('main')
  if (!main) return
  const obs = new MutationObserver(() => {
    if (focusPageTitle()) obs.disconnect()
  })
  obs.observe(main, { childList: true, subtree: true })
  // A page without an h1 (old pages): land in <main> so the next Tab starts in the content. Focus the page moved on
  // its own in the meantime (a notification's linked post, a field you clicked) stays where it is.
  setTimeout(() => {
    obs.disconnect()
    const a = document.activeElement
    if (a && a !== document.body && a !== main) return
    if (!focusPageTitle()) main.focus({ preventScroll: true })
  }, 1500)
}

export default function App() {
  const [source, setSource] = useState<Source | null | undefined>(undefined)
  const [files, setFiles] = useState<FileEntry[] | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadedAt, setLoadedAt] = useState(0)
  const [bell, setBell] = useState<Doorbell | null>(null)
  const [palette, setPalette] = useState(false)
  const [paletteUsed, setPaletteUsed] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [railStored, setRailStored] = useState(() => store.get<boolean>(RAIL_KEY, false))
  const [remount, setRemount] = useState(0)
  const raw = useRoute()
  const route: Route = useMemo(() => parseRoute(raw), [raw])
  const [peopleBadge, setPeopleBadge] = useState<PeopleBadge>({ count: 0, quiet: false })

  useEffect(() => {
    // a stale file already started a reload (main.tsx); the banner says so in case it was held back
    pickSource()
      .then(setSource)
      .catch((e) => setError(isStaleChunk(e) ? STALE_MSG : String(e?.message || e)))
  }, [])

  // `attempt` = the error banner's Retry button
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!source) return
    let off = false
    setFiles(null)
    setError('')
    Promise.all([source.me(), source.loadAll()])
      .then(([m, f]) => {
        if (off) return
        setMe(m)
        setFiles(f)
        setLoadedAt(Date.now())
      })
      .catch((e) => !off && setError(String(e?.message || e)))
    return () => {
      off = true
    }
  }, [source, attempt])
  const retry = () => (source === undefined ? reloadFresh(true) : setAttempt((a) => a + 1))

  // Doorbell: topic from .hq/realtime.json (only if it names this Supabase project). Loaded on demand.
  useEffect(() => {
    if (!source) return
    let off = false
    let b: Doorbell | null = null
    import('./lib/doorbell')
      .then(({ Doorbell }) => {
        if (off) return
        b = new Doorbell(async () => {
          const rt = await source.realtime()
          return rt && (!rt.project || rt.project === SUPABASE_REF) ? rt.topic : null
        })
        b.start()
        setBell(b)
      })
      .catch(() => { /* live updates are optional: the 60 s check still runs (a stale file reloads in main.tsx) */ })
    return () => {
      off = true
      b?.stop()
      setBell(null)
    }
  }, [source])

  const reload = useCallback(async () => {
    if (!source) return
    setBusy(true)
    try {
      setFiles(await source.loadAll())
      setLoadedAt(Date.now())
      setError('')
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }, [source])

  const model = useMemo(() => (files ? buildModel(files) : null), [files])
  const modelRef = useRef(model)
  modelRef.current = model

  // Look prefs: the device cache (read by the pre-paint) + people/<slug>/ui.md, re-read on every refresh (spec §7.2).
  const mySlug = useMemo(() => (model && me ? model.roster.find((p) => same(p.login, me.login))?.slug || slugOf(me.login) : null), [model, me])
  // Local mode without HQ_LOCAL_LOGIN (me.configured === false): "me" is only a display default, so the look stays on
  // this device (cache only) and never lands in someone else's people/<slug>/ui.md.
  const readOnlyMe = me?.configured === false
  const prefsApi = usePrefs(me && !readOnlyMe ? me.login : null, { source: source || null, files, slug: readOnlyMe ? null : mySlug })
  const { prefs } = prefsApi
  const rail = railStored || prefs.focus === 'on'

  // Quiet change check. One at a time; a call that lands mid-check runs one more pass after it.
  const running = useRef<Promise<void> | null>(null)
  const again = useRef(false)
  const refresh = useCallback((): Promise<void> => {
    if (!source) return Promise.resolve()
    if (running.current) {
      again.current = true
      return running.current
    }
    const once = async () => {
      const r = await source.refresh()
      if (!r) return
      setFiles(r.files)
      setLoadedAt(Date.now())
      setError('')
      // Chat files show up on the Ask page by themselves; toast everything else.
      if (!r.changed.some((p) => !p.startsWith('ai/'))) return
      if (source.kind === 'local') return toast('Files changed on this PC', 'local')
      const c = await source.latest().catch(() => null)
      const m = modelRef.current
      // human words, never the raw commit subject (no tool prefixes or file ids); the wording loads on demand (entry budget)
      if (c) toast((await import('./lib/changes')).humanChange(c, (l) => (m ? displayName(m, l) : l)), 'commit')
    }
    running.current = (async () => {
      do {
        again.current = false
        try {
          await once()
        } catch { /* offline or rate-limited: the next trigger tries again */ }
      } while (again.current)
    })().finally(() => {
      running.current = null
    })
    return running.current
  }, [source])

  // Triggers: focus / back in view, every 60 s while visible, and (local mode) file events from the dev server.
  const ready = files !== null
  useEffect(() => {
    if (!source || !ready) return
    let last = 0
    const soon = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 2000) return
      last = Date.now()
      refresh()
    }
    addEventListener('focus', soon)
    document.addEventListener('visibilitychange', soon)
    const timer = setInterval(() => document.visibilityState === 'visible' && refresh(), CHECK_EVERY_MS)
    const events = source.kind === 'local' ? new EventSource('/__hq/events') : null
    events?.addEventListener('change', () => refresh())
    return () => {
      removeEventListener('focus', soon)
      document.removeEventListener('visibilitychange', soon)
      clearInterval(timer)
      events?.close()
    }
  }, [source, ready, refresh])

  // Doorbell: a push (debounced), or the Claude bridge finishing a job → check now.
  useEffect(() => {
    if (!bell || !source || !ready) return
    let t: ReturnType<typeof setTimeout> | undefined
    const check = (sha: string | undefined, tries: number) =>
      refresh().then(() => {
        // The branch can trail the push by a moment: look again while we still hold an older commit.
        if (sha && source.headSha && source.headSha !== sha && tries > 0) t = setTimeout(() => check(sha, tries - 1), 3000)
      })
    const offPush = bell.onPush((p) => {
      clearTimeout(t)
      if (p.sha && p.sha === source.headSha) return
      t = setTimeout(() => check(p.sha, 2), PUSH_DEBOUNCE_MS)
    })
    const offBridge = bell.onBridge((b) => {
      if (b.state === 'done') refresh()
    })
    return () => {
      offPush()
      offBridge()
      clearTimeout(t)
    }
  }, [bell, source, ready, refresh])

  // ---- shell state on <html>: rail sidebar, phone sheet ----
  useEffect(() => {
    document.documentElement.setAttribute('data-sb', rail ? 'rail' : 'full')
  }, [rail])
  useEffect(() => {
    const r = document.documentElement
    if (sheet) r.setAttribute('data-sheet', 'nav')
    else r.removeAttribute('data-sheet')
  }, [sheet])

  const toggleRail = useCallback(() => {
    setRailStored((v) => {
      store.set(RAIL_KEY, !v)
      return !v
    })
  }, [])
  const openSheet = useCallback(() => {
    rememberFocus()
    setSheet(true)
    setTimeout(() => document.getElementById('sb-ci')?.focus(), 60)
  }, [])
  const closeSheet = useCallback((restore = true) => {
    setSheet((was) => {
      if (was && restore) setTimeout(restoreFocus, 0)
      return false
    })
  }, [])
  useEffect(() => {
    if (!sheet) return
    // The phone sheet joins the Esc stack like any other surface.
    return onEscape(() => closeSheet())
  }, [sheet, closeSheet])

  const openPalette = useCallback(() => {
    const a = document.activeElement
    setPaletteReturn(a)
    rememberFocus()
    setSheet(false)
    setPaletteUsed(true)
    setPalette(true)
  }, [])
  // The palette is its own chunk: fetch it once the first screen is up, so Ctrl K opens without a wait.
  useEffect(() => {
    const t = setTimeout(() => void loadPalette().catch(() => {}), 1200)
    return () => clearTimeout(t)
  }, [])
  const closePalette = useCallback(() => setPalette(false), [])

  const checkin = useCallback(() => {
    setSheet(false)
    // The sheet mounts right after the first paint (and once a workspace is open); this covers the moment before.
    openCheckin({}, source !== null)
  }, [source])
  const adjustLook = useCallback((query?: string) => {
    setSheet(false)
    if (!fire(HQ_EVENTS.adjustLook, query ? { query } : {})) go('/settings')
  }, [])

  // ---- keyboard (spec §2.4) ----
  const gPending = useRef(false)
  const gTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const routeRef = useRef(route)
  routeRef.current = route
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = keyAction(e, { keys: prefs.keys, typing: isTyping(e.target), gPending: gPending.current })
      if (!a) return
      switch (a.type) {
        case 'palette':
          e.preventDefault()
          if (palette) {
            setPalette(false)
            restoreFocus()
          } else openPalette()
          return
        case 'adjust':
          e.preventDefault()
          setPalette(false)
          adjustLook()
          return
        case 'rail':
          e.preventDefault()
          toggleRail()
          return
        case 'escape':
          runEscape()
          return
        case 'g':
          gPending.current = true
          clearTimeout(gTimer.current)
          gTimer.current = setTimeout(() => (gPending.current = false), 900)
          return
        case 'gcancel':
          gPending.current = false
          return
        case 'go':
          gPending.current = false
          e.preventDefault()
          go(a.to)
          return
        case 'checkin':
          e.preventDefault()
          rememberFocus()
          checkin()
          return
        case 'new':
          if (fire(HQ_EVENTS.newItem, { page: routeRef.current.page })) e.preventDefault()
          return
        case 'tick': {
          const t = e.target as HTMLElement | null
          if (t?.matches?.('.cbx,[data-tick]')) {
            e.preventDefault()
            t.click()
          }
          return
        }
        case 'help':
          e.preventDefault()
          go('/settings')
          setTimeout(() => document.getElementById('s-shortcuts')?.scrollIntoView({ block: 'start' }), 400)
          return
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [prefs.keys, palette, openPalette, adjustLook, toggleRail, checkin])

  // ---- route changes: close the sheet, scroll top, focus the h1 (no ring), tab title ----
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setSheet(false)
    scrollTo(0, 0)
    focusTitleSoon()
  }, [route.path])
  const crumbs = useMemo(() => crumbsFor(route, model), [route, model])
  useEffect(() => {
    document.title = docTitle(source === null ? 'Settings' : crumbs[crumbs.length - 1]?.label || '')
  }, [crumbs, source])

  // #/me → my own page once the workspace knows who I am.
  useEffect(() => {
    if (route.person !== '@me' || !model || !me) return
    const slug = model.roster.find((p) => same(p.login, me.login))?.slug
    location.replace('#/people/' + (slug || ''))
  }, [route.person, model, me])

  // Ask from anywhere while already on Ask: remount the page so it reads the prefill.
  useEffect(() => {
    const f = () => setRemount((n) => n + 1)
    addEventListener('hq:remount', f)
    return () => removeEventListener('hq:remount', f)
  }, [])

  const loggedToday = useMemo(() => {
    if (!model || !me) return false
    const p = model.roster.find((x) => same(x.login, me.login))
    if (!p) return false
    try {
      const today = zonedParts(new Date().toISOString(), p.timezone || 'UTC').date
      return (model.logEntries.get(p.slug) || []).some((r) => r.date === today)
    } catch {
      return false
    }
  }, [model, me, loadedAt])

  const ctx: HQCtx | null = source && model && me ? { source, model, me, reload, refresh, busy, loadedAt, bell } : null
  const settingsProps = {
    source: source || null,
    onConnect: (s: Source | null) => setSource(s),
  }
  const settingsRoute: Route = { page: 'Settings', nav: 'settings', path: '/settings' }

  const loadError = (
    <div className="alert" role="alert">
      <Icon name="alert" /> {error}{' '}
      <button className="btn sm" type="button" onClick={retry}>
        Retry
      </button>{' '}
      · <a href="#/settings">Open Settings</a>
    </div>
  )
  let content: React.ReactNode
  if (source === undefined) content = error ? loadError : <Splash text="Starting…" />
  else if (source === null) content = <PageView route={settingsRoute} extra={settingsProps} />
  else if (route.page === 'Settings') content = <PageView route={route} extra={settingsProps} />
  else if (error && !model) content = loadError
  else if (!ctx) content = <Splash text="Loading your workspace…" />
  else content = <PageView route={route} extra={settingsProps} />

  const skip = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!focusPageTitle()) document.getElementById('main')?.focus()
  }

  return (
    <RouteContext.Provider value={source === null ? settingsRoute : route}>
      <PrefsContext.Provider value={prefsApi}>
        <HQContext.Provider value={ctx}>
          <a className="skip" href="#main" onClick={skip}>
            Skip to content
          </a>
          <div className="app">
            <Sidebar route={source === null ? settingsRoute : route} loggedToday={loggedToday} peopleBadge={peopleBadge} onPalette={openPalette} onRail={toggleRail} onCheckin={checkin} />
            <div className="sb-scrim" onClick={() => closeSheet()} aria-hidden="true" />
            <div className="main">
              <TopBar
                crumbs={crumbs}
                rail={rail}
                source={source}
                bell={bell}
                busy={busy}
                error={error}
                onReload={reload}
                onMenu={openSheet}
                onRail={toggleRail}
                onPalette={openPalette}
                onAdjust={() => adjustLook()}
              />
              {error && model && (
                <div className="alert" role="alert">
                  <Icon name="alert" /> {error}
                </div>
              )}
              {readOnlyMe && (
                <div className="alert warn" role="note">
                  <Icon name="info" /> Viewing only: set HQ_LOCAL_LOGIN in .env.local to save check-ins, your profile and your look as yourself.
                </div>
              )}
              <main id="main" tabIndex={-1}>
                <div className="page" data-page={route.page} key={route.path + ':' + remount}>
                  <Boundary resetKey={route.path + ':' + remount} fallback={(e, reset) => <PageSnag error={e} reset={reset} />}>
                    {content}
                  </Boundary>
                </div>
              </main>
            </div>
          </div>
          <BottomBar route={route} onMore={openSheet} />
          {paletteUsed && (
            <Boundary fallback={null}>
              <Suspense fallback={null}>
                <Palette open={palette} route={route} onClose={closePalette} onCheckin={checkin} onAdjust={adjustLook} />
              </Suspense>
            </Boundary>
          )}
          <Boundary fallback={null}>
            <Suspense fallback={null}>
              <AdjustLook />
              {ctx && <CheckInSheet />}
              {ctx && <ForYouWatch onBadge={setPeopleBadge} />}
            </Suspense>
          </Boundary>
          <Toasts />
          <TipLayer />
        </HQContext.Provider>
      </PrefsContext.Provider>
    </RouteContext.Provider>
  )
}

function Splash({ text }: { text: string }) {
  return (
    <div className="splash" role="status">
      <Icon name="loader" className="spin" /> {text}
    </div>
  )
}

