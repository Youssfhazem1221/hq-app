// Cards: a small grid of ideas. A card with "more" bullets opens in place (aria-expanded); a card without them is
// plain text (no control that does nothing).
import { useState } from 'react'
import { Icon } from '../../lib/icons'
import type { CardsSpec } from './parse'

export function Cards({ spec }: { spec: CardsSpec }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set())
  const toggle = (i: number) =>
    setOpen((o) => {
      const n = new Set(o)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })
  return (
    <div className="xcards">
      {spec.cards.map((c, i) => {
        const body = (
          <>
            <b>
              <Icon name={c.icon || 'info'} />
              {c.title}
            </b>
            {c.text && <span>{c.text}</span>}
          </>
        )
        if (!c.more.length) return <div key={i} className="xcard">{body}</div>
        const on = open.has(i)
        return (
          <button key={i} type="button" className="xcard" aria-expanded={on} onClick={() => toggle(i)}>
            {body}
            <span className="more-k">
              <Icon name="chevD" size="s" />
              {on ? 'Less' : 'More'}
            </span>
            {on && (
              <ul className="blist">
                {c.more.map((m, k) => <li key={k}>{m}</li>)}
              </ul>
            )}
          </button>
        )
      })}
    </div>
  )
}
