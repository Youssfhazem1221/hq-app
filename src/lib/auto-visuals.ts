// Auto visuals (spec §5.3, zero writing): a doc's `options:` → a compare spec + emphasis-scatter points, and a
// project.md → the journey strip model (which also gives the beads their spoken label). Pure and total: junk YAML,
// nulls and wrong types give a safe, empty-ish result and never throw. No React; components/visuals/* draw these.
import { clip, parseExplainer, txt, type CompareSpec, type EvidencePart, type ExTone } from '../components/explainers/parse'
import type { NextItem } from './contracts'

type Rec = Record<string, unknown>
/** What these functions read from a parsed .md file (lib/md.ts Doc fits). */
export type DocLike = { path?: unknown; data?: unknown }

const isObj = (x: unknown): x is Rec => !!x && typeof x === 'object' && !Array.isArray(x)
const dataOf = (d: DocLike | null | undefined): Rec => (d && isObj(d.data) ? d.data : {})
const KEY_RE = /^[a-z][a-z0-9_]{0,30}$/i
const humanize = (k: string) => {
  const s = k.replace(/_/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const numOf = (v: unknown): number | null =>
  typeof v === 'number' ? (Number.isFinite(v) ? v : null) : typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : null

// ---- options → speed, evidence, scatter points, compare ----

/** Ordinal speed to first money: 4 = weeks, 3 = 1–2 months, 2 = a named month/date, 1 = months or more. */
export type Speed = 1 | 2 | 3 | 4
/** How sure we are: 3 = verified (✅ only), 2 = mixed (✅ + ⚠️, or any other mix), 1 = untested (💭 only). */
export type Evidence = 1 | 2 | 3
export const SPEED_LABEL: Record<Speed, string> = { 1: 'months', 2: 'a set date', 3: '1–2 months', 4: 'weeks' }
export const EVIDENCE_LABEL: Record<Evidence, string> = { 1: 'untested', 2: 'mixed', 3: 'verified' }
/** The word an evidence chip shows next to its icon when the note has no text of its own. */
export const TONE_WORD: Record<ExTone, string> = { ok: 'verified', warn: 'risk', idea: 'not researched' }
/** Compare rows (and therefore scatter points) per doc. */
export const MAX_OPTIONS = 8

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** A capitalised month name or abbreviation as a whole word ("Jan–Feb 2027", "by March"; not "Market", "Decide"). */
const MONTH_NAME = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\b/

/** Parse a `first_money` phrase into a Speed, or null when it says nothing about time. */
export function speedFromText(v: unknown): Speed | null {
  const raw = typeof v === 'string' ? v.slice(0, 200) : ''
  const s = raw.toLowerCase()
  if (!s.trim()) return null
  if (/\b(?:days?|weeks?|wks?)\b/.test(s)) return 4
  if (/\b(?:a|one|two|1|2)(?:\s*(?:[-–—]|to)\s*(?:two|2))?\s*(?:months?|mos?)\b/.test(s)) return 3
  if (MONTH_NAME.test(raw) || /\b(?:19|20)\d\d\b|\bQ[1-4]\b/.test(raw)) return 2
  if (/\b(?:months?|mos?|years?|yrs?)\b/.test(s)) return 1
  return null
}

/** An option's speed: explicit `speed: 1–4` wins; else parsed from `first_money` and flagged estimated. */
export function speedOf(option: unknown): { speed: Speed; estimated: boolean } | null {
  if (!isObj(option)) return null
  const n = numOf(option.speed)
  if (n !== null && Number.isInteger(n) && n >= 1 && n <= 4) return { speed: n as Speed, estimated: false }
  const parsed = speedFromText(option.first_money)
  return parsed ? { speed: parsed, estimated: true } : null
}

const EV_SPLIT = /(\u{2705}|\u{26a0}\u{fe0f}?|\u{1f4ad})/u
const EV_TRIM = /^[\s\u{b7}\u{2022}|;,+\-\u{2013}\u{2014}\u{fe0f}]+|[\s\u{b7}\u{2022}|;,+\-\u{2013}\u{2014}]+$/gu
const toneOfEmoji = (m: string): ExTone => (m === '\u{2705}' ? 'ok' : m.charAt(0) === '\u{26a0}' ? 'warn' : 'idea')

/** "✅ own case study · ⚠️ supply" (or a list of such notes) → [{text, tone}]. Text without an emoji has tone null. */
export function evidenceParts(v: unknown): EvidencePart[] {
  const items = Array.isArray(v) ? v.slice(0, 6) : [v]
  const out: EvidencePart[] = []
  for (const it of items) {
    const s = typeof it === 'string' ? it.slice(0, 400) : typeof it === 'number' && Number.isFinite(it) ? String(it) : ''
    if (!s) continue
    const bits = s.split(EV_SPLIT)
    const lead = txt(bits[0].replace(EV_TRIM, ''), 40)
    if (lead) out.push({ text: lead, tone: null })
    for (let i = 1; i < bits.length; i += 2) {
      const tone = toneOfEmoji(bits[i])
      out.push({ text: txt((bits[i + 1] || '').replace(EV_TRIM, ''), 40) || TONE_WORD[tone], tone })
    }
  }
  return out.slice(0, 6)
}

/** ✅ only = verified · 💭 only = untested · any other mix of marks = mixed · no marks at all = unknown (null). */
export function evidenceLevel(parts: EvidencePart[]): Evidence | null {
  const tones = (Array.isArray(parts) ? parts : []).map((p) => p && p.tone).filter((t): t is ExTone => !!t)
  if (!tones.length) return null
  if (tones.every((t) => t === 'ok')) return 3
  if (tones.every((t) => t === 'idea')) return 1
  return 2
}

type Option = {
  rank: number; raw: Rec; name: string; short: string; pick: boolean; paidIn: string; firstMoney: string
  speed: { speed: Speed; estimated: boolean } | null; parts: EvidencePart[]; evidence: Evidence | null
}
const STOP = new Set(['for', 'in', 'to', 'of', 'with', 'at', 'on', 'by', 'from', 'and', 'or'])

/** A short label for a scatter dot: `short:` if given, else the name's first words up to a preposition (≤22 chars). */
function shortName(raw: Rec, name: string) {
  const own = txt(raw.short, 24)
  if (own) return own
  const words = name.split(' ')
  let out = ''
  for (const w of words) {
    if (out && STOP.has(w.toLowerCase())) break
    const next = out ? out + ' ' + w : w
    if (out && (next.length > 22 || next.split(' ').length > 3)) break
    out = next
  }
  return clip(out, 24)
}

/** The doc's options, normalised once so the compare rows and the scatter ranks always agree (≤8; a bare string = a name). */
function optionsOf(v: unknown): Option[] {
  const list = Array.isArray(v) ? v.slice(0, MAX_OPTIONS) : []
  return list
    .map((o) => (typeof o === 'string' ? { name: o } : o))
    .filter(isObj)
    .map((raw, i) => {
      const rank = i + 1
      const name = txt(raw.name ?? raw.title, 60) || `Option ${rank}`
      const parts = evidenceParts(raw.evidence)
      return {
        rank, raw, name, short: shortName(raw, name), pick: raw.recommended === true || raw.pick === true,
        paidIn: txt(raw.paid_in, 60), firstMoney: txt(raw.first_money, 60), speed: speedOf(raw), parts, evidence: evidenceLevel(parts),
      }
    })
}

export type ScatterPoint = {
  /** 1-based position in the doc's options (the number on the dot and in the compare table). */
  rank: number
  name: string
  short: string
  /** recommended: true (or pick: true) in the doc. */
  pick: boolean
  speed: Speed
  /** true when speed was parsed from first_money instead of an explicit `speed:`. */
  estimated: boolean
  evidence: Evidence
  paidIn: string
  firstMoney: string
  /** Spoken label for the dot's hit target. */
  label: string
}

/** Options that can be placed (speed and evidence both known), in doc order. Total. */
export function scatterPoints(options: unknown): ScatterPoint[] {
  try {
    return optionsOf(options).flatMap((o) => {
      if (!o.speed || !o.evidence) return []
      const { speed, estimated } = o.speed
      const evidence = o.evidence
      const label = `#${o.rank} ${o.name}: first money ${o.firstMoney || SPEED_LABEL[speed]}${estimated ? ' (estimated)' : ''}, evidence ${EVIDENCE_LABEL[evidence]}${o.pick ? ', recommended' : ''}`
      return [{ rank: o.rank, name: o.name, short: o.short, pick: o.pick, speed, estimated, evidence, paidIn: o.paidIn, firstMoney: o.firstMoney, label }]
    })
  } catch {
    return []
  }
}

const KNOWN_COLUMNS: Record<string, string> = { paid_in: 'Paid in', first_money: 'First money', evidence: 'Evidence' }
const NOT_COLUMNS = new Set(['name', 'title', 'short', 'recommended', 'pick', 'speed', 'id', 'paid_in', 'first_money', 'evidence'])
const scalar = (v: unknown) => typeof v === 'string' ? v.trim() !== '' : typeof v === 'number' && Number.isFinite(v)

/**
 * A doc with `options:` → the auto compare block (rank · option · paid in · first money with a speed meter · any
 * other scalar fields · evidence chips), already run through the total parser so every cap holds. null when the doc
 * has no usable options.
 */
export function optionsSpec(doc: DocLike | null | undefined): CompareSpec | null {
  try {
    const data = dataOf(doc)
    const opts = optionsOf(data.options)
    if (!opts.length) return null
    const has = (k: string) => opts.some((o) => scalar(o.raw[k]) || (k === 'evidence' && o.parts.length > 0))
    const extra: string[] = []
    for (const o of opts) {
      for (const k of Object.keys(o.raw)) if (KEY_RE.test(k) && !NOT_COLUMNS.has(k) && !extra.includes(k) && scalar(o.raw[k])) extra.push(k)
    }
    const front = [...['paid_in', 'first_money'].filter(has), ...extra]
    const keys = has('evidence') ? [...front.slice(0, 4), 'evidence'] : front.slice(0, 5)
    if (!keys.length) return null // bare names: nothing to compare
    const metered = keys.includes('first_money') && opts.some((o) => o.speed)
    const path = typeof doc?.path === 'string' ? doc.path : ''
    const spec = parseExplainer({
      type: 'compare',
      title: `${opts.length} ${opts.length === 1 ? 'option' : 'options'}, side by side`,
      source: path,
      next: data.next,
      meter_note: metered ? 'longer bar = money sooner' : '',
      columns: keys.map((k) => KNOWN_COLUMNS[k] || humanize(k)),
      rows: opts.map((o) => ({
        name: o.name,
        pick: o.pick,
        cells: keys.map((k) => {
          if (k === 'evidence') return o.parts.length ? { parts: o.parts } : { text: '' }
          if (k === 'first_money') return { text: o.firstMoney, meter: o.speed ? o.speed.speed / 4 : null }
          const v = o.raw[k]
          return { text: scalar(v) ? v : '' }
        }),
      })),
    }, { exists: (p) => !!path && p === path })
    return spec && spec.type === 'compare' ? spec : null
  } catch {
    return null
  }
}

// ---- project.md → journey strip ----

/** Project colour slot: `color: 1..8` (integer) → that slot; anything else → 1 (spec D4). Use as var(--viz-N). */
export function colorSlot(v: unknown): number {
  const n = numOf(v)
  return n !== null && Number.isInteger(n) && n >= 1 && n <= 8 ? n : 1
}

/** A YAML date (string or Date) → 'YYYY-MM-DD', or null. */
export function isoDate(v: unknown): string | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString().slice(0, 10) : null
  const m = typeof v === 'string' ? v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/) : null
  if (!m) return null
  const mon = +m[2]
  const day = +m[3]
  return mon >= 1 && mon <= 12 && day >= 1 && day <= 31 ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/** 'YYYY-MM-DD' → '14 Oct' (no time zone involved), or null. */
export function dateLabel(v: unknown): string | null {
  const iso = isoDate(v)
  return iso ? `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}` : null
}

const isDone = (v: unknown) => v === true || (typeof v === 'string' && /^(?:true|yes|y|x|done)$/i.test(v.trim()))

export type JourneyKind = 'done' | 'now' | 'later'
export type BeadState = 'done' | 'next' | 'later'
export type JourneyNode = {
  /** Position in the strip (done → NOW → later). */
  k: number
  /** Index in the file's `milestones:` list (what a writer edits). */
  index: number
  kind: JourneyKind
  text: string
  date: string | null
  dateLabel: string | null
  /** Left edge position on the track, in % (4–96; 50 for a single node). */
  pos: number
  /** Tooltip head: "Done · 14 Oct" / "Now" / "Later". */
  tip: string
  /** Spoken label: tip + ": " + text. */
  label: string
}
export type JourneyMilestone = { index: number; text: string; date: string | null; dateLabel: string | null; state: BeadState }
export type JourneyMetric = { key: string; value: number; label: string; goal: number | null }
export type JourneyModel<N> = {
  slug: string
  title: string
  /** Validated colour slot 1–8. */
  color: number
  total: number
  done: number
  nodes: JourneyNode[]
  /** Strip index of the NOW node; -1 when every milestone is done. */
  nowK: number
  /** The one node with tabIndex 0 (roving focus): NOW, else the last node; -1 when there are none. */
  focusK: number
  /** % of the track filled (up to NOW; 100 when all done; 0 when there are no milestones). */
  fill: number
  /** % where the "N done" label sits (middle of the done run), or null when nothing is done. */
  doneAt: number | null
  /** % for the NOW card's caret, clamped to 8–92. */
  nowX: number
  /** The NOW card's item (it carries the one button), exactly as passed in. */
  next: N | null
  goal: string
  /** All milestones done and nothing next: the card says "Goal reached". */
  goalReached: boolean
  started: string | null
  startedLabel: string | null
  /** File order, for the "All N milestones" toggle. */
  milestones: JourneyMilestone[]
  /** File order, for Beads (one role=img). */
  beads: BeadState[]
  /** "8 of 10 milestones done, next: …" (Beads aria-label). */
  beadsLabel: string
  /** "8 of 10 milestones done. Use arrow keys to read them." (track group label). */
  trackLabel: string
  /** The Numbers chip: the newest snapshot's metric (one with a goal_<key> first). */
  metric: JourneyMetric | null
  owner: string | null
  members: string[]
}

function milestonesOf(data: Rec): { index: number; text: string; date: string | null; done: boolean }[] {
  const raw = Array.isArray(data.milestones) ? data.milestones : []
  const out: { index: number; text: string; date: string | null; done: boolean }[] = []
  raw.forEach((m, index) => {
    const o: Rec = isObj(m) ? m : { text: m }
    const text = txt(o.text, 300)
    if (text) out.push({ index, text, date: isoDate(o.date), done: isDone(o.done) })
  })
  return out
}

function metricOf(data: Rec): JourneyMetric | null {
  const rows = (Array.isArray(data.metrics) ? data.metrics : []).filter(isObj)
  if (!rows.length) return null
  let best = rows[0]
  for (const r of rows) if (String(r.date ?? '') >= String(best.date ?? '')) best = r
  const keys = Object.keys(best).filter((k) => k !== 'date' && k !== 'source' && KEY_RE.test(k) && numOf(best[k]) !== null)
  if (!keys.length) return null
  const key = keys.find((k) => numOf(data['goal_' + k]) !== null) || keys[0]
  const labels = isObj(data.metric_labels) ? data.metric_labels : {}
  return { key, value: numOf(best[key])!, label: txt(labels[key], 40) || humanize(key), goal: numOf(data['goal_' + key]) }
}

function peopleOf(data: Rec) {
  const owner = txt(data.owner, 60) || null
  const seen = new Set(owner ? [owner.toLowerCase()] : [])
  const members: string[] = []
  for (const m of Array.isArray(data.members) ? data.members : []) {
    const login = txt(m, 60)
    if (!login || seen.has(login.toLowerCase())) continue
    seen.add(login.toLowerCase())
    members.push(login)
    if (members.length >= 12) break
  }
  return { owner, members }
}

const r2 = (n: number) => Math.round(n * 100) / 100
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/**
 * A project.md (+ its Next item from next-core) → the journey strip: done milestones (file order) → NOW (the first
 * open milestone) → later ones, the fill, the "N done" label spot, the NOW card item, goal, chips, beads. Total.
 */
export function journeyModel<N = NextItem>(project: DocLike | null | undefined, next?: N | null): JourneyModel<N> {
  const item = next ?? null
  try {
    const data = dataOf(project)
    const path = typeof project?.path === 'string' ? project.path : ''
    const slug = (path.match(/^projects\/([^/]+)\/project\.md$/i) || path.match(/^projects\/([^/]+)\.md$/i) || [])[1] || ''
    const ms = milestonesOf(data)
    const nx = ms.findIndex((m) => !m.done)
    const done = ms.filter((m) => m.done)
    const seq = [...done, ...(nx >= 0 ? [ms[nx]] : []), ...ms.filter((m, i) => !m.done && i !== nx)]
    const n = seq.length
    const pos = (k: number) => r2(n > 1 ? 4 + (92 * k) / (n - 1) : 50)
    const nowK = nx >= 0 ? done.length : -1
    const nodes: JourneyNode[] = seq.map((m, k) => {
      const kind: JourneyKind = m.done ? 'done' : k === nowK ? 'now' : 'later'
      const dl = dateLabel(m.date)
      const tip = (kind === 'done' ? 'Done' : kind === 'now' ? 'Now' : 'Later') + (dl ? ' · ' + dl : '')
      return { k, index: m.index, kind, text: m.text, date: m.date, dateLabel: dl, pos: pos(k), tip, label: tip + ': ' + m.text }
    })
    const states: BeadState[] = ms.map((m, i) => (m.done ? 'done' : i === nx ? 'next' : 'later'))
    const total = ms.length
    const word = plural(total, 'milestone', 'milestones')
    const started = isoDate(data.started)
    const { owner, members } = peopleOf(data)
    return {
      slug,
      title: txt(data.title, 80) || slug,
      color: colorSlot(data.color),
      total,
      done: done.length,
      nodes,
      nowK,
      focusK: n ? (nowK >= 0 ? nowK : n - 1) : -1,
      fill: n ? (nowK >= 0 ? pos(nowK) : 100) : 0,
      doneAt: done.length ? pos((done.length - 1) / 2) : null,
      nowX: Math.max(8, Math.min(92, pos(nowK >= 0 ? nowK : n - 1))),
      next: item,
      goal: txt(data.goal, 200),
      goalReached: total > 0 && nowK < 0 && item === null,
      started,
      startedLabel: dateLabel(started),
      milestones: ms.map((m, i) => ({ index: m.index, text: m.text, date: m.date, dateLabel: dateLabel(m.date), state: states[i] })),
      beads: states,
      beadsLabel: `${done.length} of ${total} ${word} done${nx >= 0 ? ', next: ' + ms[nx].text : ''}`,
      trackLabel: `${done.length} of ${total} ${word} done. Use arrow keys to read them.`,
      metric: metricOf(data),
      owner,
      members,
    }
  } catch {
    return {
      slug: '', title: '', color: 1, total: 0, done: 0, nodes: [], nowK: -1, focusK: -1, fill: 0, doneAt: null, nowX: 50,
      next: item, goal: '', goalReached: false, started: null, startedLabel: null, milestones: [], beads: [],
      beadsLabel: '0 of 0 milestones done', trackLabel: '0 of 0 milestones done. Use arrow keys to read them.',
      metric: null, owner: null, members: [],
    }
  }
}
