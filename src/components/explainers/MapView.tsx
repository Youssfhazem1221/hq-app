// Map: boxes on a grid (col, row) with auto-routed edges (geometry from parse.ts mapLayout). Tap a box → its card
// below, related edges light up. One tab stop (arrows move through the boxes in reading order, Enter/Space picks).
// Legend lists only the line styles and status dots in use. When the block is too narrow to read the SVG text
// (phone, side panel) it becomes a tappable list (≥12 px text, no sideways scroll); desktop keeps a list twin.
import { useMemo, useRef, useState, useId, type KeyboardEvent } from 'react'
import { Icon } from '../../lib/icons'
import { useWidth } from '../charts'
import { mapLayout, type MapSpec, type MapNode, type MapLayout } from './parse'

/** The SVG reads well down to ~78% of its natural size; below that the list shows instead. */
const MIN_SCALE = 0.78
const MAX_SCALE = 1.2
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : one + 's'}`

function Legend({ lay }: { lay: MapLayout }) {
  return (
    <div className="legend map-key">
      <span>
        <svg className="lg-line" viewBox="0 0 28 8" aria-hidden="true"><path d="M1 4H22" /><path className="h" d="M20 1l6 3-6 3z" /></svg>
        sends to
      </span>
      {lay.legend.both && (
        <span>
          <svg className="lg-line" viewBox="0 0 28 8" aria-hidden="true"><path d="M7 4H21" /><path className="h" d="M8 1L2 4l6 3zM20 1l6 3-6 3z" /></svg>
          both ways
        </span>
      )}
      {lay.legend.dashed && (
        <span>
          <svg className="lg-line" viewBox="0 0 28 8" aria-hidden="true"><path d="M1 4H22" strokeDasharray="4 3" /><path className="h" d="M20 1l6 3-6 3z" /></svg>
          wake-up signal
        </span>
      )}
      {lay.legend.statuses.map((s) => {
        const dot = lay.nodes.find((x) => x.node.status === s)?.dot
        return (
          <span key={s}>
            <i className={'sdot-k ' + (dot || '')} />
            {s}
          </span>
        )
      })}
    </div>
  )
}

function NodeCard({ lay, node }: { lay: MapLayout; node: MapNode }) {
  const info = lay.nodes.find((x) => x.node.id === node.id)
  return (
    <>
      <h4>
        {node.label}
        {node.sub && <span className="chip">{node.sub}</span>}
        {info?.dot && <span className="chip">{node.status}</span>}
        <span className="chip line">{plural(info?.links || 0, 'link')}</span>
      </h4>
      {node.what && <p>{node.what}</p>}
      {node.bullets.length > 0 && (
        <ul className="blist">
          {node.bullets.map((b, k) => <li key={k}>{b}</li>)}
        </ul>
      )}
    </>
  )
}

export function MapView({ spec }: { spec: MapSpec }) {
  const lay = useMemo(() => mapLayout(spec), [spec])
  const [ref, w] = useWidth(0)
  const [sel, setSel] = useState<string | null>(null)
  const order = useMemo(() => lay.nodes.map((x) => x.node).sort((a, b) => a.row - b.row || a.col - b.col).map((n) => n.id), [lay])
  const [cur, setCur] = useState(0)
  const nodeRefs = useRef(new Map<string, SVGGElement | null>())
  const uid = useId().replace(/[^\w-]/g, '')
  const asList = w < lay.width * MIN_SCALE
  // the SVG's scale on screen: small text is counter-scaled (CSS --ms) so edge and sub labels stay ≥ 10.5 px when the map
  // is drawn below its natural size (docs reader, narrower windows)
  const scale = w > 0 ? Math.max(MIN_SCALE, Math.min(MAX_SCALE, w / lay.width)) : 1
  const shown = lay.nodes.find((x) => x.node.id === sel)?.node || lay.nodes[0]?.node
  const related = useMemo(() => {
    if (!sel) return null
    const r = new Set([sel])
    for (const { edge } of lay.edges) {
      if (edge.from === sel) r.add(edge.to)
      if (edge.to === sel) r.add(edge.from)
    }
    return r
  }, [sel, lay])
  const focusId = order[Math.min(cur, order.length - 1)]

  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setSel(id)
      return
    }
    const k = order.indexOf(id)
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? k + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? k - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? order.length - 1 : null
    if (to === null || to < 0 || to >= order.length) return
    e.preventDefault()
    setCur(to)
    nodeRefs.current.get(order[to])?.focus()
  }

  return (
    <div className={'mapv' + (asList ? ' as-list' : '')} ref={ref}>
      <Legend lay={lay} />
      <div className="map-fig" style={{ maxWidth: Math.round(lay.width * MAX_SCALE) }}>
        <svg className="map-svg" viewBox={`0 0 ${lay.width} ${lay.height}`} role="group" aria-label={lay.aria} style={{ ['--ms' as string]: scale.toFixed(3) }}>
          <defs>
            <marker id={`${uid}-mk`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path className="mk-a" d="M0 0L10 5L0 10z" />
            </marker>
            <marker id={`${uid}-mkh`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path className="mk-h" d="M0 0L10 5L0 10z" />
            </marker>
          </defs>
          {lay.edges.map(({ edge, k, geom }) => {
            const hot = !!sel && (edge.from === sel || edge.to === sel)
            const mk = `url(#${uid}${hot ? '-mkh' : '-mk'})`
            return (
              <path
                key={'e' + k}
                className={'edge' + (edge.style === 'dashed' ? ' dash' : '') + (sel ? (hot ? ' hot' : ' dim') : '')}
                d={geom.d}
                markerEnd={mk}
                markerStart={edge.both ? mk : undefined}
              />
            )
          })}
          {lay.edges.map(({ edge, k, geom }) =>
            edge.label ? (
              <text key={'l' + k} className={'el' + (sel ? (edge.from === sel || edge.to === sel ? ' hot' : ' dim') : '')} x={geom.mx} y={geom.my} textAnchor={geom.anchor}>
                {edge.label}
              </text>
            ) : null,
          )}
          {lay.nodes.map(({ node, box, dot }) => (
            <g
              key={node.id}
              ref={(el) => {
                nodeRefs.current.set(node.id, el)
              }}
              className={'node' + (sel === node.id ? ' sel' : '') + (related && !related.has(node.id) ? ' dim' : '')}
              role="button"
              tabIndex={node.id === focusId ? 0 : -1}
              aria-pressed={sel === node.id}
              aria-label={node.label + (node.sub ? ', ' + node.sub : '') + (dot ? ', ' + node.status : '')}
              onClick={() => {
                setSel(node.id)
                setCur(order.indexOf(node.id))
              }}
              onKeyDown={(e) => onKey(e, node.id)}
            >
              <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={10} />
              {dot && <circle className={'sdot ' + dot} cx={box.x + box.w - 12} cy={box.y + 12} r={4} />}
              <text className="nt" x={box.x + 14} y={box.y + 24}>{node.label}</text>
              {node.sub && <text className="ns" x={box.x + 14} y={box.y + 42}>{node.sub}</text>}
            </g>
          ))}
        </svg>
      </div>
      <ul className="mlist" aria-label={spec.title}>
        {lay.rows.map((r) => (
          <li key={r.id}>
            <button type="button" className="mrow" aria-pressed={sel === r.id} onClick={() => setSel(r.id)}>
              <b>{r.label}</b>
              {r.sub && <span>{r.sub}</span>}
              {r.to.length > 0 && (
                <em>
                  <Icon name="arrow" size="s" />
                  {r.to.join(', ')}
                </em>
              )}
            </button>
          </li>
        ))}
      </ul>
      {shown && (
        <div className="ncard" aria-live="polite">
          <NodeCard lay={lay} node={shown} />
        </div>
      )}
      {lay.lines.length > 0 && (
        <details className="tg map-tw">
          <summary>
            <Icon name="chevR" size="s" className="chev" />
            <span className="sm">Show as a list</span>
          </summary>
          <div className="tg-body">
            <ul className="blist">
              {lay.lines.map((l, k) => <li key={k}>{l}</li>)}
            </ul>
          </div>
        </details>
      )}
    </div>
  )
}
