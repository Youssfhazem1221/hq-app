// statemachine + network: one SVG drawer over graph.ts layouts, in the map's styles (same node, edge, label and list
// classes). Tap a node → its card below and its links light up. One tab stop (arrows move through the nodes in reading
// order, Enter/Space picks). Too narrow to read the SVG text (phone, side panel) → a tappable list; desktop keeps a
// "Show as a list" twin. Text only: every string is rendered by React as text.
import { useMemo, useRef, useState, useId, type KeyboardEvent, type ReactNode } from 'react'
import { Icon, ICONS } from '../../lib/icons'
import { useWidth } from '../charts'
import { netLayout, smLayout, type GNode, type GraphLayout } from './graph-layout'
import type { NetworkSpec, StateMachineSpec } from './parse'

/** The SVG reads well down to ~70% of its natural size (small labels are counter-scaled); below that the list shows. */
const MIN_SCALE = 0.7
const MAX_SCALE = 1.15

const Arrow = ({ both, dashed }: { both?: boolean; dashed?: boolean }) => (
  <svg className="lg-line" viewBox="0 0 28 8" aria-hidden="true">
    <path d={both ? 'M7 4H21' : 'M1 4H22'} strokeDasharray={dashed ? '4 3' : undefined} />
    {both && <path className="h" d="M8 1L2 4l6 3z" />}
    <path className="h" d="M20 1l6 3-6 3z" />
  </svg>
)

type Card = (n: GNode, lay: GraphLayout) => ReactNode

function GraphView({ lay, title, legend, card }: { lay: GraphLayout; title: string; legend: ReactNode; card: Card }) {
  const [ref, w] = useWidth(0)
  const [sel, setSel] = useState<string | null>(null)
  const order = useMemo(() => [...lay.nodes].sort((a, b) => a.y - b.y || a.x - b.x).map((n) => n.id), [lay])
  const [cur, setCur] = useState(0)
  const nodeRefs = useRef(new Map<string, SVGGElement | null>())
  const uid = useId().replace(/[^\w-]/g, '')
  const asList = w > 0 && w < lay.width * MIN_SCALE
  const scale = w > 0 ? Math.max(MIN_SCALE, Math.min(MAX_SCALE, w / lay.width)) : 1
  const shown = lay.nodes.find((n) => n.id === sel) || lay.nodes.find((n) => n.start) || lay.nodes[0]
  const related = useMemo(() => {
    if (!sel) return null
    const r = new Set([sel])
    for (const e of lay.edges) {
      if (e.from === sel) r.add(e.to)
      if (e.to === sel) r.add(e.from)
    }
    return r
  }, [sel, lay])
  const focusId = order[Math.min(cur, order.length - 1)]
  const pick = (id: string) => {
    setSel(id)
    setCur(order.indexOf(id))
  }

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
  const hot = (e: { from: string; to: string }) => !!sel && (e.from === sel || e.to === sel)

  return (
    <div className={'mapv graph' + (asList ? ' as-list' : '')} ref={ref}>
      <div className="legend map-key">{legend}</div>
      <div className="map-fig" style={{ maxWidth: Math.round(lay.width * MAX_SCALE) }}>
        <svg className="map-svg" viewBox={`0 0 ${lay.width} ${lay.height}`} role="group" aria-label={lay.aria} style={{ ['--ms' as string]: scale.toFixed(3) }}>
          <defs>
            <marker id={`${uid}-mk`} viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto-start-reverse">
              <path className="mk-a" d="M0 0L10 5L0 10z" />
            </marker>
            <marker id={`${uid}-mkh`} viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto-start-reverse">
              <path className="mk-h" d="M0 0L10 5L0 10z" />
            </marker>
          </defs>
          {lay.bands.map((b, i) => (
            <path key={'b' + i} className={'band pc' + b.slot} d={b.d} strokeWidth={b.sw} />
          ))}
          {lay.start && (
            <g className="m-st" aria-hidden="true">
              <circle cx={lay.start.cx} cy={lay.start.cy} r={5} />
              <path d={lay.start.d} markerEnd={`url(#${uid}-mk)`} />
            </g>
          )}
          {lay.edges.map((e) => {
            const mk = `url(#${uid}${hot(e) ? '-mkh' : '-mk'})`
            return (
              <path
                key={'e' + e.k}
                className={'edge' + (e.dashed ? ' dash' : '') + (sel ? (hot(e) ? ' hot' : ' dim') : '')}
                d={e.d}
                style={e.sw !== 1.6 ? { strokeWidth: e.sw } : undefined}
                markerEnd={mk}
                markerStart={e.both ? mk : undefined}
              />
            )
          })}
          {lay.edges.map((e) =>
            e.label && (lay.labels || hot(e)) ? (
              <text key={'l' + e.k} className={'el' + (sel ? (hot(e) ? ' hot' : ' dim') : '')} x={e.lx} y={e.ly} textAnchor={e.anchor}>
                {e.label}
              </text>
            ) : null,
          )}
          {lay.nodes.map((n) => {
            const Ic = n.icon ? ICONS[n.icon] : null
            const tx = n.x + (Ic ? 36 : 15)
            return (
              <g
                key={n.id}
                ref={(el) => {
                  nodeRefs.current.set(n.id, el)
                }}
                className={'node' + (sel === n.id ? ' sel' : '') + (related && !related.has(n.id) ? ' dim' : '')}
                role="button"
                tabIndex={n.id === focusId ? 0 : -1}
                aria-pressed={sel === n.id}
                aria-label={n.label + (n.sub ? ', ' + n.sub : '') + (n.start ? ', start' : '') + (n.end ? ', end state' : '')}
                onClick={() => pick(n.id)}
                onKeyDown={(e) => onKey(e, n.id)}
              >
                <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={n.r} />
                {n.end && <rect className="ring" x={n.x + 3.5} y={n.y + 3.5} width={n.w - 7} height={n.h - 7} rx={Math.max(0, n.r - 3.5)} />}
                {Ic && <Ic className="ic" x={n.x + 13} y={n.y + n.h / 2 - 8} width={16} height={16} aria-hidden="true" />}
                <text className="nt" x={tx} y={n.sub ? n.y + 22 : n.y + n.h / 2 + 5}>{n.label}</text>
                {n.sub && <text className="ns" x={tx} y={n.y + 39}>{n.sub}</text>}
              </g>
            )
          })}
        </svg>
      </div>
      <ul className="mlist" aria-label={title}>
        {lay.rows.map((r) => (
          <li key={r.id}>
            <button type="button" className="mrow" aria-pressed={sel === r.id} onClick={() => pick(r.id)}>
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
          {card(shown, lay)}
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

/** "Goes to" / "Comes from" lines for a node's card (labels of the other end, with the link's label). */
function Links({ lay, id, out }: { lay: GraphLayout; id: string; out: boolean }) {
  const name = (x: string) => lay.nodes.find((n) => n.id === x)?.label || x
  const list = lay.edges
    .filter((e) => (out ? e.from === id || (e.both && e.to === id) : e.to === id || (e.both && e.from === id)) && !(e.from === id && e.to === id && !out))
    .map((e) => {
      const other = e.from === id ? e.to : e.from
      return (other === id ? 'itself' : name(other)) + (e.label ? ' (' + e.label + ')' : '')
    })
  if (!list.length) return null
  return (
    <p>
      <b>{out ? 'Goes to: ' : 'Comes from: '}</b>
      {list.join(' · ')}
    </p>
  )
}

export function StateMachine({ spec }: { spec: StateMachineSpec }) {
  const lay = useMemo(() => smLayout(spec), [spec])
  const dashed = spec.transitions.some((t) => t.style === 'dashed')
  const ends = spec.states.some((s) => s.terminal)
  return (
    <GraphView
      lay={lay}
      title={spec.title}
      legend={
        <>
          <span>
            <svg className="lg-line" viewBox="0 0 28 8" aria-hidden="true"><circle cx="4" cy="4" r="3.5" /><path d="M8 4H22" /><path className="h" d="M20 1l6 3-6 3z" /></svg>
            start
          </span>
          <span>
            <Arrow />
            moves to
          </span>
          {dashed && (
            <span>
              <Arrow dashed />
              sometimes
            </span>
          )}
          {ends && (
            <span>
              <i className="lg-end" />
              end state
            </span>
          )}
        </>
      }
      card={(n, l) => (
        <>
          <h4>
            {n.label}
            {n.sub && <span className="chip">{n.sub}</span>}
            {n.start && <span className="chip acc">start</span>}
            {n.end && <span className="chip line">end state</span>}
          </h4>
          <Links lay={l} id={n.id} out />
          <Links lay={l} id={n.id} out={false} />
        </>
      )}
    />
  )
}

export function Network({ spec }: { spec: NetworkSpec }) {
  const lay = useMemo(() => netLayout(spec), [spec])
  const both = spec.edges.some((e) => e.both)
  const oneWay = spec.edges.some((e) => !e.both)
  const plural = (k: number) => `${k} link${k === 1 ? '' : 's'}`
  return (
    <GraphView
      lay={lay}
      title={spec.title}
      legend={
        <>
          {lay.groups.map((g) => (
            <span key={g.name}>
              <i className={'gk pc' + g.slot} />
              {g.name}
            </span>
          ))}
          {oneWay && (
            <span>
              <Arrow />
              sends to
            </span>
          )}
          {both && (
            <span>
              <Arrow both />
              both ways
            </span>
          )}
        </>
      }
      card={(n, l) => {
        const group = spec.nodes.find((x) => x.id === n.id)?.group
        return (
          <>
            <h4>
              {n.label}
              {group && <span className={'chip gchip pc' + n.slot}>{group}</span>}
              <span className="chip line">{plural(l.edges.filter((e) => e.from === n.id || e.to === n.id).length)}</span>
            </h4>
            <Links lay={l} id={n.id} out />
            <Links lay={l} id={n.id} out={false} />
          </>
        )
      }}
    />
  )
}
