// Interactive charts drawn from a small JSON spec. The AI writes them as ```chart blocks.
// Follows the dataviz skill: thin marks, rounded data-ends on the baseline, hover tooltips,
// legend for 2+ series, direct value labels + a Table view (the light palette's "relief rule"),
// one y-axis, categorical colours in fixed order (validated palette, see styles.css --viz-*).
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, ChartColumn, Minus, Table2 } from 'lucide-react'

export type Series = { name: string; data: (number | null)[] }
export type ChartSpec = {
  type: 'bar' | 'line' | 'stat' | 'progress' | 'table'
  title?: string
  subtitle?: string
  source?: string
  unit?: string
  labels?: string[]
  series?: Series[]
  horizontal?: boolean
  stats?: { label: string; value: number | string; delta?: string; good?: boolean }[]
  items?: { label: string; value: number; max: number }[]
  columns?: string[]
  rows?: (string | number)[][]
}

const TYPES = ['bar', 'line', 'stat', 'progress', 'table']
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

/** Parse + sanitise a spec. Returns null when it can't be drawn (the raw block is shown instead). */
export function parseChart(src: string): ChartSpec | null {
  try {
    const s = JSON.parse(src)
    if (!s || typeof s !== 'object' || !TYPES.includes(s.type)) return null
    const out: ChartSpec = { ...s, title: s.title ? String(s.title) : undefined, unit: s.unit ? String(s.unit) : '' }
    if (s.type === 'bar' || s.type === 'line') {
      if (!Array.isArray(s.labels) || !Array.isArray(s.series) || !s.series.length) return null
      out.labels = s.labels.map(String)
      out.series = s.series.slice(0, 8).map((x: any) => ({ name: String(x?.name ?? ''), data: (Array.isArray(x?.data) ? x.data : []).map(num) }))
    }
    if (s.type === 'stat' && !Array.isArray(s.stats)) return null
    if (s.type === 'progress' && !Array.isArray(s.items)) return null
    if (s.type === 'table' && (!Array.isArray(s.columns) || !Array.isArray(s.rows))) return null
    return out
  } catch {
    return null
  }
}

export function fmt(v: number | null | undefined, unit = '') {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–'
  const a = Math.abs(v)
  const s = a >= 1e6 ? (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e4 ? (v / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K' : v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (!unit) return s
  if (/^[$€£]$/.test(unit)) return unit + s
  return unit === '%' ? s + '%' : `${s} ${unit}`
}

const color = (i: number) => `var(--viz-${(i % 8) + 1})`

function niceStep(raw: number) {
  if (raw <= 0) return 1
  const exp = 10 ** Math.floor(Math.log10(raw))
  const f = raw / exp
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp
}
/** Nice axis covering [lo, hi] with ~4 steps. A single value gets padding around it. */
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
  for (let t = min; t <= max + step / 2; t += step) ticks.push(+t.toFixed(10))
  return { min, max, ticks }
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(560)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(240, el.clientWidth)))
    ro.observe(el)
    setW(Math.max(240, el.clientWidth))
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

const clip = (s: string, chars: number) => (s.length > chars ? s.slice(0, Math.max(1, chars - 1)) + '…' : s)

/** Path for a bar with rounded corners only on the far (data) end. */
function barPath(x: number, y: number, w: number, h: number, horizontal: boolean) {
  const r = Math.max(0, Math.min(4, (horizontal ? h : w) / 2, horizontal ? w : h))
  if (w <= 0 || h <= 0) return ''
  if (horizontal) return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

type Tip = { x: number; y: number; title: string; rows: { name: string; value: string; i: number }[] } | null

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null
  return (
    <div className="viz-tip" style={{ left: tip.x, top: tip.y }}>
      <b>{tip.title}</b>
      {tip.rows.map((r) => (
        <div key={r.i} className="viz-tip-row">
          <span className="viz-sw" style={{ background: color(r.i) }} />
          <span>{r.name}</span>
          <span className="num">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null
  return (
    <div className="viz-legend">
      {series.map((s, i) => (
        <span key={i}>
          <span className="viz-sw" style={{ background: color(i) }} /> {s.name}
        </span>
      ))}
    </div>
  )
}

function BarChart({ spec }: { spec: ChartSpec }) {
  const [ref, W] = useWidth()
  const [tip, setTip] = useState<Tip>(null)
  const labels = spec.labels!
  const series = spec.series!
  const values = series.flatMap((s) => s.data.filter((v): v is number => v !== null))
  // Bars always start at zero.
  const { min: bottom, max: top, ticks } = axis(Math.min(0, ...values), Math.max(0, ...values))
  const horizontal = !!spec.horizontal
  const n = series.length
  const many = labels.length * n > 18

  if (horizontal) {
    const longest = Math.max(...labels.map((l) => l.length))
    const left = Math.min(Math.max(60, longest * 7 + 12), W * 0.42)
    const right = 52
    const rowH = Math.max(30, n * 14 + 12)
    const H = labels.length * rowH + 24
    const plotW = W - left - right
    const xs = (v: number) => left + ((v - bottom) / (top - bottom || 1)) * plotW
    const band = rowH * 0.66
    const bh = Math.max(4, (band - (n - 1) * 2) / n)
    return (
      <div className="viz-plot" ref={ref} onMouseLeave={() => setTip(null)}>
        <svg width={W} height={H} role="img" aria-label={spec.title || 'bar chart'}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={xs(t)} x2={xs(t)} y1={4} y2={H - 20} className="viz-grid" />
              <text x={xs(t)} y={H - 6} className="viz-axis" textAnchor="middle">{fmt(t, spec.unit)}</text>
            </g>
          ))}
          {labels.map((l, li) => {
            const y0 = 4 + li * rowH + (rowH - band) / 2
            return (
              <g key={li}>
                <text x={left - 8} y={4 + li * rowH + rowH / 2} className="viz-label" textAnchor="end" dominantBaseline="middle">{clip(l, Math.floor((left - 12) / 7))}</text>
                {series.map((s, si) => {
                  const v = s.data[li]
                  if (v === null || v === undefined) return null
                  const x0 = xs(Math.min(0, v))
                  const w = Math.abs(xs(v) - xs(0))
                  const y = y0 + si * (bh + 2)
                  return (
                    <g key={si}>
                      <path d={barPath(x0, y, w, bh, true)} fill={color(si)} />
                      {!many && <text x={xs(Math.max(0, v)) + 5} y={y + bh / 2} className="viz-value" dominantBaseline="middle">{fmt(v, spec.unit)}</text>}
                    </g>
                  )
                })}
                <rect
                  x={0} y={4 + li * rowH} width={W} height={rowH} fill="transparent"
                  onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX + 12, y: e.nativeEvent.offsetY + 12, title: l, rows: series.map((s, i) => ({ name: s.name, value: fmt(s.data[li], spec.unit), i })) })}
                />
              </g>
            )
          })}
        </svg>
        <Tooltip tip={tip} />
      </div>
    )
  }

  const left = 48
  const right = 12
  const H = 250
  const topPad = 18
  const bottomPad = 30
  const plotW = W - left - right
  const plotH = H - topPad - bottomPad
  const ys = (v: number) => topPad + (1 - (v - bottom) / (top - bottom || 1)) * plotH
  const gw = plotW / labels.length
  const band = Math.min(gw * 0.72, n * 48 + (n - 1) * 2)
  const bw = Math.max(3, (band - (n - 1) * 2) / n)
  const maxChars = Math.max(3, Math.floor(gw / 7))
  return (
    <div className="viz-plot" ref={ref} onMouseLeave={() => setTip(null)}>
      <svg width={W} height={H} role="img" aria-label={spec.title || 'bar chart'}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - right} y1={ys(t)} y2={ys(t)} className={t === 0 ? 'viz-base' : 'viz-grid'} />
            <text x={left - 6} y={ys(t)} className="viz-axis" textAnchor="end" dominantBaseline="middle">{fmt(t, spec.unit)}</text>
          </g>
        ))}
        {labels.map((l, li) => {
          const gx = left + li * gw + (gw - band) / 2
          return (
            <g key={li}>
              {series.map((s, si) => {
                const v = s.data[li]
                if (v === null || v === undefined) return null
                const x = gx + si * (bw + 2)
                const y = ys(Math.max(0, v))
                const h = Math.abs(ys(v) - ys(0))
                return (
                  <g key={si}>
                    <path d={barPath(x, y, bw, h, false)} fill={color(si)} />
                    {!many && <text x={x + bw / 2} y={y - 5} className="viz-value" textAnchor="middle">{fmt(v, spec.unit)}</text>}
                  </g>
                )
              })}
              <text x={left + li * gw + gw / 2} y={H - 10} className="viz-label" textAnchor="middle">{clip(l, maxChars)}</text>
              <rect
                x={left + li * gw} y={0} width={gw} height={H} fill="transparent"
                onMouseMove={(e) => setTip({ x: e.nativeEvent.offsetX + 12, y: e.nativeEvent.offsetY + 12, title: l, rows: series.map((s, i) => ({ name: s.name, value: fmt(s.data[li], spec.unit), i })) })}
              />
            </g>
          )
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

function LineChart({ spec }: { spec: ChartSpec }) {
  const [ref, W] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const labels = spec.labels!
  const series = spec.series!
  const values = series.flatMap((s) => s.data.filter((v): v is number => v !== null))
  const lo = values.length ? Math.min(...values) : 0
  const hi = values.length ? Math.max(...values) : 1
  // Lines needn't start at zero: when values sit far above it, zoom in so small changes show.
  const zoom = lo > 0 && lo > hi * 0.5
  const { min: floor, max: top, ticks: yTicks } = zoom ? axis(lo, hi) : axis(Math.min(0, lo), Math.max(0, hi))
  const left = 48
  const right = series.length <= 4 ? 96 : 14
  const H = 250
  const topPad = 14
  const bottomPad = 30
  const plotW = W - left - right
  const plotH = H - topPad - bottomPad
  const xs = (i: number) => left + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW)
  const ys = (v: number) => topPad + (1 - (v - floor) / (top - floor || 1)) * plotH
  const showDots = labels.length <= 24
  const every = Math.ceil(labels.length / Math.max(2, Math.floor(plotW / 70)))

  // Direct end labels (<= 4 series), dropped if they would collide.
  const ends = series
    .map((s, i) => {
      const last = [...s.data].reverse().find((v) => v !== null)
      return last === undefined || last === null ? null : { i, y: ys(last), name: s.name }
    })
    .filter(Boolean) as { i: number; y: number; name: string }[]
  const sorted = [...ends].sort((a, b) => a.y - b.y)
  const collide = sorted.some((e, k) => k > 0 && e.y - sorted[k - 1].y < 14)

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const x = e.nativeEvent.offsetX
    const i = labels.length === 1 ? 0 : Math.round(((x - left) / plotW) * (labels.length - 1))
    setHover(Math.max(0, Math.min(labels.length - 1, i)))
  }
  const tip: Tip =
    hover === null
      ? null
      : { x: Math.min(xs(hover) + 12, W - 170), y: 8, title: labels[hover], rows: series.map((s, i) => ({ name: s.name, value: fmt(s.data[hover], spec.unit), i })) }

  return (
    <div className="viz-plot" ref={ref} onMouseLeave={() => setHover(null)}>
      <svg width={W} height={H} role="img" aria-label={spec.title || 'line chart'}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - right} y1={ys(t)} y2={ys(t)} className="viz-grid" />
            <text x={left - 6} y={ys(t)} className="viz-axis" textAnchor="end" dominantBaseline="middle">{fmt(t, spec.unit)}</text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % every === 0 || i === labels.length - 1 ? (
            <text key={i} x={xs(i)} y={H - 10} className="viz-label" textAnchor="middle">{clip(l, 12)}</text>
          ) : null,
        )}
        {hover !== null && <line x1={xs(hover)} x2={xs(hover)} y1={topPad} y2={H - bottomPad} className="viz-cross" />}
        {series.map((s, si) => {
          const pts = s.data.map((v, i) => (v === null ? null : [xs(i), ys(v)] as const))
          let d = ''
          pts.forEach((p, i) => {
            if (!p) return
            d += (i === 0 || !pts[i - 1] ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)
          })
          return (
            <g key={si}>
              <path d={d} fill="none" stroke={color(si)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p, i) =>
                p && (showDots || hover === i) ? (
                  <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 5 : 4} fill={color(si)} className="viz-dot" />
                ) : null,
              )}
            </g>
          )
        })}
        {series.length <= 4 && !collide &&
          ends.map((e) => (
            <text key={e.i} x={W - right + 8} y={e.y} className="viz-end" dominantBaseline="middle" fill={`var(--text)`}>
              {clip(e.name, 12)}
            </text>
          ))}
        <rect x={left} y={0} width={plotW} height={H} fill="transparent" onMouseMove={onMove} />
      </svg>
      <Tooltip tip={tip} />
    </div>
  )
}

function Stats({ spec }: { spec: ChartSpec }) {
  return (
    <div className="stats">
      {spec.stats!.map((s, i) => {
        const d = String(s.delta || '')
        const dir = /^\+/.test(d) ? 'up' : /^[-−]/.test(d) ? 'down' : d ? 'flat' : null
        const good = s.good ?? dir === 'up'
        return (
          <div key={i} className="stat">
            <span className="stat-l">{s.label}</span>
            <span className="stat-v">{typeof s.value === 'number' ? fmt(s.value, spec.unit) : String(s.value)}</span>
            {dir && (
              <span className={'stat-d tone-' + (dir === 'flat' ? 'muted' : good ? 'ok' : 'bad')}>
                {dir === 'up' ? <ArrowUpRight className="i sm" /> : dir === 'down' ? <ArrowDownRight className="i sm" /> : <Minus className="i sm" />} {d}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Progress({ spec }: { spec: ChartSpec }) {
  return (
    <div className="viz-progress">
      {spec.items!.map((it, i) => {
        const pct = it.max ? Math.max(0, Math.min(100, (Number(it.value) / Number(it.max)) * 100)) : 0
        return (
          <div key={i} className="viz-progress-row">
            <span className="viz-progress-l">{it.label}</span>
            <div className="meter-track" role="meter" aria-valuenow={it.value} aria-valuemax={it.max} aria-label={it.label}>
              <div className="meter-fill" style={{ width: pct + '%' }} />
            </div>
            <span className="small muted num">{it.value}/{it.max}</span>
          </div>
        )
      })}
    </div>
  )
}

function DataTable({ columns, rows }: { columns: string[]; rows: (string | number | null)[][] }) {
  return (
    <div className="table-wrap">
      <table className="cmp">
        <thead><tr>{columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === 'number' ? 'num' : ''}>{c === null ? '–' : String(c)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

/** A chart card: title, the chart, legend, a Table toggle and the source. */
export function Chart({ spec }: { spec: ChartSpec }) {
  const [table, setTable] = useState(false)
  const plotted = spec.type === 'bar' || spec.type === 'line'
  const tableData = useMemo(
    () => (plotted ? { columns: ['', ...spec.series!.map((s) => s.name || 'Value')], rows: spec.labels!.map((l, i) => [l, ...spec.series!.map((s) => (s.data[i] === null ? null : fmt(s.data[i], spec.unit)))]) } : null),
    [spec],
  )
  let body: ReactNode
  if (table && tableData) body = <DataTable columns={tableData.columns} rows={tableData.rows} />
  else if (spec.type === 'bar') body = <BarChart spec={spec} />
  else if (spec.type === 'line') body = <LineChart spec={spec} />
  else if (spec.type === 'stat') body = <Stats spec={spec} />
  else if (spec.type === 'progress') body = <Progress spec={spec} />
  else body = <DataTable columns={spec.columns!.map(String)} rows={spec.rows!} />
  return (
    <figure className="viz">
      {(spec.title || plotted) && (
        <figcaption className="viz-h">
          <div>
            {spec.title && <b>{spec.title}</b>}
            {spec.subtitle && <div className="muted small">{spec.subtitle}</div>}
          </div>
          {plotted && (
            <button className="btn ghost sm" onClick={() => setTable(!table)} aria-pressed={table}>
              {table ? <><ChartColumn className="i sm" /> Chart</> : <><Table2 className="i sm" /> Table</>}
            </button>
          )}
        </figcaption>
      )}
      {body}
      {plotted && !table && <Legend series={spec.series!} />}
      {spec.source && <div className="viz-src muted small">Source: {spec.source}</div>}
    </figure>
  )
}
