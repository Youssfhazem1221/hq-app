import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Cloud, Compass, LoaderCircle, Monitor, Moon, RefreshCw, Sun, TriangleAlert } from 'lucide-react'
import { GitHubSource, LocalSource, type FileEntry, type GhConfig, type Me, type Source } from './lib/source'
import { buildModel, displayName, type Model } from './lib/hq'
import { Doorbell } from './lib/doorbell'
import { SUPABASE_REF } from './config'
import { same, store } from './lib/util'
import { useRoute } from './lib/router'
import { DEFAULT_DESIGN, isDesign, type DesignId } from './designs'
import { NAV } from './nav'
import { Avatar } from './components/ui'
import { Toasts, toast } from './components/toast'
import Dashboard from './pages/Dashboard'
import Board from './pages/Board'
import Todos from './pages/Todos'
import Docs from './pages/Docs'
import People from './pages/People'
import Ask from './pages/Ask'
import Settings from './pages/Settings'
import DesignLab from './pages/DesignLab'
import Projects from './pages/Projects'

type Ctx = {
  source: Source
  model: Model
  me: Me
  /** Full reload with the busy spinner (after the user's own writes). */
  reload: () => Promise<void>
  /** Quiet change check: free when nothing changed; rebuilds the model and toasts when files did. */
  refresh: () => Promise<void>
  busy: boolean
  loadedAt: number
  /** Realtime doorbell (push + Claude bridge hints); null until the source is ready. */
  bell: Doorbell | null
}
const HQ = createContext<Ctx | null>(null)
export function useHQ() {
  const c = useContext(HQ)
  if (!c) throw new Error('HQ context missing')
  return c
}

export type Theme = 'light' | 'dark'

const CHECK_EVERY_MS = 60_000
const PUSH_DEBOUNCE_MS = 500

function useLook() {
  const [theme, setThemeState] = useState<Theme>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'))
  const [design, setDesignState] = useState<DesignId>(() => {
    const d = store.get<string>('hq.design', DEFAULT_DESIGN)
    return isDesign(d) ? d : DEFAULT_DESIGN
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  useEffect(() => {
    document.documentElement.dataset.design = design
  }, [design])
  const setTheme = (t: Theme) => {
    store.set('hq.theme', t)
    setThemeState(t)
  }
  const setDesign = (d: DesignId) => {
    store.set('hq.design', d)
    setDesignState(d)
  }
  return { theme, setTheme, design, setDesign }
}

async function pickSource(): Promise<Source | null> {
  const mode = store.get<string | null>('hq.mode', null)
  const gh = store.get<GhConfig | null>('hq.github', null)
  if (mode !== 'github' && import.meta.env.DEV) {
    try {
      if ((await fetch('/__hq/me')).ok) return new LocalSource()
    } catch { /* not running the dev server */ }
  }
  return gh?.token ? new GitHubSource(gh) : null
}

export default function App() {
  const [source, setSource] = useState<Source | null | undefined>(undefined)
  const [files, setFiles] = useState<FileEntry[] | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadedAt, setLoadedAt] = useState(0)
  const [bell, setBell] = useState<Doorbell | null>(null)
  const look = useLook()
  const route = useRoute()
  const toggleTheme = () => look.setTheme(look.theme === 'dark' ? 'light' : 'dark')

  useEffect(() => {
    pickSource().then(setSource)
  }, [])

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
  }, [source])

  // Doorbell: topic from .hq/realtime.json (only if it names this Supabase project).
  useEffect(() => {
    if (!source) return
    const b = new Doorbell(async () => {
      const rt = await source.realtime()
      return rt && (!rt.project || rt.project === SUPABASE_REF) ? rt.topic : null
    })
    b.start()
    setBell(b)
    return () => {
      b.stop()
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
      if (c) toast(`${m ? displayName(m, c.author) : c.author}: ${c.message}`, 'commit')
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

  const section = '/' + (route.split('/')[1] || '')
  const [, NavIcon, navLabel] = source === null ? NAV.find(([r]) => r === '/settings')! : NAV.find(([r]) => r === section) || NAV[0]

  const counts: Record<string, number> = {}
  if (model && me) {
    counts['/board'] = model.board.filter((b) => b.data.for_claude && b.data.status !== 'done').length
    counts['/todos'] = model.todos.filter((t) => t.data.status !== 'done' && same(t.data.owner, me.login)).length
    counts['/ask'] = model.requests.filter((r) => !model.answers.has(String(r.data.id))).length
  }

  const settings = <Settings source={source || null} onConnect={(s) => setSource(s)} theme={look.theme} toggleTheme={toggleTheme} />

  let content: React.ReactNode
  if (source === undefined) content = <div className="splash"><LoaderCircle className="i spin" /> Starting…</div>
  else if (source === null || section === '/settings') content = settings
  else if (error && !model) content = <div className="alert"><TriangleAlert className="i" /> {error} · <a href="#/settings">Open Settings</a></div>
  else if (!model || !me) content = <div className="splash"><LoaderCircle className="i spin" /> Loading your workspace…</div>
  else {
    const pages: Record<string, React.ReactNode> = {
      '/': <Dashboard />,
      '/projects': <Projects slug={route.slice('/projects/'.length)} />,
      '/board': <Board />,
      '/todos': <Todos />,
      '/docs': <Docs path={route.slice('/docs/'.length)} />,
      '/people': <People />,
      '/ask': <Ask />,
      '/design': <DesignLab design={look.design} setDesign={look.setDesign} theme={look.theme} setTheme={look.setTheme} />,
    }
    content = <HQ.Provider value={{ source, model, me, reload, refresh, busy, loadedAt, bell }}>{pages[section] || <Dashboard />}</HQ.Provider>
  }

  return (
    <div className="shell app-shell">
      <nav className="nav">
        <a className="brand" href="#/">
          <Compass className="i lg" /> <b>HQ</b>
        </a>
        {NAV.map(([r, Icon, label]) => (
          <a key={r} href={'#' + r} className={'nav-link' + (section === r ? ' on' : '')} title={label}>
            <span className="ico"><Icon className="i" /></span>
            <span className="lbl">{label}</span>
            {counts[r] ? <span className="count">{counts[r]}</span> : null}
          </a>
        ))}
        <div className="nav-foot">
          {me && (
            <div className="me" title={me.login}>
              <Avatar name={me.name} src={me.avatar} size={28} />
              <span className="lbl">{me.name}</span>
            </div>
          )}
        </div>
      </nav>
      <main className="main">
        <header className="top">
          <h1>
            <NavIcon className="i" /> {navLabel}
          </h1>
          <div className="top-actions">
            {source && (
              <span className="pill hide-sm">
                <LiveDot bell={bell} />
                {source.kind === 'local' ? <Monitor className="i sm" /> : <Cloud className="i sm" />}
                {source.kind === 'local' ? 'Local folder' : source.label}
              </span>
            )}
            {source && (
              <button className="btn ghost" onClick={reload} disabled={busy} title="Reload from the repo">
                <RefreshCw className={'i' + (busy ? ' spin' : '')} /> <span className="hide-sm">Refresh</span>
              </button>
            )}
            <button className="btn ghost" onClick={toggleTheme} title="Light / dark" aria-label="Toggle light or dark mode">
              {look.theme === 'dark' ? <Sun className="i" /> : <Moon className="i" />}
            </button>
          </div>
        </header>
        {error && model && <div className="alert"><TriangleAlert className="i" /> {error}</div>}
        <div className="page">{content}</div>
      </main>
      <Toasts />
    </div>
  )
}

const noSub = () => () => {}
/** Green when live updates (the doorbell) are connected; otherwise the app checks GitHub every minute. */
function LiveDot({ bell }: { bell: Doorbell | null }) {
  useSyncExternalStore(bell ? bell.subscribe : noSub, () => bell?.version ?? 0)
  const live = bell?.status === 'live'
  return (
    <span
      className={'live-dot' + (live ? ' on' : '')}
      title={live ? 'Live updates on' : 'Live updates off: checking every minute'}
      aria-label={live ? 'Live updates on' : 'Live updates off'}
    />
  )
}
