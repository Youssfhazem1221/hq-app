// Settings (spec §6.6): Appearance (presets + every look control + Home blocks + Describe a change… + Reset) ·
// Connection (status cards; GitHub token setup collapsed) · Shortcuts (the single-key switch, WCAG 2.1.4) · About.
// Every look change goes through the PrefsApi (normalized, previewable, undoable); nothing here writes CSS values.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Icon } from '../lib/icons'
import { HQ_EVENTS, fire, type IconName, type SettingsPageProps, type UiPrefs } from '../lib/contracts'
import { useHQMaybe, usePrefsApi } from '../lib/hq-context'
import { DEFAULT_BRANCH, DEFAULT_REPO } from '../config'
import { BAD_TOKEN_MSG, GitHubSource, LocalSource, type GhConfig } from '../lib/source'
import { go } from '../lib/router'
import { store } from '../lib/util'
import { LABEL, PRESETS, SIZE_PCT, WIDGET_NAME, presetPatch, resolvePrefs, type HomeWidget, type PrefKey } from '../lib/ui-prefs-core'
import { lookExtras } from '../lib/prefs'
import { PageHeader } from '../components/shell/PageHeader'
import { Segmented, Switch, Toggle } from '../components/ui'
import { JoinGuideButton } from '../components/people/JoinGuide'
import { AiKeys } from '../components/AiKeys'

export const v3 = true

type Props = SettingsPageProps & { theme?: string; toggleTheme?: () => void }

const SECTIONS: [string, IconName, string][] = [
  ['appearance', 'wand', 'Appearance'],
  ['connection', 'plug', 'Connection'],
  ['keys', 'lock', 'AI keys'],
  ['shortcuts', 'keyboard', 'Shortcuts'],
  ['about', 'info', 'About Pinwheel'],
]
const ACCENTS: [UiPrefs['accent'], string][] = [
  ['violet', 'Violet'], ['blue', 'Blue'], ['green', 'Green'], ['amber', 'Amber'], ['rose', 'Rose'], ['slate', 'Slate'],
]
const FONTS: [UiPrefs['font'], string, string][] = [
  ['inter', 'Figtree', 'Default'],
  ['lexend', 'Lexend', 'Readable · dyslexia-friendly'],
  ['atkinson', 'Atkinson', 'Hyperlegible'],
  ['system', 'System', 'Your device'],
]
/** [keys, what it does, single-key (switchable off)] */
const SHORTCUTS: [string, string, boolean?][] = [
  ['Ctrl K', 'Search, jump, create, ask, adjust the look'],
  ['L', 'Check in (log one line)', true],
  ['Ctrl .', 'Adjust look'],
  ['Ctrl \\', 'Collapse the sidebar'],
  ['G then H / P / T / B / A / E / S', 'Go to Home, Projects, Tasks, Board, Ask, People, Settings', true],
  ['N', 'New item on this page', true],
  ['X', 'Tick the focused to-do', true],
  ['← →', 'Step through an explainer or the journey'],
  ['Esc', 'Close'],
  ['?', 'This list', true],
]

function SetRow({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-row">
      <div>
        <b>{title}</b>
        {sub && <span>{sub}</span>}
      </div>
      <div className="set-ctl">{children}</div>
    </div>
  )
}

const noSub = () => () => {}

export default function Settings({ source, onConnect }: Props) {
  const api = usePrefsApi()
  const hq = useHQMaybe()
  const ex = lookExtras(api)
  const p = resolvePrefs(api.prefs)
  const [sec, setSec] = useState('appearance')
  const bell = hq?.bell || null
  const bellStatus = useSyncExternalStore(bell ? bell.subscribe : noSub, () => (bell ? bell.status : 'off'), () => 'off')

  const set = <K extends PrefKey>(k: K, v: UiPrefs[K], label?: string) => api.apply({ [k]: v } as Partial<UiPrefs>, label || LABEL[k])
  const seg = <K extends 'theme' | 'size' | 'lh' | 'density'>(k: K, opts: [UiPrefs[K], string][]) => (
    <Segmented<UiPrefs[K]> label={LABEL[k]} value={p[k]} options={opts} onChange={(v) => set(k, v)} />
  )
  const sw = <K extends 'motion' | 'contrast' | 'calm' | 'focus' | 'keys'>(k: K, on: UiPrefs[K], offV: UiPrefs[K], label: string) => (
    <Switch label={label} on={p[k] === on} onChange={(v) => set(k, v ? on : offV, label)} />
  )

  // ---- Home blocks: order + hide ----
  const moveUp = (w: HomeWidget) => {
    const o = [...p.home_order]
    const i = o.indexOf(w)
    if (i <= 0) return
    ;[o[i - 1], o[i]] = [o[i], o[i - 1]]
    set('home_order', o, 'Home order')
  }
  const toggleHide = (w: HomeWidget) => {
    const hidden = p.home_hidden.includes(w)
    set('home_hidden', hidden ? p.home_hidden.filter((x) => x !== w) : [...p.home_hidden, w], (hidden ? 'Show ' : 'Hide ') + WIDGET_NAME.home[w])
  }

  // ---- connection (GitHub token or this PC's folder) ----
  const saved = store.get<GhConfig | null>('hq.github', null)
  const [repo, setRepo] = useState(saved ? `${saved.owner}/${saved.repo}` : DEFAULT_REPO)
  const [branch, setBranch] = useState(saved?.branch || DEFAULT_BRANCH)
  const [token, setToken] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const connect = async () => {
    const [owner, name] = repo.trim().split('/')
    // spaces, line breaks and invisible characters ride along when a token is copied on a phone
    const pasted = token.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, '')
    const cfg: GhConfig = { owner, repo: name, branch: branch.trim() || 'main', token: pasted || saved?.token || '' }
    if (!owner || !name || !cfg.token) return setMsg('Fill in the repo (owner/name) and a token.')
    if (/[^\x21-\x7E]/.test(cfg.token)) return setMsg('Could not connect: ' + BAD_TOKEN_MSG)
    setBusy(true)
    setMsg('Checking…')
    try {
      const s = new GitHubSource(cfg)
      const me = await s.me()
      const files = await s.loadAll()
      store.set('hq.github', cfg)
      store.set('hq.mode', 'github')
      setMsg(`Connected as ${me.login} · ${files.length} files`)
      setToken('')
      onConnect(s)
      go('/')
    } catch (e: any) {
      setMsg('Could not connect: ' + String(e?.message || e).slice(0, 200))
    } finally {
      setBusy(false)
    }
  }
  const useLocal = () => {
    store.set('hq.mode', 'local')
    onConnect(new LocalSource())
    go('/')
  }
  const signOut = () => {
    store.del('hq.github')
    store.del('hq.mode')
    setToken('')
    onConnect(null)
    setMsg('Signed out. The token is removed from this browser.')
  }

  const jump = (id: string) => {
    setSec(id)
    document.getElementById('s-' + id)?.scrollIntoView({ block: 'start' })
  }
  // the section nav follows the reading position
  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') return
    const els = SECTIONS.map(([id]) => document.getElementById('s-' + id)).filter((e): e is HTMLElement => !!e)
    const seen = new Map<string, boolean>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting)
        const first = els.find((el) => seen.get(el.id))
        if (first) setSec(first.id.slice(2))
      },
      { rootMargin: '-64px 0px -55% 0px' },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
  const where = ex?.path ? 'Saved to your profile · syncs to your devices' : 'Saved on this device'
  const tip = ex?.path ? `${ex.path} · look settings only · the team can see it` : 'This browser only'
  const live: [string, 'ok' | 'warn' | 'line'] =
    bellStatus === 'live' ? ['on', 'ok'] : bellStatus === 'connecting' ? ['connecting', 'line'] : bellStatus === 'down' ? ['off', 'warn'] : ['off', 'line']

  return (
    <div className="settings-v3">
      <PageHeader
        icon="settings"
        title="Settings"
        sub={
          <>
            <span>{where}</span>{' '}
            <span className="info-i" tabIndex={0} role="img" aria-label={tip} data-tipt={tip}>
              <Icon name="info" size="s" />
            </span>
          </>
        }
      />
      <div className="set">
        <nav className="set-nav" aria-label="Settings sections">
          {SECTIONS.map(([id, icon, label]) => (
            <button key={id} type="button" aria-current={sec === id ? 'true' : undefined} onClick={() => jump(id)}>
              <Icon name={icon} size="s" />
              {label}
            </button>
          ))}
        </nav>

        <div className="set-main">
          {/* ---------------- Appearance ---------------- */}
          <section className="set-sec" id="s-appearance" aria-labelledby="s-appearance-h">
            <h2 id="s-appearance-h">Appearance</h2>
            <div className="presets">
              {PRESETS.map((x) => (
                <button key={x.id} className="preset" type="button" onClick={() => api.apply(presetPatch(x.id) || {}, x.name)}>
                  <Icon name={x.icon as IconName} />
                  {x.name}
                  <span>{x.sub}</span>
                </button>
              ))}
            </div>
            {ex?.offer && (
              <div className="callout al-offer">
                <Icon name="cloud" />
                <span>
                  <b>Keep this look on all your devices?</b> It goes into your profile, which the team can see.{' '}
                  <button className="btn primary sm" type="button" onClick={() => void ex.keepEverywhere()}>
                    Save
                  </button>{' '}
                  <button className="btn ghost sm" type="button" onClick={ex.dismissOffer}>
                    Not now
                  </button>
                </span>
              </div>
            )}
            <SetRow title="Theme" sub="Follows your system until you pick">
              {seg('theme', [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']])}
            </SetRow>
            <SetRow title="Accent" sub="Buttons, selection, focus">
              <div className="swatches" role="group" aria-label="Accent">
                {ACCENTS.map(([v, name]) => (
                  <button key={v} type="button" className={'swatch sw-' + v} aria-pressed={p.accent === v} aria-label={name} data-tipt={name} onClick={() => set('accent', v)} />
                ))}
              </div>
            </SetRow>
            <SetRow title="Text size" sub={SIZE_PCT[p.size]}>
              {seg('size', [['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL'], ['xxl', 'XXL']])}
            </SetRow>
            <div className="set-blk">
              <b className="sm">Font</b>
              <div className="fonts" role="group" aria-label="Font">
                {FONTS.map(([v, name, sub]) => (
                  <button key={v} type="button" className={'fontcard f-' + v} aria-pressed={p.font === v} onClick={() => set('font', v)}>
                    <b aria-hidden="true">Aa</b>
                    {name}
                    <span>{sub}</span>
                  </button>
                ))}
              </div>
            </div>
            <SetRow title="Line spacing" sub="More air between lines">
              {seg('lh', [['normal', 'Normal'], ['relaxed', 'Relaxed'], ['loose', 'Loose']])}
            </SetRow>
            <SetRow title="Density" sub="Space around blocks">
              {seg('density', [['compact', 'Compact'], ['comfy', 'Comfy'], ['spacious', 'Spacious']])}
            </SetRow>
            <SetRow title="Reduce motion" sub="No pulses, slides or auto-play">
              {sw('motion', 'reduced', 'system', 'Reduce motion')}
            </SetRow>
            <SetRow title="High contrast" sub="Darker text, stronger lines, underlined links">
              {sw('contrast', 'high', 'normal', 'High contrast')}
            </SetRow>
            <SetRow title="Calm colours" sub="Quieter pills, no counters">
              {sw('calm', 'on', 'off', 'Calm colours')}
            </SetRow>
            <SetRow title="Focus mode" sub="Only the Next line and the main block">
              {sw('focus', 'on', 'off', 'Focus mode')}
            </SetRow>
            <div className="set-blk">
              <b className="sm">Home blocks</b>
              <div className="rows">
                {p.home_order.map((w, i) => {
                  const hid = p.home_hidden.includes(w)
                  const name = WIDGET_NAME.home[w]
                  return (
                    <div className={'row' + (hid ? ' off' : '')} key={w}>
                      <Icon name="grip" size="s" />
                      <span className="t sm">{name}</span>
                      {hid && <span className="hint">hidden</span>}
                      <span className="meta">
                        <button className="icon-btn" type="button" aria-label={`Move ${name} up`} disabled={i === 0} onClick={() => moveUp(w)}>
                          <Icon name="up" size="s" />
                        </button>
                        <button className="icon-btn" type="button" aria-label={(hid ? 'Show ' : 'Hide ') + name} aria-pressed={hid} onClick={() => toggleHide(w)}>
                          <Icon name={hid ? 'eyeOff' : 'eye'} size="s" />
                        </button>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="al-ctrl">
              <button className="btn" type="button" onClick={() => fire(HQ_EVENTS.adjustLook, {})}>
                <Icon name="wand" size="s" />
                Describe a change…
              </button>
              <button className="btn ghost" type="button" onClick={() => api.reset()}>
                <Icon name="undo" size="s" />
                Reset to default
              </button>
            </div>
          </section>

          {/* ---------------- Connection ---------------- */}
          <section className="set-sec" id="s-connection" aria-labelledby="s-connection-h">
            <h2 id="s-connection-h">Connection</h2>
            <div className="conn">
              <div className="conn-i">
                <Icon name={source?.kind === 'local' ? 'local' : 'cloud'} />
                <b>{source ? (source.kind === 'local' ? 'This PC folder' : source.label) : 'Workspace'}</b>
                <span className={'chip ' + (source ? 'ok' : 'warn')}>
                  <Icon name={source ? 'check' : 'info'} />
                  {source ? 'connected' : 'not connected'}
                </span>
              </div>
              <div className="conn-i">
                <Icon name="bell" />
                <b>Live updates</b>
                <span className={'chip ' + live[1]}>
                  {live[1] === 'ok' && <Icon name="check" />}
                  {live[0]}
                </span>
              </div>
              {hq?.me && (
                <div className="conn-i">
                  <Icon name="user" />
                  <b>Signed in</b>
                  <span className="chip line">{hq.me.login}</span>
                </div>
              )}
            </div>
            <Toggle
              open={!source}
              title={<span className="sm">{!source ? 'Connect to your GitHub workspace' : source.kind === 'local' ? 'Use a GitHub token instead' : 'Change the repo or token'}</span>}
            >
              <ol className="steps4">
                <li>
                  <b>
                    <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">
                      Open GitHub <Icon name="ext" size="s" />
                    </a>
                  </b>
                  <span className="hint">new fine-grained token</span>
                </li>
                <li>
                  <b>Only your workspace repo</b>
                  <span className="hint">
                    invited to someone’s repo? a{' '}
                    <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener noreferrer">
                      classic token
                    </a>{' '}
                    with “repo”
                  </span>
                </li>
                <li>
                  <b>Contents: read + write</b>
                  <span className="hint">nothing else</span>
                </li>
                <li>
                  <b>Paste it below</b>
                  <span className="hint">it stays in this browser</span>
                </li>
              </ol>
              <form
                className="conn-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  void connect()
                }}
              >
                <div className="field">
                  <label htmlFor="set-repo">Repo (owner/name)</label>
                  <input id="set-repo" className="inp" value={repo} autoComplete="off" spellCheck={false} onChange={(e) => setRepo(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="set-branch">Branch</label>
                  <input id="set-branch" className="inp" value={branch} autoComplete="off" spellCheck={false} onChange={(e) => setBranch(e.target.value)} />
                </div>
                <div className="field full">
                  <label htmlFor="set-token">Token {saved?.token && <span className="hint">(saved; leave empty to keep it)</span>}</label>
                  <input id="set-token" className="inp" type="password" autoComplete="off" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} />
                </div>
                <div className="al-ctrl full">
                  <button className="btn primary" type="submit" disabled={busy}>
                    Connect
                  </button>
                  {import.meta.env.DEV && (
                    <button className="btn ghost" type="button" onClick={useLocal}>
                      <Icon name="local" size="s" />
                      Use this PC’s folder
                    </button>
                  )}
                  {saved && (
                    <button className="btn ghost" type="button" onClick={signOut}>
                      <Icon name="logout" size="s" />
                      Sign out
                    </button>
                  )}
                </div>
              </form>
              <p className="hint" role="status" aria-live="polite">
                {msg || (
                  <>
                    <Icon name="lock" size="s" /> The token stays in this browser only. It never goes into the repo.
                  </>
                )}
              </p>
            </Toggle>
          </section>

          {/* ---------------- AI keys ---------------- */}
          <section className="set-sec" id="s-keys" aria-labelledby="s-keys-h">
            <h2 id="s-keys-h">AI keys</h2>
            <AiKeys source={source as { kind: string; auth?: { token: string } } | null} />
          </section>

          {/* ---------------- Shortcuts ---------------- */}
          <section className="set-sec" id="s-shortcuts" aria-labelledby="s-shortcuts-h">
            <h2 id="s-shortcuts-h">Shortcuts</h2>
            <SetRow title="Single-key shortcuts" sub="L, G then a letter, N, X, ? · turn off for voice control">
              {sw('keys', 'on', 'off', 'Single-key shortcuts')}
            </SetRow>
            <div className="rows keys-list">
              {SHORTCUTS.map(([k, what, single]) => {
                const off = !!single && p.keys === 'off'
                return (
                  <div className={'row' + (off ? ' off' : '')} key={k}>
                    <span className="t sm wrap">
                      {what}
                      {off && <span className="hint"> · off</span>}
                    </span>
                    <span className="kbd">{k}</span>
                  </div>
                )
              })}
            </div>
          </section>

          {/* ---------------- About ---------------- */}
          <section className="set-sec" id="s-about" aria-labelledby="s-about-h">
            <h2 id="s-about-h">About Pinwheel</h2>
            <p className="fg2">Your notes live in one shared folder. The app shows them, AI answers questions about them, and Claude helps when you ask.</p>
            <div className="al-ctrl">
              <button className="btn" type="button" onClick={() => go('/docs/technical.md')}>
                <Icon name="map" size="s" />
                How Pinwheel works
              </button>
              <JoinGuideButton className="btn" />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
