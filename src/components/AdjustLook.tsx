// "Adjust look" drawer (spec §7.4): non-modal, NO scrim, the page live-previews beside it (phone: a 62 vh sheet).
// Describe a change → the local rules answer at once, then Gemini (ui-tweak) refines it; both are normalized to enum-only
// prefs before anything is previewed. One toggleable chip per change, Apply / Cancel / Esc, "Can't do yet" with the
// person's own words + Send as idea to Board, one-tap presets, history, Reset, the raw JSON.
// Opens on the window event `hq:adjust-look` (detail {query?}) from the top bar, Ctrl+., the palette or Settings.
// Also registers the palette's Look items: the presets, and "Adjust look: “…”" at the top when the rules find a change.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../lib/icons'
import { HQ_EVENTS, fire, type AdjustLookDetail, type IconName, type PaletteItem, type PrefsApi, type UiPrefs } from '../lib/contracts'
import { useCurrentRoute, useHQMaybe, usePrefsApi } from '../lib/hq-context'
import { onEscape, rememberFocus, restoreFocus } from '../lib/focus'
import { postMessage } from '../lib/hq'
import { LABEL, PRESETS, WIDGETS, clauseText, fmtPref, parseTweakLocal, presetPatch, resolvePrefs, type PrefKey } from '../lib/ui-prefs-core'
import { localSuggestion, lookExtras, suggestLook, type LookContext, type Suggestion } from '../lib/prefs'
import { navList, pagesTree, projectSlugOf, registerPaletteSource } from './shell/shell-core'
import { toast } from './toast'

// ---- one drawer for the whole app: the oldest mounted instance handles the event (App's, once A2 mounts it; until
// then the one inside Settings) ----
let seq = 0
const live: number[] = []
const shared: { api: PrefsApi | null } = { api: null }
let unregister: (() => void) | null = null
const watchers = new Set<() => void>()
const changed = () => watchers.forEach((f) => f())

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** Palette items (group Look): the presets, and "Adjust look: “q”" first when the local rules find a change. */
export function lookPaletteItems(q: string, api: PrefsApi | null = shared.api): PaletteItem[] {
  if (!api) return []
  const items: PaletteItem[] = PRESETS.map((p) => ({
    id: 'look:preset:' + p.id,
    group: 'Look',
    icon: p.icon as IconName,
    label: `${p.name} · ${p.sub}`,
    hint: 'one tap',
    keywords: 'preset look ' + p.id,
    run: () => api.apply(presetPatch(p.id) || {}, p.name),
  }))
  const wish = q.trim()
  if (wish) {
    const n = Object.keys(parseTweakLocal(wish, api.prefs).patch).length
    if (n)
      items.unshift({
        id: 'look:tweak',
        group: 'Look',
        icon: 'wand',
        label: `Adjust look: “${wish.slice(0, 80)}”`,
        hint: plural(n, 'change'),
        top: true,
        run: () => void fire(HQ_EVENTS.adjustLook, { query: wish.slice(0, 200) }),
      })
  }
  return items
}

const activeOf = (s: Suggestion | null, off: Record<string, boolean>): Partial<UiPrefs> => {
  const out: Record<string, unknown> = {}
  if (!s) return out
  for (const [k, v] of Object.entries(s.result.patch)) if (!off[k]) out[k] = v
  return out as Partial<UiPrefs>
}

export function AdjustLook() {
  const api = usePrefsApi()
  const hq = useHQMaybe()
  const route = useCurrentRoute()
  const [id] = useState(() => ++seq)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [before, setBefore] = useState<UiPrefs | null>(null)
  const [sug, setSug] = useState<Suggestion | null>(null)
  const [off, setOff] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<Record<number, 'sending' | 'sent'>>({})
  const input = useRef<HTMLInputElement>(null)
  const apiRef = useRef(api)
  apiRef.current = api
  shared.api = api
  const openRef = useRef(open)
  openRef.current = open
  const sugRef = useRef(sug)
  sugRef.current = sug
  const beforeRef = useRef(before)
  beforeRef.current = before
  const [primary, setPrimary] = useState(false)
  const gen = useRef(0)
  const ctxRef = useRef<() => LookContext>(() => ({ page: 'home' }))
  ctxRef.current = () => {
    const m = hq?.model || null
    const projects = (m?.projects || []).map((p) => ({ id: 'project:' + projectSlugOf(p), title: String(p.data.title || projectSlugOf(p)) }))
    const t = pagesTree(m)
    const docs = [...t.dirs.flatMap((d) => d.items), ...t.files].map((d) => ({ id: 'doc:' + d.path, title: d.title }))
    const p = resolvePrefs(apiRef.current.prefs)
    return { page: route.page.toLowerCase(), widgets: [...WIDGETS.home], nav: navList(p), pinnable: [...projects, ...docs].slice(0, 30) }
  }

  // registry: oldest instance owns the drawer; the palette source is registered once for all instances
  useEffect(() => {
    const watch = () => setPrimary(live[0] === id)
    watchers.add(watch)
    live.push(id)
    if (!unregister) unregister = registerPaletteSource((query) => lookPaletteItems(query))
    changed()
    return () => {
      watchers.delete(watch)
      const i = live.indexOf(id)
      if (i >= 0) live.splice(i, 1)
      if (!live.length && unregister) {
        unregister()
        unregister = null
      }
      changed()
    }
  }, [id])

  // what the look was before this preview (the committed look while nothing is previewed)
  const base = sug && before ? before : resolvePrefs(api.prefs)

  const suggest = useCallback(
    (text: string, from: UiPrefs) => {
      const wish = text.trim()
      const g = ++gen.current
      setOff({})
      setSent({})
      if (!wish) {
        setSug(null)
        setBusy(false)
        apiRef.current.preview({})
        return
      }
      setBefore(from)
      const local = localSuggestion(wish, from)
      setSug(local)
      apiRef.current.preview(local.result.patch)
      if (!hq) return setBusy(false) // signed out: the rules only
      setBusy(true)
      suggestLook(hq.source, wish, from, ctxRef.current())
        .then((s) => {
          if (g !== gen.current || !openRef.current) return
          setSug(s)
          setOff({})
          apiRef.current.preview(s.result.patch)
        })
        .finally(() => g === gen.current && setBusy(false))
    },
    [hq],
  )

  const focusInput = () =>
    setTimeout(() => {
      const i = input.current
      if (!i) return
      i.focus()
      const n = i.value.length
      i.setSelectionRange(n, n)
    }, 40)

  // open on hq:adjust-look
  useEffect(() => {
    const onOpen = (e: Event) => {
      if (live[0] !== id) return
      e.preventDefault()
      const query = String((e as CustomEvent<AdjustLookDetail>).detail?.query || '').slice(0, 200)
      const wasOpen = openRef.current
      if (!wasOpen) {
        rememberFocus()
        setSug(null)
        setBefore(null)
        setOff({})
        setSent({})
        setQ('')
        gen.current++
        setBusy(false)
      }
      setOpen(true)
      openRef.current = true
      if (query) {
        setQ(query)
        const from = wasOpen && sugRef.current && beforeRef.current ? beforeRef.current : resolvePrefs(apiRef.current.prefs)
        suggest(query, from)
      }
      focusInput()
    }
    addEventListener(HQ_EVENTS.adjustLook, onOpen)
    return () => removeEventListener(HQ_EVENTS.adjustLook, onOpen)
  }, [id, suggest])
  const close = useCallback((restore: boolean) => {
    gen.current++
    setOpen(false)
    openRef.current = false
    setBusy(false)
    setSug(null)
    setBefore(null)
    setOff({})
    if (restore) restoreFocus()
  }, [])
  const cancel = useCallback(() => {
    apiRef.current.preview({})
    close(true)
  }, [close])

  // Esc closes (and restores the look); unmounting mid-preview drops the preview
  useEffect(() => {
    if (!open) return
    return onEscape(() => cancel())
  }, [open, cancel])
  useEffect(() => () => void (openRef.current && apiRef.current.preview({})), [])

  if (!open && !primary) return null

  const keys = sug ? (Object.keys(sug.result.patch) as PrefKey[]) : []
  const active = activeOf(sug, off)
  const n = Object.keys(active).length
  const cant = sug ? sug.result.unsupported.map((i) => ({ i, text: clauseText(sug.clauses[i]) })).filter((c) => c.text) : []
  const ex = lookExtras(api)

  const toggle = (k: string) => {
    const next = { ...off, [k]: !off[k] }
    setOff(next)
    api.preview(activeOf(sug, next))
  }
  const applyNow = () => {
    if (!n) return
    const label = Object.keys(active).map((k) => LABEL[k as PrefKey] || k).join(', ')
    api.apply(active, label)
    close(true)
  }
  const preset = (pid: string) => {
    const p = presetPatch(pid)
    const pr = PRESETS.find((x) => x.id === pid)
    if (!p || !pr) return
    gen.current++
    setBusy(false)
    api.apply(p, pr.name) // replaces any preview
    setSug(null)
    setOff({})
  }
  const reset = () => {
    gen.current++
    setBusy(false)
    setSug(null)
    setOff({})
    api.reset()
  }
  const sendIdea = async (i: number, text: string) => {
    if (!hq || sent[i]) return
    setSent((s) => ({ ...s, [i]: 'sending' }))
    try {
      await postMessage(hq.source, hq.me, { type: 'idea', body: `Look wish: “${text}”`, forClaude: false })
      setSent((s) => ({ ...s, [i]: 'sent' }))
      toast('Posted to Board as an idea', 'ok')
      void hq.refresh()
    } catch (e) {
      setSent((s) => {
        const c = { ...s }
        delete c[i]
        return c
      })
      toast(`Couldn't post: ${String((e as Error)?.message || e).slice(0, 120)}`, 'error')
    }
  }

  const where = ex?.path ? 'Saved to your profile' : 'Saved on this device'
  const tip = ex?.path ? `${ex.path} · syncs to your devices` : 'This browser only'

  return (
    <aside className={'drawer look-dr' + (open ? ' on' : '')} role="dialog" aria-modal="false" aria-labelledby="al-title" aria-hidden={!open}>
      <div className="dr-h">
        <h2 id="al-title">
          <Icon name="wand" />
          Adjust look
        </h2>
        <button className="icon-btn" type="button" aria-label="Close" onClick={cancel}>
          <Icon name="x" />
        </button>
      </div>
      <div className="dr-b">
        <div className="dr-sec">
          <form
            className="al-in"
            onSubmit={(e) => {
              e.preventDefault()
              suggest(q, sug && before ? before : resolvePrefs(api.prefs))
            }}
          >
            <label className="sr" htmlFor="al-q">
              Describe a change
            </label>
            <input
              id="al-q"
              ref={input}
              className="inp"
              placeholder="e.g. bigger text and calmer colours"
              value={q}
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setQ(e.target.value)}
            />
            <button className="btn primary" type="submit">
              <Icon name="spark" size="s" />
              Suggest
            </button>
          </form>
          <p className="hint al-sub">Gemini picks from fixed options only. Nothing is saved until you apply.</p>
          <p className="hint al-status" aria-live="polite">
            {busy ? (
              <>
                <Icon name="loader" size="s" className="spin" /> Asking Gemini…
              </>
            ) : (
              sug?.note || ''
            )}
          </p>
        </div>

        {keys.length > 0 && (
          <div className="dr-sec">
            <h3>Preview · {plural(n, 'change')}</h3>
            <div className="patch">
              {keys.map((k) => (
                <button key={k} type="button" className={'pchip' + (off[k] ? ' off' : '')} aria-pressed={!off[k]} onClick={() => toggle(k)}>
                  <span className="cbx" aria-hidden="true" {...(off[k] ? {} : { 'aria-checked': 'true' })}>
                    <Icon name="check" size="s" />
                  </span>
                  <span className="k">{LABEL[k] || k}</span>
                  <span className="from">{fmtPref(k, base[k])}</span>
                  <Icon name="arrow" size="s" />
                  <span className="to">{fmtPref(k, sug!.result.patch[k])}</span>
                </button>
              ))}
            </div>
            <div className="al-ctrl">
              <button className="btn primary" type="button" disabled={!n} onClick={applyNow}>
                Apply {n}
              </button>
              <button className="btn" type="button" onClick={cancel}>
                Cancel
              </button>
              <details className="tg al-json">
                <summary>
                  <Icon name="chevR" size="s" className="chev" />
                  <span>JSON</span>
                </summary>
                <pre className="json">{JSON.stringify({ patch: sug!.result.patch, unsupported: sug!.result.unsupported }, null, 2)}</pre>
              </details>
            </div>
          </div>
        )}

        {cant.length > 0 ? (
          <div className="dr-sec cant">
            <h3>
              <Icon name="info" size="s" />
              Can’t do yet
            </h3>
            {cant.map((c) => (
              <div className="cant-r" key={c.i}>
                <q>{c.text}</q>
                {hq && (
                  <button className="btn sm" type="button" disabled={!!sent[c.i]} onClick={() => sendIdea(c.i, c.text)}>
                    <Icon name={sent[c.i] === 'sent' ? 'check' : 'idea'} size="s" />
                    {sent[c.i] === 'sent' ? 'Sent to Board' : sent[c.i] ? 'Sending…' : 'Send as idea to Board'}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          sug &&
          !keys.length &&
          !busy && (
            <div className="callout">
              <Icon name="info" />
              <span>No change found. Try “bigger text”, “focus”, “hide Board”.</span>
            </div>
          )
        )}

        {ex?.offer && (
          <div className="dr-sec al-offer">
            <p>
              <b>Keep this look on all your devices?</b>
              <span className="hint"> It goes into your profile, which the team can see.</span>
            </p>
            <div className="al-ctrl">
              <button className="btn primary sm" type="button" onClick={() => void ex.keepEverywhere()}>
                Save
              </button>
              <button className="btn ghost sm" type="button" onClick={ex.dismissOffer}>
                Not now
              </button>
            </div>
          </div>
        )}

        <div className="dr-sec">
          <h3>One tap · no AI</h3>
          <div className="presets">
            {PRESETS.map((p) => (
              <button key={p.id} className="preset" type="button" onClick={() => preset(p.id)}>
                <Icon name={p.icon as IconName} />
                {p.name}
                <span>{p.sub}</span>
              </button>
            ))}
          </div>
        </div>

        {ex && ex.history.length > 0 && (
          <div className="dr-sec">
            <h3>History</h3>
            <div className="hist rows">
              {ex.history.slice(0, 5).map((h, i) => (
                <div className="row" key={h.at + ':' + i}>
                  <Icon name="history" size="s" />
                  <span className="t">{h.label}</span>
                  {i === 0 ? (
                    <button
                      className="btn ghost sm"
                      type="button"
                      onClick={() => {
                        setSug(null)
                        api.undo()
                      }}
                    >
                      <Icon name="undo" size="s" />
                      Undo
                    </button>
                  ) : (
                    <span className="meta">earlier</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="dr-sec dr-foot">
          <button className="btn ghost" type="button" onClick={reset}>
            <Icon name="undo" size="s" />
            Reset to default
          </button>
          <span className="hint">{ex?.save === 'error' ? 'Not saved to your profile yet' : where}</span>
          <span className="info-i" tabIndex={0} role="img" aria-label={tip} data-tipt={tip}>
            <Icon name="info" size="s" />
          </span>
        </div>
      </div>
    </aside>
  )
}

export default AdjustLook
