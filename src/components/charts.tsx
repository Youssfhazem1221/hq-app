// Charts drawn from a small JSON spec: ```chart blocks (AI answers, notes) and the app's own charts (time per project,
// energy, metrics). Dataviz rules: thin marks, hairline grid, rounded data ends, legend for 2+ series, a direct value
// label, a Table twin for every plot, one y-axis, categorical colours in fixed slot order (--viz-1..8, a validated
// int, never a colour from data). Drawn at the container's width; text only (React), nothing from the spec becomes HTML.
// JSON contract unchanged from v2; new optional keys: bar `stacked`, line `goal` / `min` / `max`, series and
// progress items `color` (slot 1-8). Styles: styles/visuals.css.
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icon } from '../lib/icons'

export type Series = { name: string; data: (number | null)[]; color?: number }
export type ChartSpec = {
  type: 'bar' | 'line' | 'stat' | 'progress' | 'table'
  title?: string
  subtitle?: string
  source?: string
  unit?: string
  labels?: string[]
  series?: Series[]
  horizontal?: boolean
  /** Bar only: stack the series (one bar per label, total on the newest bar). */
  stacked?: boolean
  /** Line only: a dashed reference line (e.g. a goal). */
  goal?: number
  /** Line only: a fixed y range (e.g. energy 1-5). */
  min?: number
  max?: number
  stats?: { label: string; value: number | string; delta?: string; good?: boolean }[]
  items?: { label: string; value: number; max: number; color?: number }[]
  columns?: string[]
  rows?: (string | number | null)[][]
}

const TYPES = ['bar', 'line', 'stat', 'progress', 'table'] as const
/** Byte budget for a chart block (same idea as the explainer cap): bigger → the code block shows. */
const MAX_CHARS = 16384
const CAP = { labels: 60, series: 8, stats: 8, items: 12, columns: 12, rows: 100, text: 80, cell: 120 }

type Rec = Record<string, unknown>
const isObj = (x: unknown): x is Rec => !!x && typeof x === 'object' && !Array.isArray(x)
const num = (v: unknown) =>
  typeof v === 'number' ? (Number.isFinite(v) ? v : null) : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null
const str = (v: unknown, n: number) => {
  const s = typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : ''
  const t = s.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}
const slot = (v: unknown) => {
  const n = num(v)
  return n !== null && Number.isInteger(n) && n >= 1 && n <= 8 ? n : undefined
}

/** Untrusted ```chart JSON → a clean spec, or null when it can't be drawn (the raw block shows instead). Total. */
export function parseChart(src: unknown): ChartSpec | null {
  try {
    if (typeof src === 'string' && src.length > MAX_CHARS) return null
    const s: unknown = typeof src === 'string' ? JSON.parse(src) : src
    if (!isObj(s) || !(TYPES as readonly unknown[]).includes(s.type)) return null
    const type = s.type as ChartSpec['type']
    const out: ChartSpec = { type }
    const title = str(s.title, CAP.text)
    const subtitle = str(s.subtitle, 140)
    const source = str(s.source, CAP.text)
    if (title) out.title = title
    if (subtitle) out.subtitle = subtitle
    if (source) out.source = source
    out.unit = str(s.unit, 12)
    if (type === 'bar' || type === 'line') {
      if (!Array.isArray(s.labels) || !Array.isArray(s.series)) return null
      const labels = s.labels.slice(0, CAP.labels).map((l) => str(l, 40))
      const series = s.series.slice(0, CAP.series).filter(isObj).map((x) => {
        const data = (Array.isArray(x.data) ? x.data : []).slice(0, labels.length).map(num)
        const c = slot(x.color)
        return { name: str(x.name, 40), data, ...(c ? { color: c } : {}) } as Series
      })
      if (!labels.length || !series.length) return null
      out.labels = labels
      out.series = series
      if (type === 'bar') {
        if (s.horizontal === true) out.horizontal = true
        if (s.stacked === true) out.stacked = true
      } else {
        const goal = num(s.goal)
        const min = num(s.min)
        const max = num(s.max)
        if (goal !== null) out.goal = goal
        if (min !== null && max !== null && max > min) {
          out.min = min
          out.max = max
        }
      }
    }
    if (type === 'stat') {
      if (!Array.isArray(s.stats)) return null
      out.stats = s.stats.slice(0, CAP.stats).filter(isObj).map((x) => ({
        label: str(x.label, 40),
        value: typeof x.value === 'number' && Number.isFinite(x.value) ? x.value : str(x.value, 24),
        ...(str(x.delta, 16) ? { delta: str(x.delta, 16) } : {}),
        ...(typeof x.good === 'boolean' ? { good: x.good } : {}),
      })).filter((x) => x.label || x.value !== '')
      if (!out.stats.length) return null
    }
    if (type === 'progress') {
      if (!Array.isArray(s.items)) return null
      out.items = s.items.slice(0, CAP.items).filter(isObj).flatMap((x) => {
        const value = num(x.value)
        const max = num(x.max)
        if (value === null || max === null) return []
        const c = slot(x.color)
        return [{ label: str(x.label, 40), value, max, ...(c ? { color: c } : {}) }]
      })
      if (!out.items.length) return null
    }
    if (type === 'table') {
      if (!Array.isArray(s.columns) || !Array.isArray(s.rows)) return null
      const columns = s.columns.slice(0, CAP.columns).map((c) => str(c, 40))
      const rows = s.rows.slice(0, CAP.rows).filter(Array.isArray).map((r) =>
        (r as unknown[]).slice(0, columns.length).map((c) => (typeof c === 'number' && Number.isFinite(c) ? c : c === null || c === undefined ? null : str(c, CAP.cell))),
      )
      if (!columns.length || !rows.length) return null
      out.columns = columns
      out.rows = rows
    }
    return out
  } catch {
    return null
  }
}

/** Build a stacked bar spec (e.g. hours per project per week). `color` per series = a project colour slot 1-8. */
export function stacked(o: { title?: string; subtitle?: string; unit?: string; labels: string[]; series: Series[] }): ChartSpec {
  return { type: 'bar', stacked: true, title: o.title, subtitle: o.subtitle, unit: o.unit || '', labels: o.labels, series: o.series }
}

export function fmt(v: number | null | undefined, unit = '') {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–'
  const a = Math.abs(v)
  const s = a >= 1e6 ? (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e4 ? (v / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K' : v.toLocaleString('en', { maximumFractionDigits: 2 })
  if (!unit) return s
  if (/^[$€£]$/.test(unit)) return unit + s
  return unit === '%' ? s + '%' : `${s} ${unit}`
}
/** Axis tick: like fmt but a short unit ("10h", "50%"). */
const tickFmt = (v: number, unit = '') => {
  const s = fmt(v)
  if (!unit) return s
  if (/^[$€£]$/.test(unit)) return unit + s
  return unit.length <= 2 ? s + unit : s
}

/** Series colour: its own slot, else the next slot in fixed order. A CSS variable, never a value from data. */
export const seriesColor = (s: Series | undefined, i: number) => `var(--viz-${(s && s.color) || (i % 8) + 1})`

function niceStep(raw: number) {
  if (!(raw > 0)) return 1
  const exp = 10 ** Math.floor(Math.log10(raw))
  const f = raw / exp
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp
}
/** Nice axis covering [lo, hi] with about 4 steps. A single value gets padding around it. */
function axis(lo: number, hi: number) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) [lo, hi] = [0, 1]
  if (hi === lo) {
    const pad = Math.abs(hi) * 0.25 || 1
    ;[lo, hi] = [lo >= 0 && lo - pad < 0 ? 0 : lo - pad, hi + pad]
  }
  const step = niceStep((hi - lo) / 4)
  const min = Math.floor(lo / step) * step
  const max = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let t = min; t <= max + step / 2 && ticks.length < 12; t += step) ticks.push(+t.toFixed(10))
  return { min, max, ticks }
}

/** Container width (ResizeObserver). 560 until measured (and in tests). */
export function useWidth(min = 200) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(560)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const cw = Math.round(el.clientWidth)
      if (cw > 0) setW((old) => (Math.abs(old - Math.max(min, cw)) < 2 ? old : Math.max(min, cw)))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [min])
  return [ref, w] as const
}

const clipTo = (s: string, chars: number) => (s.length > chars ? s.slice(0, Math.max(1, chars - 1)) + '…' : s)
const textW = (s: string, px = 11) => s.length * px * 0.58

/** Bar with rounded corners only on the far (data) end. */
function barPath(x: number, y: number, w: number, h: number, horizontal: boolean, r0 = 4) {
  if (!(w > 0) || !(h > 0)) return ''
  const r = Math.max(0, Math.min(r0, (horizontal ? h : w) / 2, horizontal ? w : h))
  if (horizontal) return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

type TipRow = { name: string; value: string; color: string | null }
type Tip = { left: number; title: string; rows: TipRow[] } | null

function Tooltip({ tip, width }: { tip: Tip; width: number }) {
  if (!tip) return null
  const left = Math.max(0, Math.min(tip.left, width - 190))
  return (
    <div className="viz-tip" style={{ left }} aria-hidden="true">
      <b>{tip.title}</b>
      {tip.rows.map((r, i) => (
        <div key={i} className="viz-tip-row">
          {r.color ? <i style={{ background: r.color }} /> : <i className="none" />}
          <span>{r.name}</span>
          <span className="num">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

/** One tab stop per plot: ←/→ (Home/End) move between columns; focus shows the column's tooltip. */
function useColumns(n: number) {
  const [hover, setHover] = useState<number | null>(null)
  const [cur, setCur] = useState(Math.max(0, n - 1))
  const refs = useRef<(SVGRectElement | null)[]>([])
  const at = Math.min(cur, Math.max(0, n - 1))
  const onKey = (e: KeyboardEvent) => {
    const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null
    if (to === null || to < 0 || to >= n) return
    e.preventDefault()
    setCur(to)
    refs.current[to]?.focus()
  }
  const hit = (i: number) => ({
    ref: (el: SVGRectElement | null) => {
      refs.current[i] = el
    },
    tabIndex: i === at ? 0 : -1,
    onFocus: () => {
      setCur(i)
      setHover(i)
    },
    onBlur: () => setHover(null),
    onMouseEnter: () => setHover(i),
    onKeyDown: onKey,
  })
  return { hover, setHover, hit }
}

function BarChart({ spec }: { spec: ChartSpec }) {
  const [ref, W] = useWidth()
  const labels = spec.labels!
  const series = spec.series!
  const n = labels.length
  const isStacked = !!spec.stacked && series.length > 0
  const totals = labels.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.data[i] ?? 0), 0))
  const values = isStacked ? totals : series.flatMap((s) => s.data.filter((v): v is number => v !== null))
  const { min: bottom, max: top, ticks } = axis(Math.min(0, ...values), Math.max(0, ...values))
  const cols = useColumns(n)
  const summary = `${spec.title || 'Bar chart'}. ` + labels.map((l, i) => `${l}: ${isStacked ? fmt(totals[i], spec.unit) : series.map((s) => (series.length > 1 ? s.name + ' ' : '') + fmt(s.data[i], spec.unit)).join(', ')}`).join('; ')
  const tipFor = (i: number, left: number): NonNullable<Tip> => ({
    left,
    title: labels[i],
    rows: [
      ...series.map((s, si) => ({ name: s.name || 'Value', value: fmt(s.data[i], spec.unit), color: seriesColor(s, si) })),
      ...(isStacked && series.length > 1 ? [{ name: 'Total', value: fmt(totals[i], spec.unit), color: null }] : []),
    ],
  })

  if (spec.horizontal && !isStacked) {
    const longest = Math.max(...labels.map((l) => l.length))
    const left = Math.min(Math.max(60, longest * 7 + 12), W * 0.42)
    const right = 52
    const k = series.length
    const rowH = Math.max(30, k * 14 + 12)
    const H = n * rowH + 24
    const plotW = Math.max(40, W - left - right)
    const xs = (v: number) => left + ((v - bottom) / (top - bottom || 1)) * plotW
    const band = rowH * 0.66
    const bh = Math.max(4, (band - (k - 1) * 2) / k)
    const many = n * k > 18
    return (
      <div className={'plot' + (cols.hover !== null ? ' hovering' : '')} ref={ref} onMouseLeave={() => cols.setHover(null)}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={summary}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={xs(t)} x2={xs(t)} y1={4} y2={H - 20} className={t === 0 ? 'bl' : 'gl'} />
              <text x={xs(t)} y={H - 6} className="vtick" textAnchor="middle">{tickFmt(t, spec.unit)}</text>
            </g>
          ))}
          {labels.map((l, li) => {
            const y0 = 4 + li * rowH + (rowH - band) / 2
            return (
              <g key={li}>
                <text x={left - 8} y={4 + li * rowH + rowH / 2} className="vtick lbl" textAnchor="end" dominantBaseline="middle">{clipTo(l, Math.floor((left - 12) / 7))}</text>
                {series.map((s, si) => {
                  const v = s.data[li]
                  if (v === null || v === undefined) return null
                  const x0 = xs(Math.min(0, v))
                  const w = Math.abs(xs(v) - xs(0))
                  const y = y0 + si * (bh + 2)
                  return (
                    <g key={si}>
                      <path className={'mk' + (cols.hover === li ? ' on' : '')} d={barPath(x0, y, w, bh, true)} fill={seriesColor(s, si)} />
                      {!many && <text x={xs(Math.max(0, v)) + 5} y={y + bh / 2} className="vlab" dominantBaseline="middle">{fmt(v, spec.unit)}</text>}
                    </g>
                  )
                })}
                <rect className="hit" x={0} y={4 + li * rowH} width={W} height={rowH} role="img" aria-label={`${l}: ${series.map((s) => (k > 1 ? s.name + ' ' : '') + fmt(s.data[li], spec.unit)).join(', ')}`} {...cols.hit(li)} />
              </g>
            )
          })}
        </svg>
        <Tooltip tip={cols.hover !== null ? { ...tipFor(cols.hover, left), left: left + 8 } : null} width={W} />
      </div>
    )
  }

  const left = 44
  const right = 10
  const H = 230
  const topPad = 18
  const bottomPad = 28
  const plotW = Math.max(40, W - left - right)
  const plotH = H - topPad - bottomPad
  const ys = (v: number) => topPad + (1 - (v - bottom) / (top - bottom || 1)) * plotH
  const gw = plotW / n
  const k = series.length
  const band = isStacked ? Math.min(28, gw * 0.6) : Math.min(gw * 0.72, k * 28 + (k - 1) * 2)
  const bw = isStacked ? band : Math.max(3, (band - (k - 1) * 2) / k)
  const many = isStacked || n * k > 18
  const widest = Math.max(...labels.map((l) => textW(l)))
  const every = Math.max(1, Math.ceil((widest + 8) / gw))
  return (
    <div className={'plot' + (cols.hover !== null ? ' hovering' : '')} ref={ref} onMouseLeave={() => cols.setHover(null)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={summary}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - right} y1={ys(t)} y2={ys(t)} className={t === 0 ? 'bl' : 'gl'} />
            <text x={left - 6} y={ys(t)} className="vtick" textAnchor="end" dominantBaseline="middle">{tickFmt(t, spec.unit)}</text>
          </g>
        ))}
        {labels.map((l, li) => {
          const gx = left + li * gw + (gw - band) / 2
          let acc = 0
          const segs = isStacked ? series.map((s, si) => ({ s, si, v: Math.max(0, s.data[li] ?? 0) })).filter((x) => x.v > 0) : []
          return (
            <g key={li}>
              {isStacked
                ? segs.map(({ s, si, v }, j) => {
                    const y0 = ys(acc)
                    const y1 = ys(acc + v)
                    acc += v
                    const h = Math.max(0, y0 - y1 - (j ? 2 : 0))
                    const isTop = j === segs.length - 1
                    const d = isTop ? barPath(gx, y1, bw, h, false) : `M${gx},${y1 + h}V${y1}H${gx + bw}V${y1 + h}Z`
                    return <path key={si} className={'mk' + (cols.hover === li ? ' on' : '')} d={d} fill={seriesColor(s, si)} />
                  })
                : series.map((s, si) => {
                    const v = s.data[li]
                    if (v === null || v === undefined) return null
                    const x = gx + si * (bw + 2)
                    const y = ys(Math.max(0, v))
                    const h = Math.abs(ys(v) - ys(0))
                    return (
                      <g key={si}>
                        <path className={'mk' + (cols.hover === li ? ' on' : '')} d={barPath(x, y, bw, h, false)} fill={seriesColor(s, si)} />
                        {!many && <text x={x + bw / 2} y={y - 5} className="vlab" textAnchor="middle">{fmt(v, spec.unit)}</text>}
                      </g>
                    )
                  })}
              {isStacked && li === n - 1 && totals[li] > 0 && (
                <text x={gx + bw / 2} y={ys(totals[li]) - 6} className="vlab" textAnchor="middle">{fmt(totals[li], spec.unit)}</text>
              )}
              {(n - 1 - li) % every === 0 && (
                <text x={left + li * gw + gw / 2} y={H - 8} className="vtick" textAnchor="middle">{clipTo(l, Math.max(4, Math.floor((gw * every) / 6.4)))}</text>
              )}
              <rect
                className="hit" x={left + li * gw} y={topPad} width={gw} height={plotH} role="img"
                aria-label={`${l}: ${isStacked ? series.map((s) => s.name + ' ' + fmt(s.data[li], spec.unit)).join(', ') + ', total ' + fmt(totals[li], spec.unit) : series.map((s) => (k > 1 ? s.name + ' ' : '') + fmt(s.data[li], spec.unit)).join(', ')}`}
                {...cols.hit(li)}
              />
            </g>
          )
        })}
      </svg>
      <Tooltip tip={cols.hover !== null ? tipFor(cols.hover, left + cols.hover * gw + gw / 2 + 14) : null} width={W} />
    </div>
  )
}

function LineChart({ spec }: { spec: ChartSpec }) {
  const [ref, W] = useWidth()
  const labels = spec.labels!
  const series = spec.series!
  const n = labels.length
  const values = series.flatMap((s) => s.data.filter((v): v is number => v !== null))
  if (spec.goal !== undefined) values.push(spec.goal)
  const lo = values.length ? Math.min(...values) : 0
  const hi = values.length ? Math.max(...values) : 1
  // Lines needn't start at zero: when values sit far above it, zoom in so small changes show.
  const zoom = lo > 0 && lo > hi * 0.5
  const fixed = spec.min !== undefined && spec.max !== undefined
  const ax = fixed ? axis(spec.min!, spec.max!) : zoom ? axis(lo, hi) : axis(Math.min(0, lo), Math.max(0, hi))
  const floor = fixed ? spec.min! : ax.min
  const top = fixed ? spec.max! : ax.max
  const yTicks = fixed ? ax.ticks.filter((t) => t >= floor && t <= top) : ax.ticks
  const single = series.length === 1
  const left = 40
  const right = single ? 38 : series.length <= 4 ? 92 : 14
  const H = 200
  const topPad = 14
  const bottomPad = 28
  const plotW = Math.max(40, W - left - right)
  const plotH = H - topPad - bottomPad
  const xs = (i: number) => left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const ys = (v: number) => topPad + (1 - (Math.max(floor, Math.min(top, v)) - floor) / (top - floor || 1)) * plotH
  const showDots = n <= 24
  const every = Math.max(1, Math.ceil((Math.max(...labels.map((l) => textW(l))) + 10) / (plotW / Math.max(1, n - 1))))
  const cols = useColumns(n)
  const hover = cols.hover

  const ends = series
    .map((s, i) => {
      const k = s.data.map((v, j) => (v === null ? -1 : j)).reduce((a, b) => Math.max(a, b), -1)
      return k < 0 ? null : { i, k, y: ys(s.data[k]!), name: s.name, v: s.data[k]! }
    })
    .filter((e): e is { i: number; k: number; y: number; name: string; v: number } => !!e)
  const sorted = [...ends].sort((a, b) => a.y - b.y)
  const collide = sorted.some((e, k) => k > 0 && e.y - sorted[k - 1].y < 14)
  const colW = n > 1 ? plotW / (n - 1) : plotW
  const summary = `${spec.title || 'Line chart'}. ` + series.map((s) => `${series.length > 1 ? s.name + ': ' : ''}${labels.map((l, i) => l + ' ' + fmt(s.data[i], spec.unit)).join(', ')}`).join('; ')

  return (
    <div className={'plot' + (hover !== null ? ' hovering' : '')} ref={ref} onMouseLeave={() => cols.setHover(null)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={summary}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - right} y1={ys(t)} y2={ys(t)} className={t === floor ? 'bl' : 'gl'} />
            <text x={left - 6} y={ys(t)} className="vtick" textAnchor="end" dominantBaseline="middle">{tickFmt(t, spec.unit)}</text>
          </g>
        ))}
        {labels.map((l, i) =>
          (n - 1 - i) % every === 0 ? (
            <text key={i} x={xs(i)} y={H - 8} className="vtick" textAnchor="middle">{clipTo(l, 12)}</text>
          ) : null,
        )}
        {spec.goal !== undefined && (
          <g className="goal-ref">
            <line x1={left} x2={W - right} y1={ys(spec.goal)} y2={ys(spec.goal)} />
            <text x={W - right} y={ys(spec.goal) - 5} textAnchor="end">goal {fmt(spec.goal, spec.unit)}</text>
          </g>
        )}
        {hover !== null && <line x1={xs(hover)} x2={xs(hover)} y1={topPad} y2={H - bottomPad} className="xh" />}
        {series.map((s, si) => {
          const c = seriesColor(s, si)
          const pts = s.data.map((v, i) => (v === null ? null : ([xs(i), ys(v)] as const)))
          let d = ''
          pts.forEach((p, i) => {
            if (p) d += (i === 0 || !pts[i - 1] ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)
          })
          const first = pts.findIndex(Boolean)
          let last = -1
          pts.forEach((p, i) => {
            if (p) last = i
          })
          const area = single && first >= 0 && last > first && pts.slice(first, last + 1).every(Boolean)
            ? d + `L${xs(last).toFixed(1)},${ys(floor).toFixed(1)}L${xs(first).toFixed(1)},${ys(floor).toFixed(1)}Z`
            : ''
          return (
            <g key={si}>
              {area && <path d={area} fill={c} opacity={0.1} />}
              <path d={d} fill="none" stroke={c} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p, i) =>
                p && ((showDots && !single) || hover === i || (single && i === last)) ? (
                  <circle key={i} cx={p[0]} cy={p[1]} r={hover === i || (single && i === last) ? 4.5 : 3.5} fill={c} className="ldot" />
                ) : null,
              )}
            </g>
          )
        })}
        {single && ends[0] && (
          <text x={xs(ends[0].k) + 8} y={ends[0].y + 4} className="vlab">{fmt(ends[0].v, spec.unit)}</text>
        )}
        {!single && series.length <= 4 && !collide &&
          ends.map((e) => (
            <text key={e.i} x={W - right + 8} y={e.y} className="vlab end" dominantBaseline="middle">{clipTo(e.name, 12)}</text>
          ))}
        {labels.map((l, i) => (
          <rect
            key={i} className="hit" x={xs(i) - colW / 2} y={topPad} width={colW} height={plotH} role="img"
            aria-label={`${l}: ${series.map((s) => (series.length > 1 ? s.name + ' ' : '') + fmt(s.data[i], spec.unit)).join(', ')}`}
            {...cols.hit(i)}
          />
        ))}
      </svg>
      <Tooltip
        tip={hover === null ? null : { left: xs(hover) + 12, title: labels[hover], rows: series.map((s, i) => ({ name: s.name || 'Value', value: fmt(s.data[hover], spec.unit), color: seriesColor(s, i) })) }}
        width={W}
      />
    </div>
  )
}

function Stats({ spec }: { spec: ChartSpec }) {
  return (
    <div className="viz-stats">
      {spec.stats!.map((s, i) => {
        const d = String(s.delta || '')
        const dir = /^\+/.test(d) ? 'up' : /^[-−]/.test(d) ? 'down' : d ? 'flat' : null
        const good = s.good ?? dir === 'up'
        return (
          <div key={i} className="stat">
            <b>
              {typeof s.value === 'number' ? fmt(s.value, spec.unit) : String(s.value)}
              {dir && <span className={'delta' + (dir === 'flat' ? ' flat' : good ? '' : ' bad')}>{d}</span>}
            </b>
            <span>{s.label}</span>
          </div>
        )
      })}
    </div>
  )
}

function Progress({ spec }: { spec: ChartSpec }) {
  return (
    <div className="pbars">
      {spec.items!.map((it, i) => {
        const pct = it.max ? Math.max(0, Math.min(100, (it.value / it.max) * 100)) : 0
        return (
          <div key={i} className={'pbar' + (it.color ? ' has-pc pc' + it.color : '')}>
            <span className="lb">
              {it.color && <i className="pdot" />}
              {it.label}
            </span>
            <span className="meter" role="img" aria-label={`${it.label}: ${fmt(it.value)} of ${fmt(it.max)}`}>
              <i style={{ width: pct + '%' }} />
            </span>
            <span className="v num">{fmt(it.value)}/{fmt(it.max)}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Plain data table (also the Table twin of every plot). */
export function DataTable({ columns, rows, caption }: { columns: string[]; rows: (string | number | null)[][]; caption?: string }) {
  return (
    <div className="vt-wrap">
      <table className="vtable">
        {caption && <caption className="sr">{caption}</caption>}
        <thead>
          <tr>{columns.map((c, i) => <th key={i} scope="col">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((_, j) => {
                const c = r[j]
                return <td key={j} className={typeof c === 'number' ? 'num' : ''}>{c === null || c === undefined || c === '' ? '–' : typeof c === 'number' ? fmt(c) : String(c)}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Legend: one swatch per series (2+ series), with each series' total for stacked bars. */
export function Legend({ series, unit, totals }: { series: Series[]; unit?: string; totals?: boolean }) {
  if (series.length < 2) return null
  return (
    <div className="legend">
      {series.map((s, i) => (
        <span key={i}>
          <i style={{ background: seriesColor(s, i) }} />
          {s.name}
          {totals && ' · ' + fmt(s.data.reduce<number>((a, v) => a + (v ?? 0), 0), unit)}
        </span>
      ))}
    </div>
  )
}

/** The Table / Chart switch every plot carries. */
export function TableToggle({ on, onChange, controls }: { on: boolean; onChange: (v: boolean) => void; controls?: string }) {
  return (
    <button className="vtoggle" type="button" aria-pressed={on} aria-controls={controls} onClick={() => onChange(!on)}>
      <Icon name={on ? 'chart' : 'table'} />
      <span>{on ? 'Chart' : 'Table'}</span>
    </button>
  )
}

/** A chart card: title (+ chip), sub line, Table toggle, legend, the plot (or its table) and the source. */
export function Chart({ spec, chip, className }: { spec: ChartSpec; chip?: ReactNode; className?: string }) {
  const [table, setTable] = useState(false)
  const id = useId()
  const plotted = spec.type === 'bar' || spec.type === 'line'
  const tableData = useMemo(() => {
    if (!plotted) return null
    const series = spec.series!
    const stackedTotal = spec.type === 'bar' && spec.stacked && series.length > 1
    return {
      columns: ['', ...series.map((s) => s.name || 'Value'), ...(stackedTotal ? ['Total'] : [])],
      rows: spec.labels!.map((l, i) => [
        l,
        ...series.map((s) => (s.data[i] === null || s.data[i] === undefined ? null : fmt(s.data[i], spec.unit))),
        ...(stackedTotal ? [fmt(series.reduce((a, s) => a + Math.max(0, s.data[i] ?? 0), 0), spec.unit)] : []),
      ]),
    }
  }, [spec, plotted])
  let body: ReactNode
  if (table && tableData) body = <DataTable columns={tableData.columns} rows={tableData.rows} caption={spec.title} />
  else if (spec.type === 'bar') body = <BarChart spec={spec} />
  else if (spec.type === 'line') body = <LineChart spec={spec} />
  else if (spec.type === 'stat') body = <Stats spec={spec} />
  else if (spec.type === 'progress') body = <Progress spec={spec} />
  else body = <DataTable columns={spec.columns || []} rows={spec.rows || []} caption={spec.title} />
  const head = spec.title || spec.subtitle || plotted || chip
  return (
    <figure className={'viz' + (className ? ' ' + className : '')}>
      {head && (
        <figcaption className="viz-h">
          <div>
            {(spec.title || chip) && (
              <span className="viz-t">
                {spec.title}
                {chip}
              </span>
            )}
            {spec.subtitle && <p>{spec.subtitle}</p>}
          </div>
          {plotted && <TableToggle on={table} onChange={setTable} controls={id} />}
        </figcaption>
      )}
      {plotted && !table && <Legend series={spec.series!} unit={spec.unit} totals={spec.type === 'bar' && !!spec.stacked} />}
      <div id={id} className="viz-body">{body}</div>
      {spec.source && <p className="viz-src">Source: {spec.source}</p>}
    </figure>
  )
}
