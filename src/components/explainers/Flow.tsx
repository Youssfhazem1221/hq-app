// Flow / stepper (hand-written ```explainer blocks only; projects use the Journey strip): a chain of stages, one step
// card, Prev / Play / Next and dots. No step counter, no key hints (spec §5.1). The chain is a tablist with roving
// focus (←/→, Home/End: one tab stop); the dots are pointer shortcuts (the chain is the keyboard path).
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from '../../lib/icons'
import { reducedMotion } from '../../lib/bp'
import type { FlowSpec, ExStatus } from './parse'

const STATUS_TONE: Partial<Record<ExStatus, string>> = { done: 'ok', now: 'acc', next: 'acc', blocked: 'bad', wait: 'warn' }

export function Flow({ spec }: { spec: FlowSpec }) {
  const steps = spec.steps
  const n = steps.length
  const [i, setI] = useState(0)
  const [play, setPlay] = useState<'idle' | 'on' | 'done'>('idle')
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const uid = useId().replace(/[^\w-]/g, '')
  const at = Math.min(i, n - 1)
  const step = steps[at]

  const goTo = (k: number, focus = false) => {
    const j = ((k % n) + n) % n
    setI(j)
    if (focus) tabs.current[j]?.focus()
  }

  // Play walks the steps once, then offers Replay. Stops when the block unmounts.
  useEffect(() => {
    if (play !== 'on') return
    const t = setInterval(() => setI((c) => Math.min(n - 1, c + 1)), reducedMotion() ? 1600 : 2600)
    return () => clearInterval(t)
  }, [play, n])
  useEffect(() => {
    if (play === 'on' && at >= n - 1) setPlay('done')
  }, [play, at, n])

  const onKey = (e: KeyboardEvent) => {
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null
    if (to === null) return
    e.preventDefault()
    goTo(to, true)
  }
  const togglePlay = () => {
    if (play === 'on') return setPlay('idle')
    if (at >= n - 1) setI(0)
    setPlay('on')
  }

  return (
    <div className="flow">
      <div className="chain" style={{ ['--n' as string]: n }} role="tablist" aria-label="Steps" onKeyDown={onKey}>
        {steps.map((st, k) => (
          <button
            key={k}
            ref={(el) => {
              tabs.current[k] = el
            }}
            id={`${uid}-t${k}`}
            type="button"
            role="tab"
            className={'stage' + (k < at ? ' passed' : '')}
            aria-selected={k === at}
            aria-current={k === at ? 'step' : undefined}
            aria-controls={`${uid}-card`}
            tabIndex={k === at ? 0 : -1}
            onClick={() => goTo(k)}
          >
            <span className="sl">
              <Icon name={st.icon || 'arrow'} size="s" />
              {k + 1}
            </span>
            <span className="sv">{st.title}</span>
          </button>
        ))}
      </div>
      <div className="step-card" id={`${uid}-card`} role="tabpanel" aria-labelledby={`${uid}-t${at}`} aria-live="polite">
        <div className="in" key={at}>
          {step.status && (
            <div className="step-meta">
              <span className={'chip' + (STATUS_TONE[step.status] ? ' ' + STATUS_TONE[step.status] : '')}>{step.status}</span>
            </div>
          )}
          <h4>{step.title}</h4>
          {step.text && <p>{step.text}</p>}
          {step.bullets.length > 0 && (
            <ul className="blist">
              {step.bullets.map((b, k) => <li key={k}>{b}</li>)}
            </ul>
          )}
        </div>
      </div>
      {n > 1 && (
        <div className="ctrl">
          <button className="btn" type="button" onClick={() => goTo(at - 1)}>
            <Icon name="chevL" size="s" />
            Prev
          </button>
          <button className="btn primary" type="button" aria-pressed={play === 'on'} onClick={togglePlay}>
            <Icon name={play === 'on' ? 'pause' : 'play'} size="s" />
            <span>{play === 'on' ? 'Pause' : play === 'done' ? 'Replay' : 'Play'}</span>
          </button>
          <button className="btn" type="button" onClick={() => goTo(at + 1)}>
            Next
            <Icon name="chevR" size="s" />
          </button>
          <div className="dots" aria-hidden="true">
            {steps.map((_, k) => (
              <button key={k} type="button" tabIndex={-1} aria-current={k === at ? 'true' : undefined} onClick={() => goTo(k)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
