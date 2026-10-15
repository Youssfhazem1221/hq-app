// The journey strip (spec §4, D6): every project as ONE picture. [flag start] ● ● ● ◉NOW ○ ○ [goal], the fill up to
// NOW, an "N done" label, the NOW card carrying the project's one Next button (A's NextBar variant 'journey'), the goal
// line, People + Numbers chips and an "All N milestones" toggle. Nodes are 24 px buttons with roving focus (←/→,
// Home/End: one tab stop); their tooltip = milestone + date. Colour = the project's validated slot (class cN).
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Icon } from '../../lib/icons'
import { useHQMaybe } from '../../lib/hq-context'
import type { NextItem } from '../../lib/contracts'
import { journeyModel, type DocLike } from '../../lib/auto-visuals'
import { Avatar, Toggle } from '../ui'
import { NextBar } from '../shell/NextBar'

type Props = {
  /** The project's project.md (a parsed Doc). */
  project: DocLike | null | undefined
  /** The project's Next item (C1's nextFor). It rides in the NOW card with its one button. */
  next?: NextItem | null
  /** Defaults to the NextActions context (C1's provider). */
  onAct?: (item: NextItem) => void
  /** The Numbers chip scrolls to this element id (the project's Numbers section). */
  numbersId?: string
  /** Owner only: a project with no milestones shows one "Add the first milestone" field (its one action). */
  onAddMilestone?: (text: string) => Promise<unknown>
  className?: string
}

const sameLogin = (a: unknown, b: unknown) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()

export function Journey({ project, next, onAct, numbersId = 'numbers', onAddMilestone, className }: Props) {
  const m = useMemo(() => journeyModel<NextItem>(project, next ?? null), [project, next])
  const hq = useHQMaybe()
  const [cur, setCur] = useState(m.focusK)
  const nodes = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => setCur(m.focusK), [m.focusK])
  const at = Math.max(0, Math.min(cur, m.nodes.length - 1))

  const owner = m.owner ? hq?.model.roster.find((p) => sameLogin(p.login, m.owner) || sameLogin(p.slug, m.owner)) : undefined
  const ownerName = owner?.name || m.owner || ''
  const first = ownerName.split(/\s+/)[0]

  const onKey = (e: KeyboardEvent) => {
    const n = m.nodes.length
    const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null
    if (to === null || to < 0 || to >= n) return
    e.preventDefault()
    setCur(to)
    nodes.current[to]?.focus()
  }
  const toNumbers = () => {
    const el = document.getElementById(numbersId)
    if (!el) return
    el.scrollIntoView({ block: 'start' })
    const h = el.querySelector<HTMLElement>('h2, h3')
    if (h) {
      if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1')
      h.focus({ preventScroll: true })
    }
  }

  // No milestones yet: no count, no track, no caret (zeros are never shown). The owner gets one field to add the first
  // milestone, which replaces the template's placeholder Next; others see one quiet line.
  const empty = m.total === 0
  const addFirst = empty && !!onAddMilestone && (!m.next || m.next.kind === 'milestone')

  return (
    <section className={'journey pc' + m.color + (empty ? ' j-none' : '') + (className ? ' ' + className : '')} aria-label="Journey">
      <div className="j-top">
        {ownerName && (
          <span className="jchip">
            <Avatar name={ownerName} size={22} />
            {first} · owner
            {m.members.length > 0 && <span className="muted">+{m.members.length}</span>}
          </span>
        )}
        {m.metric && (
          <button type="button" className="jchip" onClick={toNumbers}>
            <Icon name="chart" size="s" />
            <b>{m.metric.value.toLocaleString('en')}</b> {m.metric.label.toLowerCase()}
          </button>
        )}
        <span className="sp" />
        {!empty && (
          <span className="j-count">
            <b>{m.done}</b> of {m.total} done
          </span>
        )}
      </div>

      {m.nodes.length > 0 && (
        <div className="j-row">
          <span className="j-end start" data-tipt={m.startedLabel ? 'Started ' + m.startedLabel : 'Start'}>
            <Icon name="flag" />
            {m.startedLabel && <small>{m.startedLabel}</small>}
          </span>
          <div className="j-track" role="group" aria-label={m.trackLabel} onKeyDown={onKey}>
            <span className="j-line" />
            <span className="j-fill" style={{ width: m.fill + '%' }} />
            {m.nodes.map((nd) => (
              <button
                key={nd.k}
                ref={(el) => {
                  nodes.current[nd.k] = el
                }}
                type="button"
                className={'jn ' + nd.kind}
                style={{ left: nd.pos + '%' }}
                tabIndex={nd.k === at ? 0 : -1}
                aria-label={nd.label}
                data-tipt={nd.tip + ': ' + nd.text}
                onFocus={() => setCur(nd.k)}
                onClick={(e) => e.currentTarget.focus()}
              >
                <i />
              </button>
            ))}
            {m.doneAt !== null && (
              <span className="j-lab" style={{ left: m.doneAt + '%' }} aria-hidden="true">
                {m.done} done
              </span>
            )}
          </div>
          <span className="j-end goal" data-tipt={m.goal ? 'Goal: ' + m.goal : 'Goal'}>
            <Icon name="win" />
            <small>Goal</small>
          </span>
        </div>
      )}

      {addFirst ? (
        <AddFirstMilestone onAdd={onAddMilestone!} />
      ) : m.next ? (
        <NextBar item={m.next} variant="journey" caret={empty ? undefined : m.nowX} onAct={onAct} />
      ) : m.goalReached ? (
        <div className="jnow done" style={{ ['--x' as string]: m.nowX + '%' }}>
          <div className="nb-t">
            <span className="k">
              <Icon name="win" size="s" />
              Goal reached
            </span>
            <p>{m.goal || 'Every milestone is done.'}</p>
          </div>
        </div>
      ) : empty ? (
        <p className="j-empty sm muted">No milestones yet.</p>
      ) : null}

      {m.goal && !m.goalReached && (
        <p className="j-goal">
          <Icon name="win" size="s" />
          <span>{m.goal}</span>
        </p>
      )}

      {m.total > 0 && (
        <Toggle className="jall" title={<span className="sm">All {m.total} {m.total === 1 ? 'milestone' : 'milestones'}</span>}>
          <ol className="tl">
            {m.milestones.map((ms) => (
              <li key={ms.index} className={ms.state === 'done' ? 'done' : ms.state === 'next' ? 'next' : ''}>
                <span className="nd" aria-hidden="true">{ms.state === 'done' && <Icon name="check" size="s" />}</span>
                <span className="tx">
                  {ms.text}
                  {ms.state !== 'later' && <span className="sr"> ({ms.state === 'done' ? 'done' : 'now'})</span>}
                </span>
                <span className="dt">{ms.dateLabel || (ms.state === 'next' ? 'now' : '')}</span>
              </li>
            ))}
          </ol>
        </Toggle>
      )}
    </section>
  )
}
export default Journey

function AddFirstMilestone({ onAdd }: { onAdd: (text: string) => Promise<unknown> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    try {
      await onAdd(t)
      setText('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="jnow j-add" onSubmit={submit}>
      <label className="nb-t">
        <span className="k">
          <Icon name="flag" size="s" />
          Add the first milestone
        </span>
        <input className="inp" value={text} maxLength={140} placeholder="e.g. Ship a first version" onChange={(e) => setText(e.target.value)} disabled={busy} />
      </label>
      <button className="btn primary sm" type="submit" disabled={busy || !text.trim()}>
        Add
      </button>
    </form>
  )
}
