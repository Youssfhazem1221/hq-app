// My logging (module D, blueprint §6 + §8.9): what my check-ins ask for. Start from a preset or a teammate's setup,
// then fields (≤8: label, type, required, unit/max/options/chips, order), kinds (≤6), header tiles (≤3), goals (≤5),
// week start and the quiet-day nudge. Live preview of what the check-in sheet will ask. Save writes only the `log:`
// block of my profile, block style (saveLogConfig: validated, relabelled fields keep their old labels).
import { useMemo, useState } from 'react'
import { useHQ } from '../../lib/hq-context'
import { saveLogConfig } from '../../lib/people'
import { KINDS, LIMITS, METRICS, PRESETS, keyOf, validateConfig, type FieldType, type Goal, type LogConfig, type LogField } from '../../lib/people-core'
import { Icon } from '../../lib/icons'
import { toast } from '../toast'
import { Callout } from '../ui'
import { PRESET_LABEL, kindIcon, kindLabel, sensitiveFields } from './people-ui-core'

const TYPES: [FieldType, string][] = [['text', 'text'], ['number', 'number'], ['scale', 'scale 1–5'], ['choice', 'choice'], ['bool', 'yes / no']]
const KIND_LIST = Object.keys(KINDS).filter((k) => k !== 'unblocked')
const METRIC_LABEL: Record<string, string> = { checkins: 'check-ins', wins: 'wins', learned: 'learned', todos_done: 'to-dos done', posts: 'posts', replies: 'replies', minutes: 'time (min)', hours: 'time (h)' }
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

export function LogSettings({ onDone }: { onDone?: () => void }) {
  const { model, me, source, reload } = useHQ()
  const person = model.roster.find((p) => p.login.toLowerCase() === me.login.toLowerCase())
  const [cfg, setCfg] = useState<LogConfig>(() => clone(person?.log || PRESETS.minimal))
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const teammates = model.roster.filter((p) => p.status === 'active' && p.login.toLowerCase() !== me.login.toLowerCase())
  const check = useMemo(() => validateConfig(cfg), [cfg])
  const warn = sensitiveFields(cfg)
  if (!person) return <p className="muted">Set up your profile first.</p>

  const set = (patch: Partial<LogConfig>) => setCfg((c) => ({ ...c, ...patch, preset: patch.preset ?? 'custom' }))
  const setField = (i: number, patch: Partial<LogField>) => set({ fields: cfg.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) })
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= cfg.fields.length) return
    const fs = [...cfg.fields]
    ;[fs[i], fs[j]] = [fs[j], fs[i]]
    set({ fields: fs })
  }
  const addField = () => {
    if (cfg.fields.length >= LIMITS.fields) return
    let n = cfg.fields.length + 1
    while (cfg.fields.some((f) => f.key === `field${n}`)) n++
    set({ fields: [...cfg.fields, { key: `field${n}`, label: `Field ${n}`, type: 'text' }] })
  }
  const toggleKind = (k: string) => {
    const has = cfg.kinds.includes(k)
    if (has && cfg.kinds.length === 1) return
    if (!has && cfg.kinds.length >= LIMITS.kinds) return
    set({ kinds: has ? cfg.kinds.filter((x) => x !== k) : [...cfg.kinds, k] })
  }
  const numberKeys = cfg.fields.filter((f) => f.type === 'number').map((f) => f.key)
  const metrics = [...new Set([...METRICS, ...numberKeys])]
  const toggleTile = (m: string) => {
    const has = cfg.tiles.includes(m)
    if (!has && cfg.tiles.length >= LIMITS.tiles) return
    set({ tiles: has ? cfg.tiles.filter((x) => x !== m) : [...cfg.tiles, m] })
  }
  const setGoal = (i: number, patch: Partial<Goal>) => set({ goals: cfg.goals.map((g, j) => (j === i ? { ...g, ...patch } : g)) })

  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      // keys follow the labels the person typed (a new field's key), old keys stay put
      const known = new Set((person.log.fields || []).map((f) => f.key))
      const fields = cfg.fields.map((f) => (known.has(f.key) || !/^field\d+$/.test(f.key) ? f : { ...f, key: keyOf(f.label) || f.key }))
      const r = await saveLogConfig(source, me, { ...cfg, fields })
      setErrors(r.errors)
      toast(r.written ? 'Log settings saved' : 'No change to save', r.written ? 'ok' : 'info')
      if (r.written) await reload()
      if (!r.errors.length) onDone?.()
    } catch (e: any) {
      setErrors([String(e?.message || e)])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ls">
      <div className="pp-h">
        <Icon name="gear" />
        <h2 id="ls-title">My logging</h2>
        <span className="chip line" data-tipt="Everything here is visible to the team and to HQ's AI">
          <Icon name="eye" />
          visible to the team
        </span>
      </div>
      <div className="ls-start">
        <span className="hint">Start from</span>
        <div className="pp-chips">
          {Object.keys(PRESETS).map((k) => (
            <button key={k} className="qchip" type="button" aria-pressed={cfg.preset === k} onClick={() => setCfg({ ...clone(PRESETS[k as keyof typeof PRESETS]), week_starts: cfg.week_starts })}>
              {PRESET_LABEL[k] || k}
            </button>
          ))}
          {teammates.length > 0 && (
            <>
              <label className="sr" htmlFor="ls-copy">
                Copy from a teammate
              </label>
              <select
                id="ls-copy"
                className="inp sm"
                value=""
                onChange={(e) => {
                  const t = teammates.find((p) => p.login === e.target.value)
                  if (t) setCfg({ ...clone(t.log), preset: 'custom' })
                }}
              >
                <option value="">Copy from teammate…</option>
                {teammates.map((p) => (
                  <option key={p.login} value={p.login}>
                    {p.name}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>

      <div className="ls-body">
        <div className="ls-main">
          <h3 className="ls-h">Fields</h3>
          <div className="ls-fields" role="list">
            {cfg.fields.map((f, i) => (
              <div className="ls-f" role="listitem" key={f.key + i}>
                <label className="sr" htmlFor={'lf-l' + i}>
                  Field {i + 1} label
                </label>
                <input id={'lf-l' + i} className="inp sm" value={f.label} maxLength={24} onChange={(e) => setField(i, { label: e.target.value })} />
                <label className="sr" htmlFor={'lf-t' + i}>
                  Field {i + 1} type
                </label>
                <select id={'lf-t' + i} className="inp sm" value={f.type} onChange={(e) => setField(i, { type: e.target.value as FieldType, ...(e.target.value === 'scale' ? { max: 5 } : {}) })}>
                  {TYPES.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                {f.type === 'number' && (
                  <>
                    <label className="sr" htmlFor={'lf-u' + i}>
                      Unit
                    </label>
                    <input id={'lf-u' + i} className="inp sm ls-unit" placeholder="unit" maxLength={8} value={f.unit || ''} onChange={(e) => setField(i, { unit: e.target.value || undefined })} />
                  </>
                )}
                {f.type === 'choice' && (
                  <>
                    <label className="sr" htmlFor={'lf-o' + i}>
                      Options (space separated)
                    </label>
                    <input
                      id={'lf-o' + i}
                      className="inp sm"
                      placeholder="options: deep review client"
                      value={(f.options || []).join(' ')}
                      onChange={(e) => setField(i, { options: e.target.value.split(/[\s,]+/).filter(Boolean).slice(0, 8) })}
                    />
                  </>
                )}
                <label className="ls-req">
                  <input type="checkbox" checked={!!f.required} onChange={(e) => setField(i, { required: e.target.checked || undefined })} />
                  required
                </label>
                <span className="ls-ord">
                  <button className="icon-btn" type="button" aria-label={`Move ${f.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <Icon name="up" size="s" />
                  </button>
                  <button className="icon-btn" type="button" aria-label={`Move ${f.label} down`} disabled={i === cfg.fields.length - 1} onClick={() => move(i, 1)}>
                    <Icon name="down" size="s" />
                  </button>
                  <button className="icon-btn" type="button" aria-label={`Remove ${f.label}`} disabled={cfg.fields.length === 1} onClick={() => set({ fields: cfg.fields.filter((_, j) => j !== i) })}>
                    <Icon name="x" size="s" />
                  </button>
                </span>
              </div>
            ))}
          </div>
          {cfg.fields.length < LIMITS.fields && (
            <button className="more" type="button" onClick={addField}>
              <Icon name="plus" size="s" /> Add field
            </button>
          )}

          <h3 className="ls-h">Kinds</h3>
          <div className="pp-chips">
            {KIND_LIST.map((k) => (
              <button key={k} className="qchip" type="button" aria-pressed={cfg.kinds.includes(k)} onClick={() => toggleKind(k)}>
                <span className={'kind sm k-' + k}>
                  <Icon name={kindIcon(k)} />
                </span>
                {kindLabel(k)}
              </button>
            ))}
          </div>

          <h3 className="ls-h">Header tiles · pick {LIMITS.tiles}</h3>
          <div className="pp-chips">
            {metrics.map((m) => (
              <button key={m} className="qchip" type="button" aria-pressed={cfg.tiles.includes(m)} onClick={() => toggleTile(m)}>
                {METRIC_LABEL[m] || m}
              </button>
            ))}
          </div>

          <h3 className="ls-h">Goals</h3>
          {cfg.goals.map((g, i) => (
            <div className="ls-goal" key={i}>
              <label className="sr" htmlFor={'lg-n' + i}>
                Target
              </label>
              <input id={'lg-n' + i} className="inp sm ls-num" type="number" min={1} value={g.target} onChange={(e) => setGoal(i, { target: Number(e.target.value) })} />
              <label className="sr" htmlFor={'lg-m' + i}>
                Metric
              </label>
              <select id={'lg-m' + i} className="inp sm" value={g.metric} onChange={(e) => setGoal(i, { metric: e.target.value })}>
                {metrics.map((m) => (
                  <option key={m} value={m}>
                    {METRIC_LABEL[m] || m}
                  </option>
                ))}
              </select>
              <span className="hint">per</span>
              <label className="sr" htmlFor={'lg-p' + i}>
                Per
              </label>
              <select id={'lg-p' + i} className="inp sm" value={g.per} onChange={(e) => setGoal(i, { per: e.target.value as Goal['per'] })}>
                <option value="week">week</option>
                <option value="month">month</option>
              </select>
              <button className="icon-btn" type="button" aria-label="Remove goal" onClick={() => set({ goals: cfg.goals.filter((_, j) => j !== i) })}>
                <Icon name="x" size="s" />
              </button>
            </div>
          ))}
          {cfg.goals.length < LIMITS.goals && (
            <button className="more" type="button" onClick={() => set({ goals: [...cfg.goals, { metric: 'checkins', per: 'week', target: 4 }] })}>
              <Icon name="plus" size="s" /> Add goal
            </button>
          )}

          <div className="ls-row">
            <label htmlFor="ls-week">Week starts</label>
            <select id="ls-week" className="inp sm" value={cfg.week_starts} onChange={(e) => set({ week_starts: e.target.value as LogConfig['week_starts'], preset: cfg.preset })}>
              <option value="sat">Saturday</option>
              <option value="sun">Sunday</option>
              <option value="mon">Monday</option>
            </select>
            <label htmlFor="ls-nudge">Nudge after</label>
            <input id="ls-nudge" className="inp sm ls-num" type="number" min={0} max={14} value={cfg.nudge_days} onChange={(e) => set({ nudge_days: Number(e.target.value), preset: cfg.preset })} />
            <span className="hint">quiet days (0 = off)</span>
          </div>
        </div>

        <aside className="ls-prev" aria-label="Preview">
          <h3 className="ls-h">Your check-in asks</h3>
          <ul className="ls-ask">
            {check.config.fields.map((f) => (
              <li key={f.key}>
                <b>{f.label}</b>
                {f.required && <span aria-label="required"> *</span>}
                <span className="hint">
                  {' '}
                  {f.type === 'scale' ? `1–${f.max || 5}` : f.type === 'number' ? f.unit || 'number' : f.type === 'choice' ? (f.options || []).join(' · ') : f.type === 'bool' ? 'yes / no' : 'text'}
                </span>
              </li>
            ))}
          </ul>
          <p className="hint">Kinds: {check.config.kinds.map(kindLabel).join(' · ')}</p>
        </aside>
      </div>

      {warn.length > 0 && (
        <Callout icon="eye">
          <b>{warn.join(', ')}</b> looks personal. Everyone on the team and HQ's AI can read it. Keep it only if you're fine with that.
        </Callout>
      )}
      {(errors.length > 0 || check.errors.length > 0) && (
        <div className="pp-err" role="alert">
          <Icon name="alert" size="s" />
          <span>{[...new Set([...errors, ...check.errors])].slice(0, 4).join(' · ')}</span>
        </div>
      )}
      <div className="pp-foot">
        <span className="hint">Visible to the team and Ask AI.</span>
        <span style={{ flex: 1 }} />
        {onDone && (
          <button className="btn ghost" type="button" onClick={onDone}>
            Cancel
          </button>
        )}
        <button className="btn primary" type="button" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
export default LogSettings
