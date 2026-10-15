// Emphasis scatter (spec §4): x = speed to first money (ordinal 1-4), y = how sure we are (untested · mixed ·
// verified). Numbered dots; the recommended option in accent, the rest in context grey (--mark-ctx, ≥3:1); text labels
// in ink, placed only where they don't collide (only the pick under 480 px); 36 px hit circles with one tab stop
// (←/→ move); an estimated speed gets a dashed ring; legend; Table twin. Data: lib/auto-visuals scatterPoints().
import { useMemo, useRef, useState, useId, type KeyboardEvent, type ReactNode } from 'react'
import { EVIDENCE_LABEL, SPEED_LABEL, scatterPoints, MAX_OPTIONS, type ScatterPoint, type Speed } from '../../lib/auto-visuals'
import { DataTable, TableToggle, useWidth } from '../charts'

type Props = {
  /** The doc's raw `options:` list (frontmatter). */
  options?: unknown
  /** Or points you already computed with scatterPoints(). */
  points?: ScatterPoint[]
  /** Rank (1-based) of the option that was picked: drawn with a ring. */
  pick?: number | null
  /** Clicking / Enter on a dot. Without it the dots are read-only (tooltip + label). */
  onPick?: (rank: number) => void
  title?: string
  sub?: string
  chip?: ReactNode
  className?: string
}

const SHORT_SPEED: Record<Speed, string> = { 1: 'months', 2: 'date', 3: '1–2 mo', 4: 'weeks' }
const R = 11
const R_PICK = 13
const HIT = 18
const charW = (s: string, bold: boolean) => s.length * (bold ? 7.1 : 6.7)

type Placed = { p: ScatterPoint; cx: number; cy: number; r: number; label: null | { x: number; anchor: 'start' | 'end' } }

/** Dots (jittered when two share a cell) + labels that never overlap a dot or another label. */
export function layoutScatter(points: ScatterPoint[], W: number, H: number) {
  const L = W < 420 ? 60 : 72
  const Rm = 16
  const T = 24
  const B = 46
  const x = (v: number) => L + ((W - L - Rm) * (v - 0.5)) / 4
  const y = (v: number) => T + (H - T - B) * (1 - (v - 0.5) / 3)
  const cells = new Map<string, ScatterPoint[]>()
  for (const p of points) {
    const k = p.speed + ':' + p.evidence
    cells.set(k, [...(cells.get(k) || []), p])
  }
  const placed: Placed[] = points.map((p) => {
    const group = cells.get(p.speed + ':' + p.evidence)!
    const j = group.indexOf(p)
    return { p, cx: x(p.speed) + (j - (group.length - 1) / 2) * 28, cy: y(p.evidence), r: p.pick ? R_PICK : R, label: null }
  })
  const narrow = W < 480
  const lo = 2
  const hi = W - 2
  for (const ev of [1, 2, 3]) {
    const row = placed.filter((d) => d.p.evidence === ev).sort((a, b) => a.cx - b.cx)
    const taken: [number, number][] = row.map((d) => [d.cx - d.r - 3, d.cx + d.r + 3])
    // The pick first (it must get its label), then left to right.
    for (const d of [...row].sort((a, b) => Number(b.p.pick) - Number(a.p.pick))) {
      if (narrow && !d.p.pick) continue
      const w = charW(d.p.short, d.p.pick)
      const right: [number, number] = [d.cx + d.r + 5, d.cx + d.r + 5 + w]
      const left: [number, number] = [d.cx - d.r - 5 - w, d.cx - d.r - 5]
      // A label sits outside its own dot (5 px gap > the dot's 3 px margin), so it is checked against everything taken.
      const fits = (s: [number, number]) => s[0] >= lo && s[1] <= hi && !taken.some((t) => s[0] < t[1] && s[1] > t[0])
      const order = d.p.speed === 4 ? [left, right] : [right, left]
      const s = order.find(fits)
      if (!s) continue
      taken.push(s)
      d.label = s === right ? { x: s[0], anchor: 'start' } : { x: s[1], anchor: 'end' }
    }
  }
  return { L, Rm, T, B, x, y, placed }
}

export function Scatter({ options, points: given, pick = null, onPick, title = 'Speed × how sure we are', sub = 'Top right = fast money, verified', chip, className }: Props) {
  const points = useMemo(() => given || scatterPoints(options), [given, options])
  const total = given ? given.length : Array.isArray(options) ? Math.min(options.length, MAX_OPTIONS) : points.length
  const [ref, W] = useWidth(240)
  const [table, setTable] = useState(false)
  const [cur, setCur] = useState(0)
  const hits = useRef<(SVGCircleElement | null)[]>([])
  const id = useId()
  const H = Math.max(230, Math.min(300, Math.round(W * 0.32)))
  const lay = useMemo(() => layoutScatter(points, W, H), [points, W, H])
  const band = (W - lay.L - lay.Rm) / 4
  const ticks = band < 74 ? SHORT_SPEED : SPEED_LABEL
  const hasPick = points.some((p) => p.pick)
  const estimated = points.some((p) => p.estimated)
  const missing = Math.max(0, total - points.length)
  const best = points.find((p) => p.pick)
  const at = Math.min(cur, Math.max(0, points.length - 1))

  const onKey = (e: KeyboardEvent, i: number) => {
    if ((e.key === 'Enter' || e.key === ' ') && onPick) {
      e.preventDefault()
      onPick(points[i].rank)
      return
    }
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? points.length - 1 : null
    if (to === null || to < 0 || to >= points.length) return
    e.preventDefault()
    setCur(to)
    hits.current[to]?.focus()
  }

  const summary =
    `${title}. ` +
    (best ? `Recommended: #${best.rank} ${best.name}, first money ${best.firstMoney || SPEED_LABEL[best.speed]}, evidence ${EVIDENCE_LABEL[best.evidence]}. ` : '') +
    points.filter((p) => !p.pick).map((p) => `#${p.rank} ${p.short}: ${SPEED_LABEL[p.speed]}, ${EVIDENCE_LABEL[p.evidence]}`).join('; ')

  return (
    <figure className={'viz scatter' + (className ? ' ' + className : '')}>
      <figcaption className="viz-h">
        <div>
          <span className="viz-t">
            {title}
            {chip}
          </span>
          {sub && <p>{sub}</p>}
        </div>
        {points.length > 0 && <TableToggle on={table} onChange={setTable} controls={id} />}
      </figcaption>
      {points.length > 0 && !table && (
        <div className="legend">
          {hasPick && (
            <span>
              <i className="lg-pick" />
              Recommended
            </span>
          )}
          <span>
            <i className="lg-ctx" />
            {hasPick ? 'Other options' : 'Options'}
          </span>
          {estimated && (
            <span>
              <i className="lg-est" />
              estimated speed
            </span>
          )}
          {pick != null && (
            <span>
              <i className="lg-picked" />
              your pick
            </span>
          )}
        </div>
      )}
      <div id={id} className="viz-body" ref={ref}>
        {!points.length ? (
          <p className="hint">No option has both a speed and evidence yet.</p>
        ) : table ? (
          <DataTable
            caption={title}
            columns={['#', 'Option', 'First money', 'Evidence', 'Paid in']}
            rows={points.map((p) => [p.rank, p.name + (p.pick ? ' (recommended)' : '') + (pick === p.rank ? ' (picked)' : ''), (p.firstMoney || SPEED_LABEL[p.speed]) + (p.estimated ? ' (estimated)' : ''), EVIDENCE_LABEL[p.evidence], p.paidIn || null])}
          />
        ) : (
          <div className="plot">
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={summary}>
              {[1, 2, 3].map((k) => (
                <g key={'y' + k}>
                  <line className="gl" x1={lay.L} x2={W - lay.Rm} y1={lay.y(k)} y2={lay.y(k)} />
                  <text className="vtick" x={lay.L - 8} y={lay.y(k) + 4} textAnchor="end">{EVIDENCE_LABEL[k as 1 | 2 | 3]}</text>
                </g>
              ))}
              {([1, 2, 3, 4] as Speed[]).map((s) => (
                <text key={'x' + s} className="vtick" x={lay.x(s)} y={H - lay.B + 18} textAnchor="middle">{ticks[s]}</text>
              ))}
              <line className="bl" x1={lay.L} x2={W - lay.Rm} y1={H - lay.B + 2} y2={H - lay.B + 2} />
              <text className="axl" x={W - lay.Rm} y={H - 3} textAnchor="end">faster to first money →</text>
              <text className="axl" x={4} y={lay.T - 8}>↑ surer</text>
              {lay.placed.map((d) => (
                <g key={'p' + d.p.rank} className={'spt' + (d.p.pick ? ' pick' : '') + (pick === d.p.rank ? ' picked' : '') + (d.p.estimated ? ' est' : '')}>
                  <circle cx={d.cx} cy={d.cy} r={d.r} />
                  <text x={d.cx} y={d.cy + 4} textAnchor="middle">{d.p.rank}</text>
                </g>
              ))}
              {lay.placed.map((d) =>
                d.label ? (
                  <text key={'l' + d.p.rank} className={'splab' + (d.p.pick ? ' pick' : '')} x={d.label.x} y={d.cy + 4} textAnchor={d.label.anchor}>
                    {d.p.short}
                  </text>
                ) : null,
              )}
              {lay.placed.map((d, i) => (
                <circle
                  key={'h' + d.p.rank}
                  ref={(el) => {
                    hits.current[i] = el
                  }}
                  className="hit"
                  cx={d.cx}
                  cy={d.cy}
                  r={HIT}
                  role={onPick ? 'button' : 'img'}
                  tabIndex={i === at ? 0 : -1}
                  aria-label={d.p.label}
                  data-tipt={`#${d.p.rank} ${d.p.name} · ${d.p.paidIn ? 'paid in ' + d.p.paidIn + ' · ' : ''}first money ${d.p.firstMoney || SPEED_LABEL[d.p.speed]}${d.p.estimated ? ' (estimated)' : ''} · ${EVIDENCE_LABEL[d.p.evidence]}`}
                  onFocus={() => setCur(i)}
                  onClick={onPick ? () => onPick(d.p.rank) : undefined}
                  onKeyDown={(e) => onKey(e, i)}
                />
              ))}
            </svg>
          </div>
        )}
      </div>
      {missing > 0 && <p className="hint">{missing === 1 ? '1 option has' : `${missing} options have`} no speed or evidence yet.</p>}
    </figure>
  )
}
export default Scatter
