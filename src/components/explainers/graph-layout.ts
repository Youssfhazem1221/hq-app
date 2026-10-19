// Geometry for the two graph explainers, statemachine and network (Graph.tsx draws it with the map's node, edge, label
// and list styles). Pure and total like parse.ts: no React, no DOM, never throws on a parsed spec, so the fuzz test
// runs it on every block it draws.
//   statemachine = layers by distance from the start state (BFS), left → right; more than 4 layers that are not taller
//                  than they are long flow top → bottom instead. Moves between neighbouring layers are S-curves (a move
//                  and its way back run as two parallel lanes); longer moves and moves inside one layer take
//                  right-angled detours through the gaps and around the outside, so no line crosses a state. A
//                  self-loop sits on the top-right corner.
//   network      = nodes on a ring (an ellipse, grown until no two boxes touch), each group kept together and backed
//                  by a soft band in its colour; links bow toward the middle, so none crosses a node.
import type { ExIcon, NetworkSpec, StateMachineSpec } from './parse'

type P = { x: number; y: number }
export type GNode = {
  id: string; label: string; sub: string; icon: ExIcon | null
  x: number; y: number; w: number; h: number; r: number
  /** statemachine: the start state · an end state (drawn with a double border) */
  start: boolean; end: boolean
  /** network: the group's colour slot 1–8 (0 = no group) */
  slot: number
}
export type GEdge = {
  k: number; from: string; to: string; label: string
  d: string; lx: number; ly: number; anchor: 'start' | 'middle' | 'end'
  dashed: boolean; both: boolean
  /** stroke width (network weight) */
  sw: number
}
export type GraphLayout = {
  width: number
  height: number
  nodes: GNode[]
  edges: GEdge[]
  /** network: one band per group, behind its nodes */
  bands: { d: string; slot: number; sw: number }[]
  /** statemachine: the start marker (a dot with an arrow into the start state) */
  start: { cx: number; cy: number; d: string } | null
  groups: { name: string; slot: number }[]
  /** Draw every edge label (else only the picked node's, when there are too many to read). */
  labels: boolean
  /** List twin: one row per node with where it leads. */
  rows: { id: string; label: string; sub: string; to: string[] }[]
  /** "Show as a list": "A → B: label". */
  lines: string[]
  aria: string
}

type Route = { pts: P[]; path: (o: P) => string }
type RawEdge = Route & { k: number; from: string; to: string; label: string; l: P; anchor: GEdge['anchor']; dashed: boolean; both: boolean; sw: number }

const r1 = (n: number) => Math.round(n * 10) / 10
const textW = (s: string, px: number) => s.length * px * 0.6
const xy = (p: P, o: P) => `${r1(p.x + o.x)} ${r1(p.y + o.y)}`

/** A cubic from s to e, and its point at t = ½. */
function cubic(s: P, c1: P, c2: P, e: P): Route & { mid: P } {
  return {
    pts: [s, c1, c2, e],
    path: (o) => `M${xy(s, o)}C${xy(c1, o)} ${xy(c2, o)} ${xy(e, o)}`,
    mid: { x: (s.x + 3 * c1.x + 3 * c2.x + e.x) / 8, y: (s.y + 3 * c1.y + 3 * c2.y + e.y) / 8 },
  }
}

/** A right-angled route through `pts`, corners rounded. */
function ortho(pts: P[], r = 10): Route {
  return {
    pts,
    path: (o) => {
      let d = 'M' + xy(pts[0], o)
      for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1], c = pts[i], b = pts[i + 1]
        const l1 = Math.hypot(c.x - a.x, c.y - a.y), l2 = Math.hypot(b.x - c.x, b.y - c.y)
        const k = Math.min(r, l1 / 2, l2 / 2)
        if (!(k > 0.5)) {
          d += 'L' + xy(c, o)
          continue
        }
        d += 'L' + xy({ x: c.x - ((c.x - a.x) / l1) * k, y: c.y - ((c.y - a.y) / l1) * k }, o)
        d += 'Q' + xy(c, o) + ' ' + xy({ x: c.x + ((b.x - c.x) / l2) * k, y: c.y + ((b.y - c.y) / l2) * k }, o)
      }
      return d + 'L' + xy(pts[pts.length - 1], o)
    },
  }
}

/** Node box size from its text: 14 px label, 11.5 px sub line, room for an icon. */
function boxSize(label: string, sub: string, icon: boolean, minW: number, h: number) {
  const w = Math.max(textW(label, 14), textW(sub, 11.5)) + 30 + (icon ? 22 : 0)
  return { w: Math.round(Math.max(minW, Math.min(220, w))), h: sub ? h + 14 : h }
}

type Band = { pts: P[]; make: (o: P) => string; slot: number; sw: number }

/** Shift everything so the drawing starts at `pad`, and write the paths. */
function finish(
  base: Omit<GraphLayout, 'width' | 'height' | 'nodes' | 'edges' | 'bands' | 'start'>,
  nodes: GNode[], raw: RawEdge[], pad: number, bands: Band[] = [], start: { c: P; s: P; e: P } | null = null,
): GraphLayout {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const grow = (p: P, rx = 0, ry = rx) => {
    x0 = Math.min(x0, p.x - rx); y0 = Math.min(y0, p.y - ry); x1 = Math.max(x1, p.x + rx); y1 = Math.max(y1, p.y + ry)
  }
  for (const n of nodes) {
    grow({ x: n.x, y: n.y })
    grow({ x: n.x + n.w, y: n.y + n.h })
  }
  for (const e of raw) {
    for (const p of e.pts) grow(p)
    if (e.label) {
      const w = textW(e.label, 11.5)
      const left = e.anchor === 'start' ? e.l.x : e.anchor === 'end' ? e.l.x - w : e.l.x - w / 2
      grow({ x: left, y: e.l.y - 12 })
      grow({ x: left + w, y: e.l.y + 4 })
    }
  }
  for (const b of bands) for (const p of b.pts) grow(p, b.sw / 2)
  if (start) grow(start.c, 6)
  if (!Number.isFinite(x0)) x0 = y0 = x1 = y1 = 0
  const o = { x: pad - x0, y: pad - y0 }
  return {
    ...base,
    width: Math.ceil(x1 - x0 + pad * 2),
    height: Math.ceil(y1 - y0 + pad * 2),
    nodes: nodes.map((n) => ({ ...n, x: r1(n.x + o.x), y: r1(n.y + o.y) })),
    edges: raw.map((e) => ({
      k: e.k, from: e.from, to: e.to, label: e.label, d: e.path(o), lx: r1(e.l.x + o.x), ly: r1(e.l.y + o.y),
      anchor: e.anchor, dashed: e.dashed, both: e.both, sw: e.sw,
    })),
    bands: bands.map((b) => ({ d: b.make(o), slot: b.slot, sw: b.sw })),
    start: start ? { cx: r1(start.c.x + o.x), cy: r1(start.c.y + o.y), d: `M${xy(start.s, o)}L${xy(start.e, o)}` } : null,
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// statemachine
// ---------------------------------------------------------------------------------------------------------------------

/** h = state height · gaps between states in a layer (stacked / side by side) and between top → bottom layers ·
 *  mark = start-marker length · out/lane/over = how far detours run from the boxes, and their spacing. */
const SM = { h: 40, minW: 96, gapY: 34, gapXtb: 44, gapRow: 52, mark: 40, out: 18, lane: 8, over: 22 } as const
type Side = 'L' | 'R' | 'T' | 'B'

export function smLayout(spec: Pick<StateMachineSpec, 'title' | 'initial' | 'states' | 'transitions'>): GraphLayout {
  const states = Array.isArray(spec && spec.states) ? spec.states : []
  const byId = new Map(states.map((s) => [s.id, s] as const))
  const moves = (Array.isArray(spec && spec.transitions) ? spec.transitions : []).filter((t) => byId.has(t.from) && byId.has(t.to))
  const initial = spec && byId.has(spec.initial) ? spec.initial : states[0]?.id
  const name = (id: string) => byId.get(id)!.label

  // layers = BFS distance from the start; states it never reaches open new layers after it, in source order
  const out = new Map<string, string[]>(states.map((s) => [s.id, []]))
  for (const t of moves) if (t.from !== t.to) out.get(t.from)!.push(t.to)
  const depth = new Map<string, number>()
  const bfs = (root: string, d0: number) => {
    depth.set(root, d0)
    const q = [root]
    for (let i = 0; i < q.length; i++)
      for (const nx of out.get(q[i])!)
        if (!depth.has(nx)) {
          depth.set(nx, depth.get(q[i])! + 1)
          q.push(nx)
        }
  }
  if (initial) bfs(initial, 0)
  for (const s of states) if (!depth.has(s.id)) bfs(s.id, Math.max(-1, ...depth.values()) + 1)
  const D = (id: string) => depth.get(id)!
  const layers: string[][] = []
  for (const [id, d] of depth) (layers[d] ||= []).push(id)
  // one barycentre pass: a state sits near the states that lead into it from the layer before
  const idx = new Map<string, number>()
  layers.forEach((l) => l.forEach((id, i) => idx.set(id, i)))
  for (let i = 1; i < layers.length; i++) {
    const key = new Map(
      layers[i].map((id) => {
        const ps = moves.filter((t) => t.to === id && t.from !== id && D(t.from) === i - 1).map((t) => idx.get(t.from)!)
        return [id, ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : idx.get(id)!] as const
      }),
    )
    layers[i].sort((a, b) => key.get(a)! - key.get(b)!)
    layers[i].forEach((id, j) => idx.set(id, j))
  }
  const lr = layers.length <= 4 || Math.max(0, ...layers.map((l) => l.length)) >= layers.length

  // boxes; each layer's extent along the main axis (x left → right, y top → bottom)
  const size = new Map(states.map((s) => [s.id, boxSize(s.label, s.sub, !!s.icon, SM.minW, SM.h)] as const))
  const box = new Map<string, { x: number; y: number; w: number; h: number }>()
  const lo: number[] = [], hi: number[] = []
  if (lr) {
    // each gap is as wide as the longest label crossing it
    const gap = layers.map((_, i) =>
      Math.round(Math.max(92, Math.min(184, 30 + Math.max(0, ...moves.filter((t) => Math.min(D(t.from), D(t.to)) === i && Math.abs(D(t.from) - D(t.to)) === 1).map((t) => textW(t.label, 11.5)))))),
    )
    const colW = layers.map((l) => Math.max(...l.map((id) => size.get(id)!.w)))
    const colH = layers.map((l) => l.reduce((a, id) => a + size.get(id)!.h, 0) + (l.length - 1) * SM.gapY)
    const H = Math.max(0, ...colH)
    let x = 0
    layers.forEach((l, i) => {
      let y = (H - colH[i]) / 2
      for (const id of l) {
        const z = size.get(id)!
        box.set(id, { x: x + (colW[i] - z.w) / 2, y, w: z.w, h: z.h })
        y += z.h + SM.gapY
      }
      lo[i] = x
      hi[i] = x + colW[i]
      x += colW[i] + gap[i]
    })
  } else {
    const rowW = layers.map((l) => l.reduce((a, id) => a + size.get(id)!.w, 0) + (l.length - 1) * SM.gapXtb)
    const rowH = layers.map((l) => Math.max(...l.map((id) => size.get(id)!.h)))
    const W = Math.max(0, ...rowW)
    let y = 0
    layers.forEach((l, i) => {
      let x = (W - rowW[i]) / 2
      for (const id of l) {
        const z = size.get(id)!
        box.set(id, { x, y: y + (rowH[i] - z.h) / 2, w: z.w, h: z.h })
        x += z.w + SM.gapXtb
      }
      lo[i] = y
      hi[i] = y + rowH[i]
      y += rowH[i] + SM.gapRow
    })
  }
  const B = (id: string) => box.get(id)!
  const cx = (id: string) => B(id).x + B(id).w / 2
  const cy = (id: string) => B(id).y + B(id).h / 2
  /** Every box in layers a..b (inclusive, either order). */
  const inLayers = (a: number, b: number) => layers.slice(Math.min(a, b), Math.max(a, b) + 1).flat().map(B)

  // which side of each box a move leaves from and arrives at (null = self-loop)
  const sidesOf = (t: { from: string; to: string }): [Side, Side] | null => {
    if (t.from === t.to) return null
    const d = D(t.to) - D(t.from)
    if (lr) {
      if (d > 0) return ['R', 'L']
      if (d < 0) return ['L', 'R']
      if (Math.abs(idx.get(t.from)! - idx.get(t.to)!) === 1) return idx.get(t.from)! < idx.get(t.to)! ? ['B', 'T'] : ['T', 'B']
      return ['R', 'R']
    }
    if (d === 1) return ['B', 'T']
    if (d === -1) return ['T', 'B']
    if (d > 1) return ['L', 'L']
    if (d < -1) return ['R', 'R']
    if (Math.abs(idx.get(t.from)! - idx.get(t.to)!) === 1) return idx.get(t.from)! < idx.get(t.to)! ? ['R', 'L'] : ['L', 'R']
    return ['B', 'B']
  }
  // ports: the moves on one side of a box spread along it, ordered by where their other end is
  const atts = new Map<string, { other: string; key: string }[]>()
  moves.forEach((t, k) => {
    const sd = sidesOf(t)
    if (!sd) return
    for (const [id, s, other, end] of [[t.from, sd[0], t.to, 'f'], [t.to, sd[1], t.from, 't']] as const) {
      const list = atts.get(id + s) || []
      list.push({ other, key: k + end })
      atts.set(id + s, list)
    }
  })
  const port = new Map<string, number>()
  for (const [ks, list] of atts) {
    const id = ks.slice(0, -1), s = ks.slice(-1) as Side
    const along = s === 'L' || s === 'R'
    list.sort((a, b) => (along ? cy(a.other) - cy(b.other) : cx(a.other) - cx(b.other)))
    const len = along ? B(id).h : B(id).w
    const step = Math.min(12, (len - 16) / Math.max(1, list.length - 1))
    list.forEach((a, i) => port.set(a.key, (i - (list.length - 1) / 2) * step))
  }
  /** The point on side s of a box for move k's end ('f' = leaves, 't' = arrives 3 px off the box, for the arrowhead). */
  const at = (id: string, s: Side, key: string): P => {
    const z = B(id), off = port.get(key) || 0, gap = key.endsWith('t') ? 3 : 0
    if (s === 'L') return { x: z.x - gap, y: z.y + z.h / 2 + off }
    if (s === 'R') return { x: z.x + z.w + gap, y: z.y + z.h / 2 + off }
    if (s === 'T') return { x: z.x + z.w / 2 + off, y: z.y - gap }
    return { x: z.x + z.w / 2 + off, y: z.y + z.h + gap }
  }

  const lane = { over: 0, under: 0, side: 0 }
  const raw: RawEdge[] = moves.map((t, k) => {
    const sd = sidesOf(t)
    const base = { k, from: t.from, to: t.to, label: t.label, dashed: t.style === 'dashed', both: false, sw: 1.6 }
    if (!sd) {
      const a = B(t.from)
      const c = cubic({ x: a.x + a.w - 24, y: a.y }, { x: a.x + a.w - 22, y: a.y - 34 }, { x: a.x + a.w + 34, y: a.y + 12 }, { x: a.x + a.w + 3, y: a.y + Math.min(14, a.h / 2) })
      return { ...base, ...c, l: { x: a.x + a.w + 12, y: a.y - 22 }, anchor: 'start' }
    }
    const s = at(t.from, sd[0], k + 'f'), e = at(t.to, sd[1], k + 't')
    const d = D(t.to) - D(t.from)
    if (lr) {
      if (Math.abs(d) === 1) {
        const mx = (s.x + e.x) / 2
        const c = cubic(s, { x: mx, y: s.y }, { x: mx, y: e.y }, e)
        return { ...base, ...c, l: { x: c.mid.x, y: c.mid.y + (d > 0 ? -7 : 15) }, anchor: 'middle' }
      }
      if (d > 1) {
        // over the layers it skips: out through the gap, along the top, down into the target's left side
        const n = lane.over++
        const top = Math.min(s.y, e.y, ...inLayers(D(t.from) + 1, D(t.to) - 1).map((z) => z.y)) - SM.over - n * 12
        const g1 = hi[D(t.from)] + SM.out + n * SM.lane, g2 = lo[D(t.to)] - SM.out - n * SM.lane
        return { ...base, ...ortho([s, { x: g1, y: s.y }, { x: g1, y: top }, { x: g2, y: top }, { x: g2, y: e.y }, e]), l: { x: (g1 + g2) / 2, y: top - 6 }, anchor: 'middle' }
      }
      if (d < -1) {
        const n = lane.under++
        const bottom = Math.max(s.y, e.y, ...inLayers(D(t.to) + 1, D(t.from) - 1).map((z) => z.y + z.h)) + SM.over + n * 12
        const g1 = lo[D(t.from)] - SM.out - n * SM.lane, g2 = hi[D(t.to)] + SM.out + n * SM.lane
        return { ...base, ...ortho([s, { x: g1, y: s.y }, { x: g1, y: bottom }, { x: g2, y: bottom }, { x: g2, y: e.y }, e]), l: { x: (g1 + g2) / 2, y: bottom + 15 }, anchor: 'middle' }
      }
      if (sd[0] !== 'R') return { ...base, ...ortho([s, e]), l: { x: s.x + 8, y: (s.y + e.y) / 2 + 4 }, anchor: 'start' }
      const g = hi[D(t.from)] + SM.out + lane.side++ * SM.lane
      return { ...base, ...ortho([s, { x: g, y: s.y }, { x: g, y: e.y }, e]), l: { x: g + 6, y: (s.y + e.y) / 2 + 4 }, anchor: 'start' }
    }
    if (Math.abs(d) === 1) {
      const my = (s.y + e.y) / 2
      const c = cubic(s, { x: s.x, y: my }, { x: e.x, y: my }, e)
      return { ...base, ...c, l: { x: c.mid.x + (d > 0 ? 8 : -8), y: c.mid.y + 4 }, anchor: d > 0 ? 'start' : 'end' }
    }
    if (d > 1) {
      const g = Math.min(...inLayers(D(t.from), D(t.to)).map((z) => z.x)) - SM.out - lane.over++ * SM.lane
      return { ...base, ...ortho([s, { x: g, y: s.y }, { x: g, y: e.y }, e]), l: { x: g - 6, y: (s.y + e.y) / 2 + 4 }, anchor: 'end' }
    }
    if (d < -1) {
      const g = Math.max(...inLayers(D(t.from), D(t.to)).map((z) => z.x + z.w)) + SM.out + lane.under++ * SM.lane
      return { ...base, ...ortho([s, { x: g, y: s.y }, { x: g, y: e.y }, e]), l: { x: g + 6, y: (s.y + e.y) / 2 + 4 }, anchor: 'start' }
    }
    if (sd[0] !== 'B') return { ...base, ...ortho([s, e]), l: { x: (s.x + e.x) / 2, y: s.y - 6 }, anchor: 'middle' }
    const g = hi[D(t.from)] + SM.out + lane.side++ * SM.lane
    return { ...base, ...ortho([s, { x: s.x, y: g }, { x: e.x, y: g }, e]), l: { x: (s.x + e.x) / 2, y: g + 14 }, anchor: 'middle' }
  })

  const nodes: GNode[] = states.map((s) => {
    const z = B(s.id)
    return { id: s.id, label: s.label, sub: s.sub, icon: s.icon, x: z.x, y: z.y, w: z.w, h: z.h, r: Math.min(z.h / 2, 20), start: s.id === initial, end: s.terminal, slot: 0 }
  })
  // start marker: a dot and a short arrow into the start state, from the left (left → right) or from above
  let start: { c: P; s: P; e: P } | null = null
  if (initial) {
    const z = B(initial)
    start = lr
      ? { c: { x: z.x - SM.mark, y: cy(initial) }, s: { x: z.x - SM.mark + 5, y: cy(initial) }, e: { x: z.x - 3, y: cy(initial) } }
      : { c: { x: cx(initial), y: z.y - SM.mark }, s: { x: cx(initial), y: z.y - SM.mark + 5 }, e: { x: cx(initial), y: z.y - 3 } }
  }
  const title = (spec && spec.title) || 'State machine'
  return finish(
    {
      groups: [],
      labels: true,
      rows: states.map((s) => ({
        id: s.id,
        label: s.label,
        sub: s.sub,
        to: moves.filter((t) => t.from === s.id).map((t) => (t.to === s.id ? 'itself' : name(t.to)) + (t.label ? ' (' + t.label + ')' : '')),
      })),
      lines: moves.map((t) => `${name(t.from)} → ${t.to === t.from ? 'itself' : name(t.to)}${t.label ? ': ' + t.label : ''}`),
      aria: `${title}: starts at ${initial ? name(initial) : 'nothing'}; states ${states.map((s) => s.label).join(', ')}`,
    },
    nodes, raw, 16, [], start,
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// network
// ---------------------------------------------------------------------------------------------------------------------

const NET = { h: { sm: 32, md: 40, lg: 50 }, minW: { sm: 72, md: 92, lg: 120 }, band: 24, bend: 0.32 } as const

export function netLayout(spec: Pick<NetworkSpec, 'title' | 'nodes' | 'edges'>): GraphLayout {
  const all = Array.isArray(spec && spec.nodes) ? spec.nodes : []
  // groups keep their first-seen order; their nodes sit together on the ring, ungrouped nodes last
  const groups: { name: string; slot: number }[] = []
  for (const n of all) if (n.group && !groups.some((g) => g.name === n.group)) groups.push({ name: n.group, slot: groups.length + 1 })
  const slotOf = (g: string) => groups.find((x) => x.name === g)?.slot || 0
  const ring = [...all].sort((a, b) => (slotOf(a.group) || 99) - (slotOf(b.group) || 99))
  const byId = new Map(all.map((n) => [n.id, n] as const))
  const links = (Array.isArray(spec && spec.edges) ? spec.edges : []).filter((e) => e.from !== e.to && byId.has(e.from) && byId.has(e.to))
  const n = ring.length
  const sizes = ring.map((x) => boxSize(x.label, '', !!x.icon, NET.minW[x.size] || NET.minW.md, NET.h[x.size] || NET.h.md))
  const step = (Math.PI * 2) / Math.max(1, n)
  const a0 = n === 2 ? Math.PI : -Math.PI / 2
  const ang = (i: number) => a0 + i * step
  // grow the ellipse until no two boxes touch (14 px apart sideways or 10 px vertically)
  let rx = n < 2 ? 0 : Math.max(120, n * 26)
  let ry = n < 2 ? 0 : Math.max(70, n * 15)
  let pos: P[] = []
  for (let it = 0; it < 40; it++) {
    pos = ring.map((_, i) => ({ x: rx * Math.cos(ang(i)), y: ry * Math.sin(ang(i)) }))
    let clash = false
    for (let i = 0; i < n && !clash; i++)
      for (let j = i + 1; j < n && !clash; j++)
        clash = Math.abs(pos[i].x - pos[j].x) < (sizes[i].w + sizes[j].w) / 2 + 14 && Math.abs(pos[i].y - pos[j].y) < (sizes[i].h + sizes[j].h) / 2 + 10
    if (!clash) break
    rx *= 1.08
    ry *= 1.08
  }
  const index = new Map(ring.map((x, i) => [x.id, i] as const))
  const nodes: GNode[] = ring.map((x, i) => ({
    id: x.id, label: x.label, sub: '', icon: x.icon,
    x: pos[i].x - sizes[i].w / 2, y: pos[i].y - sizes[i].h / 2, w: sizes[i].w, h: sizes[i].h, r: sizes[i].h / 2,
    start: false, end: false, slot: slotOf(x.group),
  }))

  // a link leaves its box toward the bend point (the boxes are pills; their straight sides are close enough)
  const exit = (c: P, w: number, h: number, to: P, gap: number): P => {
    const dx = to.x - c.x, dy = to.y - c.y
    const len = Math.hypot(dx, dy) || 1
    const t = Math.min(dx ? w / 2 / Math.abs(dx) : Infinity, dy ? h / 2 / Math.abs(dy) : Infinity)
    const k = Number.isFinite(t) ? t : 0
    return { x: c.x + dx * k + (dx / len) * gap, y: c.y + dy * k + (dy / len) * gap }
  }
  const raw: RawEdge[] = links.map((e, k) => {
    const i = index.get(e.from)!, j = index.get(e.to)!
    const m = { x: (pos[i].x + pos[j].x) / 2, y: (pos[i].y + pos[j].y) / 2 }
    const bend = { x: m.x * (1 - NET.bend), y: m.y * (1 - NET.bend) } // pulled toward the middle (0, 0)
    const s = exit(pos[i], sizes[i].w, sizes[i].h, bend, e.both ? 3 : 1)
    const t = exit(pos[j], sizes[j].w, sizes[j].h, bend, 3)
    const c = cubic(s, { x: s.x + ((bend.x - s.x) * 2) / 3, y: s.y + ((bend.y - s.y) * 2) / 3 }, { x: t.x + ((bend.x - t.x) * 2) / 3, y: t.y + ((bend.y - t.y) * 2) / 3 }, t)
    return { k, from: e.from, to: e.to, label: e.label, ...c, l: { x: c.mid.x, y: c.mid.y + 4 }, anchor: 'middle', dashed: false, both: e.both, sw: 1.3 + (e.weight - 1) * 0.7 }
  })

  // one band per group along the ellipse, from just before its first node to just after its last; the round caps stop
  // short of the next group's band
  const ell = (t: number): P => ({ x: rx * Math.cos(t), y: ry * Math.sin(t) })
  const bands: Band[] = groups.map((g) => {
    const mine = ring.map((x, i) => (x.group === g.name ? i : -1)).filter((i) => i >= 0)
    const sw = Math.max(...mine.map((i) => sizes[i].h)) + NET.band
    const full = mine.length === n && n > 2
    const reach = Math.max(step * 0.06, step * 0.5 - (sw / 2 + 10) / Math.max(1, (rx + ry) / 2))
    const t0 = ang(mine[0]) - reach
    const t1 = ang(mine[mine.length - 1]) + reach
    const make = (o: P) => {
      if (n < 2 || t1 - t0 < 0.01) return `M${xy({ x: pos[mine[0]].x - 0.5, y: pos[mine[0]].y }, o)}L${xy({ x: pos[mine[0]].x + 0.5, y: pos[mine[0]].y }, o)}`
      if (full) return `M${xy({ x: -rx, y: 0 }, o)}A${r1(rx)} ${r1(ry)} 0 1 1 ${xy({ x: rx, y: 0 }, o)}A${r1(rx)} ${r1(ry)} 0 1 1 ${xy({ x: -rx, y: 0 }, o)}`
      return `M${xy(ell(t0), o)}A${r1(rx)} ${r1(ry)} 0 ${t1 - t0 > Math.PI ? 1 : 0} 1 ${xy(ell(t1), o)}`
    }
    return { pts: full ? [{ x: -rx, y: -ry }, { x: rx, y: ry }] : [ell(t0), ell(t1), ...mine.map((i) => pos[i])], make, slot: g.slot, sw }
  })

  const name = (id: string) => byId.get(id)!.label
  const title = (spec && spec.title) || 'Network'
  return finish(
    {
      groups,
      labels: links.length <= 8,
      rows: ring.map((x) => ({
        id: x.id,
        label: x.label,
        sub: x.group,
        to: links.filter((e) => e.from === x.id || (e.both && e.to === x.id)).map((e) => name(e.from === x.id ? e.to : e.from)),
      })),
      lines: links.map((e) => `${name(e.from)} ${e.both ? '↔' : '→'} ${name(e.to)}${e.label ? ': ' + e.label : ''}`),
      aria: `${title}: ${ring.map((x) => x.label).join(', ')}`,
    },
    nodes, raw, 14, bands,
  )
}
