// The Decide sheet (spec §4, D12): a decision is a choice, not a page. Lead sentence → scatter (speed × how sure we are,
// the recommended option highlighted) → one row per option with **Pick this** (primary on the recommended row) → Both
// #1 + #2 · Other… (inline input). Picking calls back with the choice text; NextActions writes it (decide()) and shows
// the toast with Undo. Modal on desktop, bottom sheet on phones; Esc and the scrim close it; focus returns to the opener.
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Icon } from '../lib/icons'
import { useHQMaybe } from '../lib/hq-context'
import { onEscape, restoreFocus } from '../lib/focus'
import type { NextItem } from '../lib/contracts'
import { EVIDENCE_LABEL, SPEED_LABEL, scatterPoints } from '../lib/auto-visuals'
import { choiceLabel, decisionDoc, projectOfTodo, type NextModel } from '../lib/next-core'
import { Scatter } from './visuals/Scatter'
import { ProjectGlyph, projectBySlug } from './work-ui'

type Props = { item: NextItem; onClose: () => void; onPick: (choice: string) => void }

const txt = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

export default function DecideSheet({ item, onClose, onPick }: Props) {
  const hq = useHQMaybe()
  const titleId = useId()
  const head = useRef<HTMLHeadingElement>(null)
  const otherRef = useRef<HTMLInputElement>(null)
  const rows = useRef<(HTMLButtonElement | null)[]>([])
  const [other, setOther] = useState(false)
  const [draft, setDraft] = useState('')

  const model = hq?.model
  const todo = model && item.path ? model.byPath.get(item.path) : undefined
  const m = model as unknown as NextModel | undefined
  const doc = todo && m ? decisionDoc(todo, m) : undefined
  const options: unknown[] = Array.isArray(doc?.data?.options) ? doc!.data.options : []
  const points = useMemo(() => scatterPoints(options), [options])
  const slug = item.project || (todo && m ? projectOfTodo(todo, m) : undefined)
  const project = model ? projectBySlug(model, slug) : undefined
  const rec = points.find((p) => p.pick)

  const close = () => {
    onClose()
    restoreFocus()
  }
  useEffect(() => {
    const t = setTimeout(() => (options.length ? head.current : otherRef.current || head.current)?.focus({ preventScroll: true }), 30)
    const off = onEscape(close)
    return () => {
      clearTimeout(t)
      off()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (other) otherRef.current?.focus()
  }, [other])

  const lead =
    txt(doc?.data?.summary) ||
    (rec ? `#${rec.rank} ${rec.name} is recommended: first money in ${rec.firstMoney || SPEED_LABEL[rec.speed]}, ${EVIDENCE_LABEL[rec.evidence]} evidence.` : '') ||
    (options.length ? `${options.length} options. Pick one, both of the first two, or your own.` : 'Write down what you decided.')

  const pick = (i: number | 'both') => {
    const c = choiceLabel(options, i)
    if (c) onPick(c)
  }
  const submitOther = (e: FormEvent) => {
    e.preventDefault()
    const c = choiceLabel(options, draft)
    if (c) onPick(c)
  }
  const evidenceOf = (i: number) => {
    const p = points.find((x) => x.rank === i + 1)
    return p ? EVIDENCE_LABEL[p.evidence] : ''
  }

  return (
    <>
      <div className="scrim on" onClick={close} aria-hidden="true" />
      <div className="modal wide on dec-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="dec">
          <div className="dec-h">
            <ProjectGlyph project={project} />
            <h2 id={titleId} ref={head} tabIndex={-1}>
              {item.text}
            </h2>
            <button className="icon-btn" type="button" aria-label="Close" onClick={close}>
              <Icon name="x" />
            </button>
          </div>
          <p className="lead">{lead}</p>
          {points.length > 0 && (
            <Scatter
              points={points}
              title="Speed × how sure we are"
              sub=""
              onPick={(rank) => rows.current[rank - 1]?.focus()}
            />
          )}
          {options.length > 0 && (
            <div className="opts" role="list">
              {options.map((o: any, i) => {
                const name = txt(o?.name) || txt(o?.title) || txt(o) || `Option ${i + 1}`
                const recommended = o?.recommended === true || o?.pick === true
                const meta = [txt(o?.paid_in), txt(o?.first_money), evidenceOf(i)].filter(Boolean).join(' · ')
                return (
                  <div key={i} className={'opt' + (recommended ? ' pick' : '')} role="listitem">
                    <span className="rank" aria-hidden="true">{i + 1}</span>
                    <div className="ot">
                      <b>
                        {name}
                        {recommended && <span className="sr"> (recommended)</span>}
                      </b>
                      {meta && <span>{meta}</span>}
                    </div>
                    <button
                      ref={(el) => {
                        rows.current[i] = el
                      }}
                      className={'btn sm' + (recommended ? ' primary' : '')}
                      type="button"
                      aria-label={`Pick #${i + 1}: ${name}`}
                      onClick={() => pick(i)}
                    >
                      {recommended && <Icon name="check" size="s" />}
                      Pick this
                    </button>
                  </div>
                )
              })}
            </div>
          )}
          <div className="dec-f">
            {options.length >= 2 && (
              <button className="btn" type="button" onClick={() => pick('both')}>
                Both #1 + #2
              </button>
            )}
            {options.length > 0 && !other && (
              <button className="btn ghost" type="button" onClick={() => setOther(true)}>
                Other…
              </button>
            )}
            <span className="sp" />
            <span className="hint">Saved to the to-do</span>
            {(other || !options.length) && (
              <form className="other" onSubmit={submitOther}>
                <label className="sr" htmlFor={titleId + '-o'}>
                  Your direction
                </label>
                <input
                  ref={otherRef}
                  id={titleId + '-o'}
                  className="inp"
                  placeholder={options.length ? 'Your own direction' : 'What did you decide?'}
                  maxLength={120}
                  autoComplete="off"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button className="btn primary" type="submit" disabled={!draft.trim()}>
                  Save
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
