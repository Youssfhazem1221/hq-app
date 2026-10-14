import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Cloud, Compass, LoaderCircle, Monitor, Moon, RefreshCw, Sun, TriangleAlert } from 'lucide-react'
import { GitHubSource, LocalSource, type FileEntry, type GhConfig, type Me, type Source } from './lib/source'
import { buildModel, type Model } from './lib/hq'
import { same, store } from './lib/util'
import { useRoute } from './lib/router'
import { DEFAULT_DESIGN, isDesign, type DesignId } from './designs'
import { NAV } from './nav'
import { Avatar } from './components/ui'
import Dashboard from './pages/Dashboard'
import Board from './pages/Board'
import Todos from './pages/Todos'
import Docs from './pages/Docs'
import People from './pages/People'
import Ask from './pages/Ask'
import Settings from './pages/Settings'
import DesignLab from './pages/DesignLab'
import Projects from './pages/Projects'

type Ctx = { source: Source; model: Model; me: Me; reload: () => Promise<void>; busy: boolean; loadedAt: number }
const HQ = createContext<Ctx | null>(null)
export function useHQ() {
  const c = useContext(HQ)
  if (!c) throw new Error('HQ context missing')
  return c
}

export type Theme = 'light' | 'dark'

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
  const section = '/' + (route.split('/')[1] || '')
  const [, NavIcon, navLabel] = NAV.find(([r]) => r === section) || NAV[0]

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
    content = <HQ.Provider value={{ source, model, me, reload, busy, loadedAt }}>{pages[section] || <Dashboard />}</HQ.Provider>
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
    </div>
  )
}
