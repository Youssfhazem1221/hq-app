// One value against a target (spec §4): the honest form for a single snapshot. Value + label, a meter to the goal
// ("72% of 1,000"), or a dashed "no goal yet" track with one Set a goal button. The goal input is a small popover
// (number, Enter saves, Esc closes). Optional extra numbers sit under it (e.g. three 7-day counts).
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Icon } from '../../lib/icons'
import { Popover } from '../shell/Popover'

type Props = {
  value: number
  label: string
  goal?: number | null
  /** Saves a new goal. Without it there is no Set/Edit button. */
  onSetGoal?: (goal: number) => void
  /** Project colour slot 1-8 (class cN); default = accent. */
  color?: number
  /** One quiet line under the meter (e.g. "1 read so far (14 Oct)."). */
  note?: ReactNode
  /** Small numbers under the meter. */
  extra?: { value: ReactNode; label: string }[]
  /** Label of the goal input ("Follower goal"). */
  goalLabel?: string
  className?: string
}

const nice = (v: number) => {
  const target = Math.max(1, v * 1.2)
  const step = 10 ** Math.max(0, Math.floor(Math.log10(target)) - 1)
  return Math.ceil(target / step) * step
}
const n = (v: number) => (Number.isFinite(v) ? v.toLocaleString('en') : '–')

export function GoalMeter({ value, label, goal, onSetGoal, color, note, extra, goalLabel, className }: Props) {
  const has = typeof goal === 'number' && Number.isFinite(goal) && goal > 0
  const pct = has ? Math.round((100 * value) / (goal as number)) : 0
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const [draft, setDraft] = useState('')
  const inputId = useId()
  const slot = color && Number.isInteger(color) && color >= 1 && color <= 8 ? ' has-pc pc' + color : ''
  const save = (e: FormEvent) => {
    e.preventDefault()
    const v = Math.round(Number(draft))
    if (!Number.isFinite(v) || v < 1 || v > 1e9) return
    setOpen(false)
    btn.current?.focus({ preventScroll: true })
    onSetGoal?.(v)
  }
  return (
    <div className={'goal' + slot + (className ? ' ' + className : '')}>
      <div className="goal-h">
        <b className="num">{n(value)}</b>
        <span>{label}</span>
        <span className="sp" />
        {has && <span className="goal-t">{pct}% of {n(goal as number)}</span>}
        {onSetGoal && (
          <button
            ref={btn}
            className={'btn sm' + (has ? ' ghost' : '')}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => {
              setDraft(String(has ? goal : nice(value)))
              setOpen((o) => !o)
            }}
          >
            {!has && <Icon name="flag" size="s" />}
            {has ? 'Edit goal' : 'Set a goal'}
          </button>
        )}
      </div>
      <div className={'goal-track' + (has ? '' : ' none')} role="img" aria-label={has ? `${n(value)} of ${n(goal as number)} ${label} (${pct}%)` : `${n(value)} ${label}. No goal set yet`}>
        {has ? <i style={{ width: Math.max(0, Math.min(100, pct)) + '%' }} /> : <span>no goal yet</span>}
      </div>
      {note && <p className="hint">{note}</p>}
      {extra && extra.length > 0 && (
        <div className="mini-stats">
          {extra.map((x, i) => (
            <div key={i}>
              <b className="num">{x.value}</b>
              <span>{x.label}</span>
            </div>
          ))}
        </div>
      )}
      {onSetGoal && (
        <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} width={240} role="dialog" label={goalLabel || 'Goal'}>
          <form className="goalf" onSubmit={save}>
            <label className="sm" htmlFor={inputId}>
              <b>{goalLabel || 'Goal'}</b>
            </label>
            <input id={inputId} className="inp" type="number" min={1} max={1000000000} step={1} inputMode="numeric" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <button className="btn primary sm" type="submit">Save</button>
          </form>
        </Popover>
      )}
    </div>
  )
}
export default GoalMeter
