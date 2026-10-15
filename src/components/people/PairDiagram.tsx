// Pairs as a small node diagram (module D, spec §6.4 Together): people = nodes (alphabetical), one line per pair, line
// weight = how often they helped each other (replies + to-dos for each other + unblocks). Never ranked, no colours on
// people. One picture (role=img) with the full spoken summary; each line has a text tooltip.
import type { Pair } from '../../lib/people-core'
import { pairLayout, pairsSummary } from './people-ui-core'

export function PairDiagram({ pairs, nameOf }: { pairs: Pair[]; nameOf: (login: string) => string }) {
  const W = 320
  const H = pairs.length && new Set(pairs.flatMap((p) => [p.a, p.b])).size > 2 ? 220 : 120
  const { nodes, edges } = pairLayout(pairs, W, H)
  const two = nodes.length === 2
  const short = (l: string) => {
    const n = nameOf(l) || l
    return n.length > 9 ? n.split(/\s+/)[0].slice(0, 9) : n
  }
  return (
    <svg className="pairs" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={pairsSummary(pairs, nameOf)}>
      {edges.map((e) => (
        <g key={e.a + '|' + e.b} data-tipt={`${nameOf(e.a)} ↔ ${nameOf(e.b)}${e.label ? ': ' + e.label : ''}${e.projects.length ? ' · together on ' + e.projects.join(', ') : ''}`}>
          <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} className="pl" strokeWidth={e.width} />
          {two && e.label && (
            <text x={(e.x1 + e.x2) / 2} y={(e.y1 + e.y2) / 2 - 12} textAnchor="middle" className="plab">
              {e.label}
            </text>
          )}
          {two && e.projects.length > 0 && (
            <text x={(e.x1 + e.x2) / 2} y={(e.y1 + e.y2) / 2 + 22} textAnchor="middle" className="plab m">
              together on {e.projects.slice(0, 2).join(', ')}
            </text>
          )}
        </g>
      ))}
      {nodes.map((n) => (
        <g key={n.login}>
          <circle cx={n.x} cy={n.y} r={24} className="pn" />
          <text x={n.x} y={n.y + 4} textAnchor="middle" className="pt">
            {short(n.login)}
          </text>
        </g>
      ))}
    </svg>
  )
}
