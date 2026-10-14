import { useState } from 'react'
import { Cloud, CloudUpload, Compass, ExternalLink, Lock, Monitor, Moon, Palette, Plug, Sun } from 'lucide-react'
import { Card } from '../components/ui'
import { DEFAULT_BRANCH, DEFAULT_REPO } from '../config'
import { GitHubSource, LocalSource, type GhConfig, type Source } from '../lib/source'
import { go } from '../lib/router'
import { store } from '../lib/util'

type Props = { source: Source | null; onConnect: (s: Source | null) => void; theme: string; toggleTheme: () => void }

export default function Settings({ source, onConnect, theme, toggleTheme }: Props) {
  const saved = store.get<GhConfig | null>('hq.github', null)
  const [repo, setRepo] = useState(saved ? `${saved.owner}/${saved.repo}` : DEFAULT_REPO)
  const [branch, setBranch] = useState(saved?.branch || DEFAULT_BRANCH)
  const [token, setToken] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const connect = async () => {
    const [owner, name] = repo.trim().split('/')
    const cfg: GhConfig = { owner, repo: name, branch: branch.trim() || 'main', token: token.trim() || saved?.token || '' }
    if (!owner || !name || !cfg.token) return setMsg('⚠️ Fill in the repo (owner/name) and a token.')
    setBusy(true)
    setMsg('⏳ Checking…')
    try {
      const s = new GitHubSource(cfg)
      const me = await s.me()
      const files = await s.loadAll()
      store.set('hq.github', cfg)
      store.set('hq.mode', 'github')
      setMsg(`✅ Connected as ${me.login} · ${files.length} files`)
      onConnect(s)
      go('/')
    } catch (e: any) {
      setMsg('❌ ' + (e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const useLocal = () => {
    store.set('hq.mode', 'local')
    onConnect(new LocalSource())
    go('/')
  }

  const disconnect = () => {
    store.del('hq.github')
    store.del('hq.mode')
    setToken('')
    onConnect(null)
    setMsg('Signed out. Token removed from this browser.')
  }

  return (
    <div className="settings">
      <Card icon={<Plug className="i" />} title="Connection">
        <div className="row wrap">
          <span className="pill">{source ? (source.kind === 'local' ? <><Monitor className="i sm" /> Local folder</> : <><Cloud className="i sm" /> {source.label}</>) : 'Not connected'}</span>
          {saved && <button className="btn ghost sm" onClick={disconnect}>Sign out</button>}
        </div>
      </Card>

      <Card icon={<CloudUpload className="i" />} title="Connect to your GitHub workspace">
        <ol className="steps">
          <li>
            Open{' '}
            <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">
              GitHub → new fine-grained token <ExternalLink className="i sm" />
            </a>
          </li>
          <li><b>Repository access:</b> Only select repositories → your workspace repo</li>
          <li><b>Permissions:</b> Contents → <b>Read and write</b></li>
          <li>Generate → paste it below</li>
        </ol>
        <div className="callout tone-warn">
          <Lock className="i" />
          <span>
            <b>Invited to someone else's repo?</b> Fine-grained tokens can't reach it. Use a{' '}
            <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener">classic token</a> with the <code>repo</code> box ticked and an expiry date.
          </span>
        </div>
        <div className="form">
          <label>Repo (owner/name)<input value={repo} onChange={(e) => setRepo(e.target.value)} /></label>
          <label>Branch<input value={branch} onChange={(e) => setBranch(e.target.value)} /></label>
          <label className="full">
            Token {saved?.token && <span className="muted small">(saved; leave empty to keep it)</span>}
            <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" />
          </label>
        </div>
        <div className="row wrap">
          <button className="btn primary" disabled={busy} onClick={connect}>Connect</button>
          {import.meta.env.DEV && <button className="btn ghost" onClick={useLocal}><Monitor className="i sm" /> Use local folder instead</button>}
          {msg && <span className="small">{msg}</span>}
        </div>
        <div className="muted small meta-line"><Lock className="i sm" /> The token stays in this browser only. It never goes into the repo.</div>
      </Card>

      <Card icon={<Palette className="i" />} title="Look">
        <div className="row wrap">
          <button className="btn" onClick={toggleTheme}>{theme === 'dark' ? <><Sun className="i sm" /> Switch to light</> : <><Moon className="i sm" /> Switch to dark</>}</button>
          <a className="btn ghost" href="#/design"><Palette className="i sm" /> Open the Design lab</a>
        </div>
      </Card>

      <Card icon={<Compass className="i" />} title="How HQ works">
        <table className="cmp">
          <tbody>
            <tr><td>Knowledge</td><td>.md files Claude writes → pushed to the private repo</td></tr>
            <tr><td>Board · To-dos · People</td><td>You write here → saved as .md files in the same repo</td></tr>
            <tr><td>Claude</td><td>Reads flagged posts on its next session (<code>git pull</code>), replies, pushes</td></tr>
            <tr><td>Gemini</td><td>A GitHub Action answers Ask AI questions (the key is a repo secret)</td></tr>
          </tbody>
        </table>
      </Card>
    </div>
  )
}
