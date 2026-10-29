// Check-in sheet (module D, blueprint §8.7 + spec §6.4): log one line in ~10 seconds. One input, a live "Reads as"
// line, chips to fix the guess (kind, project, time, energy), a "team can see" chip, tokens behind ⓘ. Enter or
// Ctrl+Enter saves, Esc closes, Undo toast. The draft lives in memory only (never in browser storage, blueprint P7): a
// failed save keeps the text. Blocked + @someone → "Also make a to-do for <name>?".
// Opens on the window event `hq:checkin` (the shell's Check in button, the L key, the palette, the phone More sheet)
// and calls preventDefault() so the shell knows. Mount it once (A2 mounts it in App); a second mounted copy stays idle.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useHQMaybe } from '../../lib/hq-context'
import { HQ_EVENTS, type CheckinDetail } from '../../lib/contracts'
import { displayName, projectSlug } from '../../lib/hq'
import { appendLog, askForHelp, logTargetFor, quickEntry, removeLogRow } from '../../lib/people'
import { entryMinutes, goalProgress, projectsOf, type NewEntry } from '../../lib/people-core'
import { Icon } from '../../lib/icons'
import { go } from '../../lib/router'
import { colorSlot, projectSlugOf } from '../shell/shell-core'
import { toast } from '../toast'
import { Sheet } from './Sheet'
import { applyOverrides, ciPlaceholder, entryText, fmtMinutes, kindIcon, kindLabel, readsAs, scaleField, type CiOverride } from './people-ui-core'

// One listener at a time, however many copies are mounted (App + a page during waves 1–3).
const hosts: symbol[] = []

const DEFAULT_CHIPS = [15, 30, 45, 60, 90]

export default function CheckInSheet() {
  const hq = useHQMaybe()
  const me = useRef(Symbol('checkin'))
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [o, setO] = useState<CiOverride>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ask, setAsk] = useState<{ to: string; logPath: string; when: string; title: string; project?: string } | null>(null)

  useEffect(() => {
    const id = me.current
    hosts.push(id)
    const onOpen = (e: Event) => {
      if (hosts[0] !== id) return
      e.preventDefault()
      const d = ((e as CustomEvent).detail || {}) as CheckinDetail
      if (typeof d.text === 'string' && d.text.trim()) setText(d.text.slice(0, 280))
      if (typeof d.project === 'string' && d.project) setO((x) => ({ ...x, project: d.project }))
      setErr('')
      setAsk(null)
      setOpen(true)
    }
    addEventListener(HQ_EVENTS.checkin, onOpen)
    return () => {
      removeEventListener(HQ_EVENTS.checkin, onOpen)
      const i = hosts.indexOf(id)
      if (i >= 0) hosts.splice(i, 1)
    }
  }, [])

  const model = hq?.model
  const login = hq?.me.login || ''
  const target = model && login ? logTargetFor(model, login) : null
  const cfg = target?.cfg
  const person = model?.roster.find((p) => p.login.toLowerCase() === login.toLowerCase())
  const mine = useMemo(() => (model && login ? projectsOf(login, model.all).filter((p) => p.status !== 'done') : []), [model, login])
  const others = useMemo(
    () => (model ? model.projects.filter((d) => String(d.data.status || 'active') !== 'done' && !mine.some((m) => m.slug === projectSlug(d))).map(projectSlug) : []),
    [model, mine],
  )
  const parsed = useMemo(() => (model && login && cfg ? quickEntry(model, login, text) : null), [model, login, cfg, text])
  const entry: NewEntry | null = parsed && cfg ? applyOverrides(parsed.entry, cfg, o) : null
  const titleOf = (slug: string) => String(model?.projects.find((d) => projectSlug(d) === slug)?.data.title || slug)
  const slotOf = (slug: string) => colorSlot(model?.projects.find((d) => projectSlugOf(d) === slug)?.data.color)
  const reads = entry && cfg ? readsAs(entry, cfg, titleOf) : null
  const ok = !!entry && !!cfg && !!entryText(entry, cfg)
  // Local mode without HQ_LOCAL_LOGIN: the server refuses people/ writes, so say so up front instead of failing.
  const readOnly = hq?.me.configured === false

  const close = () => {
    setOpen(false)
    setAsk(null)
  }

  const save = async () => {
    if (!hq || !entry || !cfg || !target || busy || readOnly) return
    if (!entryText(entry, cfg)) return setErr('Write what you did first')
    setBusy(true)
    setErr('')
    try {
      const e: NewEntry = { ...entry, at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') }
      const r = await appendLog(hq.source, hq.me, e, target)
      const bits = [kindLabel(e.kind || cfg.kinds[0]), e.project ? titleOf(e.project) : '', fmtMinutes(entryMinutes(e.fields, cfg))].filter(Boolean)
      let goal = ''
      try {
        if (person) {
          const g = goalProgress(person, hq.model.events, new Date().toISOString()).find((x) => x.goal.metric === 'checkins')
          if (g) goal = ` · ${Math.min(g.goal.target, g.actual + 1)} of ${g.goal.target} this ${g.goal.per}`
        }
      } catch {
        /* goal text is a nicety */
      }
      toast(`Logged · ${bits.join(' · ')}${goal}`, 'ok', {
        undo: r.written
          ? async () => {
            try {
              await removeLogRow(hq.source, hq.me, r.path, r.when, cfg)
              await hq.reload()
            } catch (x: any) {
              toast(String(x?.message || x), 'error')
            }
          }
          : undefined,
      })
      const to = e.kind === 'blocked' ? (e.ref || []).find((x) => x.startsWith('@'))?.slice(1) : ''
      setText('')
      setO({})
      if (to && r.written && to.toLowerCase() !== hq.me.login.toLowerCase()) {
        setAsk({ to, logPath: r.path, when: r.when, title: entryText(e, cfg), project: e.project || undefined })
      } else close()
      await hq.reload()
    } catch (x: any) {
      setErr(String(x?.message || x))
    } finally {
      setBusy(false)
    }
  }

  const askHelp = async () => {
    if (!hq || !ask || busy) return
    setBusy(true)
    try {
      await askForHelp(hq.source, hq.me, ask)
      toast(`Asked ${displayName(hq.model, ask.to)} for help · a to-do is in their For you`, 'ok')
      close()
      await hq.reload()
    } catch (x: any) {
      setErr(String(x?.message || x))
    } finally {
      setBusy(false)
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      save()
    }
  }

  if (!open) return null
  const name = person?.name || (hq ? displayName(hq.model, login) : '')
  const min = cfg?.fields.find((f) => f.type === 'number' && (f.key === 'minutes' || /^(m|min|mins|minutes)$/i.test(f.unit || '')))
  const sc = cfg ? scaleField(cfg) : undefined
  const projectChips = [...mine.map((p) => p.slug), ...others].slice(0, 6)
  const curMin = entry && min ? (entry.fields[min.key] as number | undefined) : undefined
  const curSc = entry && sc ? (entry.fields[sc.key] as number | undefined) : undefined

  return (
    <Sheet open onClose={close} labelledBy="ci-title" initial="#ci-line" className="ci-sheet">
      <div className="ci" onKeyDown={onKey}>
        <div className="pp-h">
          <Icon name="plus" />
          <h2 id="ci-title">
            Check in{name && <span className="ci-as"> · as {name}</span>}
          </h2>
          <span className="chip line" data-tipt="Everyone on the team and Pinwheel's AI can read logs">
            <Icon name="eye" />
            team can see
          </span>
        </div>
        {!hq ? (
          <p className="muted">Loading your workspace…</p>
        ) : !target || !cfg ? (
          <div className="empty">
            <Icon name="user" />
            <p>Set up your profile first. Your check-ins go into your own log.</p>
            <button
              className="btn primary sm"
              type="button"
              onClick={() => {
                close()
                go('/people')
              }}
            >
              Set up my profile
            </button>
          </div>
        ) : ask ? (
          <div className="ci-ask" role="group" aria-labelledby="ci-ask-q">
            <p id="ci-ask-q">
              Also make a to-do for <b>{displayName(hq.model, ask.to)}</b>? It shows in their For you and closes your blocker when done.
            </p>
            <div className="pp-ctrl">
              <button className="btn primary sm" type="button" onClick={askHelp} disabled={busy}>
                Yes, ask {displayName(hq.model, ask.to)}
              </button>
              <button className="btn ghost sm" type="button" onClick={close}>
                No
              </button>
            </div>
          </div>
        ) : (
          <>
            <label className="sr" htmlFor="ci-line">
              What did you do?
            </label>
            <input
              id="ci-line"
              className="inp ci-line"
              placeholder={ciPlaceholder(cfg, mine[0]?.slug)}
              autoComplete="off"
              maxLength={600}
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setErr('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault()
                  save()
                }
              }}
            />
            <div className="reads" aria-live="polite" id="ci-reads">
              <span>Reads as:</span>
              {reads && (
                <>
                  <span className={'kind k-' + reads.kind}>
                    <Icon name={kindIcon(reads.kind)} />
                  </span>
                  <b className="fg2">{kindLabel(reads.kind)}</b>
                  {reads.project && (
                    <span className="pj">
                      · <i className={'pdot pc' + slotOf(entry!.project)} aria-hidden="true" />
                      {reads.project}
                    </span>
                  )}
                  {reads.bits.map((b) => (
                    <span key={b}>· {b}</span>
                  ))}
                </>
              )}
            </div>
            <div className="ci-grid">
              <span id="ci-k">Kind</span>
              <div className="pp-chips" role="group" aria-labelledby="ci-k">
                {cfg.kinds.map((k) => (
                  <button key={k} className="qchip" type="button" aria-pressed={reads?.kind === k} onClick={() => setO((x) => ({ ...x, kind: k }))}>
                    <span className={'kind sm k-' + k}>
                      <Icon name={kindIcon(k)} />
                    </span>
                    {kindLabel(k)}
                  </button>
                ))}
              </div>
              {projectChips.length > 0 && (
                <>
                  <span id="ci-p">Project</span>
                  <div className="pp-chips" role="group" aria-labelledby="ci-p">
                    {projectChips.map((s) => (
                      <button key={s} className="qchip" type="button" aria-pressed={entry?.project === s} onClick={() => setO((x) => ({ ...x, project: entry?.project === s ? '' : s }))}>
                        <i className={'pdot pc' + slotOf(s)} aria-hidden="true" />
                        {titleOf(s)}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {min && (
                <>
                  <span id="ci-t">Time</span>
                  <div className="pp-chips" role="group" aria-labelledby="ci-t">
                    {(min.chips && min.chips.length ? min.chips : DEFAULT_CHIPS).map((m) => (
                      <button key={m} className="qchip" type="button" aria-pressed={curMin === m} onClick={() => setO((x) => ({ ...x, minutes: curMin === m ? null : m }))}>
                        {m}m
                      </button>
                    ))}
                  </div>
                </>
              )}
              {sc && (
                <>
                  <span id="ci-e">{sc.label}</span>
                  <div className="energy" role="group" aria-labelledby="ci-e">
                    {Array.from({ length: Math.max(2, Math.min(10, sc.max || 5)) }, (_, i) => i + 1).map((n) => (
                      <button key={n} type="button" aria-pressed={curSc === n} aria-label={`${sc.label} ${n}`} onClick={() => setO((x) => ({ ...x, scale: curSc === n ? null : n }))}>
                        {n}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {err && (
              <p className="pp-err" role="alert">
                <Icon name="alert" size="s" /> {err}
              </p>
            )}
            {readOnly && (
              <p className="pp-err" role="note">
                <Icon name="info" size="s" /> Viewing only: set HQ_LOCAL_LOGIN in .env.local to save check-ins.
              </p>
            )}
          </>
        )}
      </div>
      {hq && target && cfg && !ask && (
        <div className="pp-foot">
          <span className="info-i" tabIndex={0} role="note" aria-label="Shortcuts in the line: #win +project 45m energy=4 @name" data-tipt="Shortcuts in the line: #win +project 45m energy=4 @name">
            <Icon name="info" size="s" />
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn ghost" type="button" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" type="button" onClick={save} disabled={!ok || busy || readOnly}>
            {busy ? 'Saving…' : 'Save'}
            <span className="kbd">Ctrl ↵</span>
          </button>
        </div>
      )}
    </Sheet>
  )
}
export { CheckInSheet }
