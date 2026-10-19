// ```explainer blocks: the TOTAL parser (spec §5.1). Untrusted JSON from Claude, Gemini or a teammate goes in; a
// clean spec or null comes out. It never throws, never keeps HTML, clips every string and caps every list, so the
// renderers (Explainer.tsx and friends) only see bounded data and print it as text. Port of the mock's
// parseExplainer (design mock, src/explainers.js) with four hardenings: ids are tracked in Sets (a node id such as
// "constructor" can't collide with Object.prototype and smuggle in an edge to a missing node), `source` may not
// contain "." / ".." / empty segments, text loses control and bidi-override characters, and only finite numbers
// count as text. No React and no runtime imports except the shared contract constants, so the fuzz test and
// lib/auto-visuals.ts use it directly.
import { EXPLAINER_ICONS, MAX_RICH_BLOCKS, type BlockCtx, type ExplainerIcon } from '../../lib/contracts'

export const EX_TYPES = ['map', 'flow', 'cards', 'timeline', 'compare', 'statemachine', 'network'] as const
export type ExType = (typeof EX_TYPES)[number]
/** The 30 icon names a block may use (the contract's list; mapped to lucide in lib/icons.tsx). Anything else → no icon. */
export const EX_ICONS = EXPLAINER_ICONS
export type ExIcon = ExplainerIcon
export const EX_STATUS = ['done', 'now', 'next', 'later', 'blocked', 'wait'] as const
export type ExStatus = (typeof EX_STATUS)[number]
export const EX_TONES = ['ok', 'warn', 'idea'] as const
export type ExTone = (typeof EX_TONES)[number]
/** Network node sizes. */
export const EX_SIZES = ['sm', 'md', 'lg'] as const
export type ExSize = (typeof EX_SIZES)[number]

/** Byte cap checked before JSON.parse (UTF-8). */
export const EX_MAX_BYTES = 12288
/** Rich blocks (charts + explainers) per doc or answer; the next one shows as code. */
export const EX_MAX_RICH = MAX_RICH_BLOCKS
/** Every cap the parser enforces (string lengths in UTF-16 units, list lengths in items). */
export const EX_LIMITS = {
  title: 80, subtitle: 140, next: 140, source: 120,
  steps: 10, stepTitle: 60, stepText: 280, bullets: 4, bullet: 120,
  nodes: 12, edges: 16, maxCol: 5, maxRow: 4, nodeId: 24, label: 22, sub: 26, what: 200, edgeLabel: 24,
  cards: 8, cardTitle: 40, cardText: 160,
  items: 12, date: 16, itemTitle: 80,
  columns: 5, column: 24, rows: 8, rowName: 60, cell: 60, parts: 3, part: 40, meterNote: 60,
  states: 12, transitions: 16, netNodes: 16, netEdges: 24, group: 24, groups: 8,
  fallback: 2000,
} as const
const L = EX_LIMITS

export type FlowStep = { title: string; text: string; icon: ExIcon | null; status: ExStatus | null; bullets: string[] }
export type MapNode = {
  id: string; label: string; sub: string; col: number; row: number
  icon: ExIcon | null; status: ExStatus | null; what: string; bullets: string[]
}
export type MapEdge = { from: string; to: string; label: string; style: 'solid' | 'dashed'; both: boolean }
export type ExCard = { title: string; text: string; icon: ExIcon | null; more: string[] }
export type TimelineItem = { date: string; title: string; done: boolean }
export type EvidencePart = { text: string; tone: ExTone | null }
export type CompareCell = { text: string; tone: ExTone | null; meter: number | null; parts: EvidencePart[] | null }
export type CompareRow = { name: string; pick: boolean; cells: CompareCell[] }
export type SmState = { id: string; label: string; sub: string; icon: ExIcon | null; terminal: boolean }
/** A move between states; from === to is a self-loop (e.g. "retry"). */
export type SmTransition = { from: string; to: string; label: string; style: 'solid' | 'dashed' }
export type NetNode = { id: string; label: string; group: string; icon: ExIcon | null; size: ExSize }
/** `both` = arrows at both ends (the spec key is `bidirectional`; `both` is accepted too, as on a map). weight 1–5. */
export type NetEdge = { from: string; to: string; label: string; both: boolean; weight: number }

/** Shared head. `source` is '' unless it is a safe .md path that exists; `title` falls back to "Explainer". */
type Head = { title: string; subtitle: string; source: string; next: string }
export type FlowSpec = Head & { type: 'flow'; steps: FlowStep[] }
export type MapSpec = Head & { type: 'map'; nodes: MapNode[]; edges: MapEdge[] }
export type CardsSpec = Head & { type: 'cards'; cards: ExCard[] }
export type TimelineSpec = Head & { type: 'timeline'; items: TimelineItem[] }
export type CompareSpec = Head & { type: 'compare'; columns: string[]; meter_note: string; rows: CompareRow[] }
/** `initial` is always a state id (the first state when the block names none or an unknown one). */
export type StateMachineSpec = Head & { type: 'statemachine'; initial: string; states: SmState[]; transitions: SmTransition[] }
export type NetworkSpec = Head & { type: 'network'; nodes: NetNode[]; edges: NetEdge[] }
export type ExplainerSpec = FlowSpec | MapSpec | CardsSpec | TimelineSpec | CompareSpec | StateMachineSpec | NetworkSpec

export type ParseOptions = {
  /** Does this repo path exist (e.g. `p => model.byPath.has(p)`)? Without it, every `source` is dropped. */
  exists?: (path: string) => unknown
}

type Rec = Record<string, unknown>
const isObj = (x: unknown): x is Rec => !!x && typeof x === 'object' && !Array.isArray(x)
const list = (x: unknown, n: number): unknown[] => (Array.isArray(x) ? x.slice(0, n) : [])
const oneOf = <T extends string>(set: readonly T[], x: unknown): T | null =>
  typeof x === 'string' && (set as readonly string[]).includes(x) ? (x as T) : null

const CONTROL = /[\u0000-\u001f\u007f-\u009f]+/g
const BIDI = /[\u{200e}\u{200f}\u{202a}-\u{202e}\u{2066}-\u{2069}]/gu
const SOURCE_RE = /^[\w./-]{1,120}\.md$/
const NODE_ID = /^[a-z0-9_-]{1,24}$/i

/** Cut to at most n UTF-16 units, ending in "…" when cut (never splits a surrogate pair). */
export function clip(s: string, n: number): string {
  if (s.length <= n) return s
  if (n < 1) return ''
  let cut = n - 1
  const c = s.charCodeAt(cut - 1)
  if (c >= 0xd800 && c <= 0xdbff) cut--
  return s.slice(0, cut) + '…'
}

/** A display string: strings and finite numbers only; control/bidi characters out, whitespace collapsed, clipped. */
export function txt(x: unknown, n: number): string {
  const s = typeof x === 'string' ? x : typeof x === 'number' && Number.isFinite(x) ? String(x) : ''
  if (!s) return ''
  return clip(s.replace(CONTROL, ' ').replace(BIDI, '').replace(/\s+/g, ' ').trim(), n)
}

/** Over the byte cap? UTF-8 bytes ≥ UTF-16 units and ≤ 3 × units, so most strings skip the encoder. */
function tooBig(s: string) {
  if (s.length > EX_MAX_BYTES) return true
  if (s.length * 3 <= EX_MAX_BYTES) return false
  try {
    return new TextEncoder().encode(s).length > EX_MAX_BYTES
  } catch {
    return true
  }
}

const bullets = (x: unknown) => list(x, L.bullets).map((b) => txt(b, L.bullet)).filter(Boolean)

/** Grid coordinate with the mock's exact `| 0` coercion ('2' → 2, true → 1, junk → 0), clamped; Symbol/BigInt → 0. */
function gridInt(v: unknown, max: number) {
  let n = 0
  try {
    n = (v as number) | 0
  } catch {
    n = 0
  }
  return Math.max(0, Math.min(max, n))
}

function sourceOf(x: unknown, exists: ParseOptions['exists']) {
  if (typeof x !== 'string' || !SOURCE_RE.test(x)) return ''
  if (x.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return ''
  try {
    return exists && exists(x) ? x : ''
  } catch {
    return ''
  }
}

function cellOf(c: unknown): CompareCell {
  if (!isObj(c)) return { text: txt(c, L.cell), tone: null, meter: null, parts: null }
  return {
    text: txt(c.text, L.cell),
    tone: oneOf(EX_TONES, c.tone),
    meter: typeof c.meter === 'number' && Number.isFinite(c.meter) ? Math.max(0, Math.min(1, c.meter)) : null,
    parts: Array.isArray(c.parts) ? list(c.parts, L.parts).filter(isObj).map((p) => ({ text: txt(p.text, L.part), tone: oneOf(EX_TONES, p.tone) })) : null,
  }
}

/**
 * Untrusted block (the JSON text of a ```explainer fence, or an object) → a clean spec, or null when it can't be
 * drawn (the caller then shows the block as code). Total: never throws, whatever `src` is.
 */
export function parseExplainer(src: unknown, opts?: ParseOptions | null): ExplainerSpec | null {
  try {
    let s: unknown = src
    if (typeof src === 'string') {
      if (tooBig(src)) return null
      s = JSON.parse(src.charCodeAt(0) === 0xfeff ? src.slice(1) : src)
    }
    if (!isObj(s)) return null
    const type = s.type === 'steps' ? 'flow' : oneOf(EX_TYPES, s.type)
    if (!type) return null
    const head: Head = {
      title: txt(s.title, L.title) || 'Explainer',
      subtitle: txt(s.subtitle, L.subtitle),
      source: sourceOf(s.source, opts ? opts.exists : undefined),
      next: txt(s.next, L.next),
    }

    if (type === 'flow') {
      const steps = list(s.steps, L.steps).filter(isObj).map((x) => ({
        title: txt(x.title, L.stepTitle),
        text: txt(x.text, L.stepText),
        icon: oneOf(EX_ICONS, x.icon),
        status: oneOf(EX_STATUS, x.status),
        bullets: bullets(x.bullets),
      })).filter((x) => x.title)
      return steps.length ? { type, ...head, steps } : null
    }

    if (type === 'map') {
      const ids = new Set<string>()
      const cells = new Set<string>()
      const nodes: MapNode[] = []
      for (const n of list(s.nodes, L.nodes)) {
        if (!isObj(n)) continue
        const id = n.id
        const label = txt(n.label, L.label)
        const col = gridInt(n.col, L.maxCol)
        const row = gridInt(n.row, L.maxRow)
        const cell = col + ',' + row
        if (typeof id !== 'string' || !NODE_ID.test(id) || ids.has(id) || cells.has(cell) || !label) continue
        ids.add(id)
        cells.add(cell)
        nodes.push({
          id, label, sub: txt(n.sub, L.sub), col, row,
          icon: oneOf(EX_ICONS, n.icon), status: oneOf(EX_STATUS, n.status), what: txt(n.what, L.what), bullets: bullets(n.bullets),
        })
      }
      if (!nodes.length) return null
      const pairs = new Set<string>()
      const edges: MapEdge[] = []
      for (const e of list(s.edges, L.edges)) {
        if (!isObj(e)) continue
        const { from, to } = e
        if (typeof from !== 'string' || typeof to !== 'string' || from === to || !ids.has(from) || !ids.has(to)) continue
        const key = from < to ? from + '>' + to : to + '>' + from
        if (pairs.has(key)) continue
        pairs.add(key)
        edges.push({ from, to, label: txt(e.label, L.edgeLabel), style: e.style === 'dashed' ? 'dashed' : 'solid', both: e.both === true })
      }
      return { type, ...head, nodes, edges }
    }

    if (type === 'statemachine') {
      const ids = new Set<string>()
      const states: SmState[] = []
      for (const n of list(s.states, L.states)) {
        if (!isObj(n)) continue
        const id = n.id
        const label = txt(n.label, L.label)
        if (typeof id !== 'string' || !NODE_ID.test(id) || ids.has(id) || !label) continue
        ids.add(id)
        states.push({ id, label, sub: txt(n.sub, L.sub), icon: oneOf(EX_ICONS, n.icon), terminal: n.terminal === true })
      }
      if (!states.length) return null
      const seen = new Set<string>()
      const transitions: SmTransition[] = []
      for (const e of list(s.transitions, L.transitions)) {
        if (!isObj(e)) continue
        const { from, to } = e
        if (typeof from !== 'string' || typeof to !== 'string' || !ids.has(from) || !ids.has(to) || seen.has(from + '>' + to)) continue
        seen.add(from + '>' + to)
        transitions.push({ from, to, label: txt(e.label, L.edgeLabel), style: e.style === 'dashed' ? 'dashed' : 'solid' })
      }
      const initial = typeof s.initial === 'string' && ids.has(s.initial) ? s.initial : states[0].id
      return { type, ...head, initial, states, transitions }
    }

    if (type === 'network') {
      const ids = new Set<string>()
      const groups = new Set<string>()
      const nodes: NetNode[] = []
      for (const n of list(s.nodes, L.netNodes)) {
        if (!isObj(n)) continue
        const id = n.id
        const label = txt(n.label, L.label)
        if (typeof id !== 'string' || !NODE_ID.test(id) || ids.has(id) || !label) continue
        ids.add(id)
        // groups are colour slots: the 9th distinct group and later are drawn ungrouped
        let group = txt(n.group, L.group)
        if (group && !groups.has(group)) {
          if (groups.size < L.groups) groups.add(group)
          else group = ''
        }
        nodes.push({ id, label, group, icon: oneOf(EX_ICONS, n.icon), size: oneOf(EX_SIZES, n.size) || 'md' })
      }
      if (!nodes.length) return null
      const pairs = new Set<string>()
      const edges: NetEdge[] = []
      for (const e of list(s.edges, L.netEdges)) {
        if (!isObj(e)) continue
        const { from, to } = e
        if (typeof from !== 'string' || typeof to !== 'string' || from === to || !ids.has(from) || !ids.has(to)) continue
        const key = from < to ? from + '>' + to : to + '>' + from
        if (pairs.has(key)) continue
        pairs.add(key)
        const w = e.weight
        edges.push({
          from, to, label: txt(e.label, L.edgeLabel), both: e.bidirectional === true || e.both === true,
          weight: typeof w === 'number' && Number.isFinite(w) ? Math.max(1, Math.min(5, w)) : 1,
        })
      }
      return { type, ...head, nodes, edges }
    }

    if (type === 'cards') {
      const cards = list(s.cards, L.cards).filter(isObj).map((c) => ({
        title: txt(c.title, L.cardTitle), text: txt(c.text, L.cardText), icon: oneOf(EX_ICONS, c.icon), more: bullets(c.more),
      })).filter((c) => c.title)
      return cards.length ? { type, ...head, cards } : null
    }

    if (type === 'timeline') {
      const items = list(s.items, L.items).filter(isObj).map((t) => ({
        date: txt(t.date, L.date), title: txt(t.title, L.itemTitle), done: t.done === true,
      })).filter((t) => t.title)
      return items.length ? { type, ...head, items } : null
    }

    // compare
    const columns = list(s.columns, L.columns).map((c) => txt(c, L.column))
    const rows = list(s.rows, L.rows).filter(isObj).map((r) => ({
      name: txt(r.name, L.rowName), pick: r.pick === true, cells: list(r.cells, columns.length).map(cellOf),
    })).filter((r) => r.name)
    if (!columns.length || !rows.length) return null
    return { type, ...head, columns, meter_note: txt(s.meter_note, L.meterNote), rows }
  } catch {
    return null
  }
}

/** The rich-block counter a BlockCtx carries (`{ rich: { n } }`). */
export type RichCounter = Pick<BlockCtx, 'rich'>

/**
 * Count one rich block against the doc/answer budget. true → draw it; false → show it as code (the 5th and later).
 * Call it once per block, after a successful parse, outside React render (StrictMode renders twice).
 */
export function claimRich(ctx: RichCounter | null | undefined): boolean {
  const r = ctx && ctx.rich
  if (!r || typeof r !== 'object') return true
  r.n = (typeof r.n === 'number' && Number.isFinite(r.n) ? r.n : 0) + 1
  return r.n <= EX_MAX_RICH
}

/** The text a block shows when it can't be drawn (bad JSON, over budget, a renderer threw). Never throws. */
export function codeFallback(raw: unknown): string {
  try {
    return clip(typeof raw === 'string' ? raw : JSON.stringify(raw) ?? '', L.fallback)
  } catch {
    return ''
  }
}

// ---- map geometry (pure; MapView.tsx draws it) ----

/** Grid cell size, node box size and padding of the map SVG (viewBox units). */
export const MAP_GRID = { cw: 236, rh: 104, nw: 178, nh: 54, padX: 18, padY: 16 } as const
/** Status dots are shown only for these (legend + node corner); done/now draw no dot. */
export const MAP_DOT: Partial<Record<ExStatus, 'warn' | 'bad' | 'muted' | 'acc'>> = { wait: 'warn', blocked: 'bad', later: 'muted', next: 'acc' }

export type Box = { x: number; y: number; w: number; h: number }
export type EdgeGeom = { d: string; mx: number; my: number; anchor: 'start' | 'middle' }
export type MapLayout = {
  width: number
  height: number
  nodes: { node: MapNode; box: Box; dot: 'warn' | 'bad' | 'muted' | 'acc' | null; links: number }[]
  edges: { edge: MapEdge; k: number; geom: EdgeGeom }[]
  /** "sends to" is always shown; the rest only when used. */
  legend: { both: boolean; dashed: boolean; statuses: ExStatus[] }
  /** Phone twin: one tappable row per node with where it sends things. */
  rows: { id: string; label: string; sub: string; to: string[] }[]
  /** Desktop "Show as a list" twin: "A → B: label". */
  lines: string[]
  /** Spoken summary for the SVG (role=img). */
  aria: string
}

export const nodeBox = (n: { col: number; row: number }): Box => ({
  x: MAP_GRID.padX + n.col * MAP_GRID.cw, y: MAP_GRID.padY + n.row * MAP_GRID.rh, w: MAP_GRID.nw, h: MAP_GRID.nh,
})

/** Auto-routed edge between two node boxes: straight when aligned, else a smooth S through the row gap. */
export function edgeGeom(a: { col: number; row: number }, b: { col: number; row: number }): EdgeGeom {
  const A = nodeBox(a)
  const B = nodeBox(b)
  const ax = A.x + A.w / 2
  const ay = A.y + A.h / 2
  const bx = B.x + B.w / 2
  const by = B.y + B.h / 2
  const dx = bx - ax
  const dy = by - ay
  if (Math.abs(dy) < 1) {
    const sx = dx > 0 ? A.x + A.w : A.x
    const tx = dx > 0 ? B.x - 4 : B.x + B.w + 4
    return { d: `M${sx} ${ay}H${tx}`, mx: (sx + tx) / 2, my: ay - 7, anchor: 'middle' }
  }
  if (Math.abs(dx) < 1) {
    const sy = dy > 0 ? A.y + A.h : A.y
    const ty = dy > 0 ? B.y - 4 : B.y + B.h + 4
    return { d: `M${ax} ${sy}V${ty}`, mx: ax + 8, my: (sy + ty) / 2 + 4, anchor: 'start' }
  }
  const sx = dx > 0 ? A.x + A.w - 26 : A.x + 26
  const sy = dy > 0 ? A.y + A.h : A.y
  const tx = dx > 0 ? B.x + 26 : B.x + B.w - 26
  const ty = dy > 0 ? B.y - 4 : B.y + B.h + 4
  const gy = dy > 0 ? sy + (MAP_GRID.rh - MAP_GRID.nh) / 2 : sy - (MAP_GRID.rh - MAP_GRID.nh) / 2
  return { d: `M${sx} ${sy}C${sx} ${gy} ${tx} ${gy} ${tx} ${ty}`, mx: (sx + tx) / 2, my: gy - 4, anchor: 'middle' }
}

/** Everything MapView needs, from a parsed map spec. Total: edges to unknown nodes are skipped. */
export function mapLayout(spec: Pick<MapSpec, 'title' | 'nodes' | 'edges'>): MapLayout {
  const nodes = Array.isArray(spec && spec.nodes) ? spec.nodes : []
  const allEdges = Array.isArray(spec && spec.edges) ? spec.edges : []
  const byId = new Map(nodes.map((n) => [n.id, n] as const))
  const edges = allEdges.filter((e) => byId.has(e.from) && byId.has(e.to))
  const cols = nodes.reduce((m, n) => Math.max(m, n.col), 0) + 1
  const rows = nodes.reduce((m, n) => Math.max(m, n.row), 0) + 1
  const statuses: ExStatus[] = []
  for (const n of nodes) if (n.status && MAP_DOT[n.status] && !statuses.includes(n.status)) statuses.push(n.status)
  return {
    width: MAP_GRID.padX * 2 + (cols - 1) * MAP_GRID.cw + MAP_GRID.nw,
    height: MAP_GRID.padY * 2 + (rows - 1) * MAP_GRID.rh + MAP_GRID.nh,
    nodes: nodes.map((n) => ({
      node: n,
      box: nodeBox(n),
      dot: (n.status && MAP_DOT[n.status]) || null,
      links: edges.filter((e) => e.from === n.id || e.to === n.id).length,
    })),
    edges: edges.map((e, k) => ({ edge: e, k, geom: edgeGeom(byId.get(e.from)!, byId.get(e.to)!) })),
    legend: { both: edges.some((e) => e.both), dashed: edges.some((e) => e.style === 'dashed'), statuses },
    rows: nodes.map((n) => ({
      id: n.id,
      label: n.label,
      sub: n.sub,
      to: edges.filter((e) => e.from === n.id || (e.both && e.to === n.id)).map((e) => byId.get(e.from === n.id ? e.to : e.from)!.label),
    })),
    lines: edges.map((e) => `${byId.get(e.from)!.label} → ${byId.get(e.to)!.label}${e.label ? ': ' + e.label : ''}`),
    aria: `${(spec && spec.title) || 'Map'}: ${nodes.map((n) => n.label).join(', ')}`,
  }
}
