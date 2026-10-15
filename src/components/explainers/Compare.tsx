// Compare: options side by side. Meters carry a stated meaning (meter_note in the key row); evidence = icon + word;
// the recommended row is marked with a chip (never colour alone). Narrow blocks show one card per option. An open
// decision about this doc (ctx.decide) adds ONE Next bar with its Decide button; otherwise `next` is a callout.
import { Fragment } from 'react'
import { Icon } from '../../lib/icons'
import { NextBar } from '../shell/NextBar'
import type { IconName, NextItem } from '../../lib/contracts'
import type { CompareCell, CompareSpec, EvidencePart, ExTone } from './parse'

export const TONE_ICON: Record<ExTone, IconName> = { ok: 'check', warn: 'info', idea: 'thought' }
export const TONE_KEY: Record<ExTone, string> = { ok: 'verified', warn: 'risk', idea: 'not researched' }

export function Evidence({ part }: { part: Pick<EvidencePart, 'text' | 'tone'> }) {
  return (
    <span className={'ev' + (part.tone ? ' ' + part.tone : '')}>
      {part.tone && <Icon name={TONE_ICON[part.tone]} />}
      {part.text || (part.tone ? TONE_KEY[part.tone] : '')}
    </span>
  )
}

function Cell({ c, note }: { c: CompareCell; note: string }) {
  if (c.parts && c.parts.length)
    return (
      <span className="evs">
        {c.parts.map((p, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="sep" aria-hidden="true"> · </span>}
            <Evidence part={p} />
          </Fragment>
        ))}
      </span>
    )
  if (c.meter !== null) {
    const pct = Math.round(c.meter * 100)
    return (
      <span className="speed">
        <span className="meter" role="img" aria-label={(note ? note + ': ' : '') + pct + '%'}>
          <i style={{ width: pct + '%' }} />
        </span>
        <span>{c.text}</span>
      </span>
    )
  }
  if (c.tone) return <Evidence part={c} />
  return <>{c.text}</>
}

const hasContent = (c: CompareCell) => !!(c.text || c.tone || c.meter !== null || (c.parts && c.parts.length))

export function Compare({ spec, decide }: { spec: CompareSpec; decide?: NextItem | null }) {
  const hasMeter = spec.rows.some((r) => r.cells.some((c) => c.meter !== null))
  const tones = (['ok', 'warn', 'idea'] as ExTone[]).filter((t) => spec.rows.some((r) => r.cells.some((c) => c.tone === t || (c.parts || []).some((p) => p.tone === t))))
  return (
    <div className="cmpx">
      {((hasMeter && spec.meter_note) || tones.length > 0) && (
        <div className="legend cmp-key">
          {hasMeter && spec.meter_note && (
            <span>
              <span className="meter mini" aria-hidden="true"><i style={{ width: '75%' }} /></span>
              {spec.meter_note}
            </span>
          )}
          {tones.map((t) => <Evidence key={t} part={{ text: TONE_KEY[t], tone: t }} />)}
        </div>
      )}
      <div className="cmp-wrap">
        <table className="cmp">
          <thead>
            <tr>
              <th scope="col" className="rk">#</th>
              <th scope="col">Option</th>
              {spec.columns.map((c, i) => <th key={i} scope="col">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((r, i) => (
              <tr key={i} className={r.pick ? 'pick' : ''}>
                <td className="rk"><span className="rank">{i + 1}</span></td>
                <th scope="row">
                  {r.pick && (
                    <span className="chip acc">
                      <Icon name="check" />
                      recommended
                    </span>
                  )}
                  {r.name}
                </th>
                {spec.columns.map((col, k) => (
                  <td key={k} data-label={col}>
                    {r.cells[k] && hasContent(r.cells[k]) ? <Cell c={r.cells[k]} note={spec.meter_note} /> : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {decide ? (
        <div className="cmp-next">
          <NextBar item={decide} />
        </div>
      ) : spec.next ? (
        <div className="callout cmp-next">
          <Icon name="arrow" />
          <span>
            <b>Next:</b> {spec.next}
          </span>
        </div>
      ) : null}
    </div>
  )
}
