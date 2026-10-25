// What a data file looks like, worked out from the data itself (no schema needed). JSON → sections: a note, settings,
// chips, numbers, records (shown as a gallery, cards or a table, with a chart over time or by group) or a tree. TSV/CSV
// → typed records. Pure and total: any input gives a view and nothing here throws. Only text and numbers come out;
// the UI renders them as text, never as HTML.

export type ColType = 'number' | 'date' | 'bool' | 'url' | 'image' | 'yt' | 'text' | 'json' | 'empty'
export type Col = { key: string; label: string; type: ColType; filled: number; distinct: number }
export type Row = Record<string, unknown>
export type Records = {
  cols: Col[]
  rows: Row[]
  /** the column that names a row (cards, chart labels) */
  title?: string
  /** a longer line under the title (cards) */
  sub?: string
  /** a column of image paths (gallery) */
  image?: string
  /** a column of dates (chart over time) */
  time?: string
  /** the main numeric column (charts, totals) */
  num?: string
  /** a column with 2–12 values to group by (chart by group); `firstWord`: group by its first word */
  group?: { key: string; firstWord: boolean }
  /** `num` is named like an amount (usd, views, seconds…), so summing it means something; else charts count rows */
  measure?: boolean
}
export type Section =
  | { kind: 'note'; key: string; label: string; text: string }
  | { kind: 'props'; key: string; label: string; items: { key: string; label: string; value: string }[] }
  | { kind: 'chips'; key: string; label: string; items: string[] }
  | { kind: 'numbers'; key: string; label: string; values: number[] }
  | { kind: 'records'; key: string; label: string; recs: Records; keyed: boolean }
  | { kind: 'tree'; key: string; label: string; value: unknown }

export const MAX_SECTIONS = 24
const MAX_COLS = 40
const MAX_ROWS = 20_000
const ABOUT = /^(_|_about|about|_comment|comment|description|desc|readme|note|notes|info|summary|purpose)$/i
const TITLE_KEYS = ['title', 'name', 'label', 'heading', 'what', 'id', 'key', 'slug', 'take', 'sheet']
const SUB_KEYS = ['line', 'summary', 'description', 'desc', 'subtitle', 'text', 'mood', 'note', 'about', 'prompt', 'use', 'style']
const NUM_KEYS = ['usd', 'cost', 'amount', 'total', 'price', 'value', 'views', 'count', 'score', 'size', 'seconds', 'duration', 'bpm']

export const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isScalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v)
const EMPTY = /^(|na|n\/a|null|none|-|—|undefined)$/i

const ACRONYM: Record<string, string> = { id: 'ID', url: 'URL', usd: 'USD', egp: 'EGP', eur: 'EUR', bpm: 'BPM', api: 'API', ai: 'AI', ui: 'UI', tts: 'TTS', cta: 'CTA', kpi: 'KPI', seo: 'SEO' }

/** "metric_labels" → "Metric labels", "firstBeat" → "First beat", "usd" → "USD". Codes ("V4_t1") stay as they are. */
export function humanize(key: string) {
  const k = String(key ?? '')
  if (Object.prototype.hasOwnProperty.call(ACRONYM, k.toLowerCase())) return ACRONYM[k.toLowerCase()]
  if (!k || /^[A-Z0-9]{1,3}(_[a-z0-9]+)?$/.test(k) || /\d/.test(k)) return k
  const s = k.replace(/^_+/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase()
  return s ? s[0].toUpperCase() + s.slice(1) : k
}

/** A number from a cell: 1,234 · $3.50 · 12% · -4e3; null when it is not one. */
export function numOf(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.trim().replace(/^[$€£]|[$€£%]$/g, '').replace(/,(?=\d{3}\b)/g, '')
  return /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s) ? Number(s) : null
}

const DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/
const IMG = /\.(png|jpe?g|webp|gif|avif|svg)$/i
const YT = /^[A-Za-z0-9_-]{11}$/

/** One cell as text: bilingual {en, ar} → "en text", small objects → "k: v · k: v", lists → "a, b". */
export function textOf(v: unknown, max = 400): string {
  let s: string
  if (v === null || v === undefined) s = ''
  else if (typeof v === 'boolean') s = v ? 'Yes' : 'No'
  else if (typeof v === 'string') s = v
  else if (typeof v === 'number') s = Number.isFinite(v) ? v.toLocaleString('en', { maximumFractionDigits: 4 }) : ''
  else if (Array.isArray(v)) s = v.every(isScalar) ? v.map((x) => textOf(x, 80)).join(', ') : `${v.length} items`
  else if (isPlain(v)) {
    const en = v.en ?? v.EN ?? v.english
    if (typeof en === 'string') s = en
    else {
      const e = Object.entries(v)
      s = e.length <= 6 && e.every(([, x]) => isScalar(x)) ? e.map(([k, x]) => `${k}: ${textOf(x, 60)}`).join(' · ') : `${e.length} fields`
    }
  } else s = String(v)
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function typeOf(values: unknown[]): { type: ColType; filled: number; distinct: number } {
  const vals = values.filter((v) => v !== undefined && v !== null && !(typeof v === 'string' && EMPTY.test(v.trim())))
  const filled = vals.length
  const distinct = new Set(vals.map((v) => (isScalar(v) ? String(v) : JSON.stringify(v)))).size
  if (!filled) return { type: 'empty', filled, distinct }
  const share = (f: (v: unknown) => boolean) => vals.filter(f).length / filled
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  let type: ColType = 'text'
  if (share((v) => typeof v === 'boolean' || /^(true|false)$/i.test(str(v))) >= 0.9) type = 'bool'
  else if (share((v) => numOf(v) !== null) >= 0.9) type = 'number'
  else if (share((v) => DATE.test(str(v))) >= 0.9) type = 'date'
  else if (share((v) => /^https?:\/\/\S+$/i.test(str(v)) && !IMG.test(str(v).split('?')[0])) >= 0.9) type = 'url'
  else if (share((v) => IMG.test(str(v).split('?')[0]) && !/\s/.test(str(v))) >= 0.9) type = 'image'
  else if (filled >= 3 && share((v) => YT.test(str(v)) && /[A-Z0-9_-]/.test(str(v)) && /[a-z]/i.test(str(v))) >= 0.9) type = 'yt'
  else if (share((v) => !isScalar(v)) >= 0.5) type = 'json'
  return { type, filled, distinct }
}

/** Rows (objects) → typed columns, plus the columns that name, describe, picture, date, measure and group them. One
 *  level of small nested objects becomes columns ("title.en"); `keyCol` puts the map key first (keyed records). */
export function recordsOf(input: unknown[], keyCol?: { key: string; label: string }): Records {
  const rows: Row[] = []
  for (const r of input.slice(0, MAX_ROWS)) rows.push(isPlain(r) ? r : { value: r })
  // flatten one level: a key whose values are small objects of scalars (≤6 keys) in ≥80% of the rows that have it
  const order: string[] = []
  const seen = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) (seen.add(k), order.push(k))
  const flat = new Set<string>()
  for (const k of order) {
    const vs = rows.map((r) => r[k]).filter((v) => v !== undefined && v !== null)
    if (vs.length && vs.filter((v) => isPlain(v) && Object.keys(v).length <= 6 && Object.values(v).every(isScalar)).length / vs.length >= 0.8) flat.add(k)
  }
  const keys: string[] = []
  const labels = new Map<string, string>()
  if (keyCol) (keys.push(keyCol.key), labels.set(keyCol.key, keyCol.label))
  for (const k of order) {
    if (keyCol && k === keyCol.key) continue
    if (!flat.has(k)) {
      keys.push(k)
      labels.set(k, humanize(k))
      continue
    }
    const subs: string[] = []
    for (const r of rows) if (isPlain(r[k])) for (const s of Object.keys(r[k] as object)) if (!subs.includes(s)) subs.push(s)
    for (const s of subs) (keys.push(`${k}.${s}`), labels.set(`${k}.${s}`, `${humanize(k)} (${s})`))
  }
  const cut = keys.slice(0, MAX_COLS)
  const flatRows = rows.map((r) => {
    if (!flat.size) return r
    const o: Row = {}
    for (const [k, v] of Object.entries(r)) {
      if (flat.has(k) && isPlain(v)) for (const [s, x] of Object.entries(v)) o[`${k}.${s}`] = x
      else o[k] = v
    }
    return o
  })
  const cols: Col[] = cut.map((key) => ({ key, label: labels.get(key) || key, ...typeOf(flatRows.map((r) => r[key])) }))
  return { cols, rows: flatRows, ...roles(cols, flatRows.length, flatRows, keyCol?.key) }
}

function roles(cols: Col[], n: number, rows: Row[], keyCol?: string): Omit<Records, 'cols' | 'rows'> {
  const leaf = (k: string) => k.split('.')[0].toLowerCase()
  const byName = (names: string[], ok: (c: Col) => boolean) => {
    for (const nm of names) {
      const c = cols.find((x) => (leaf(x.key) === nm || x.key.toLowerCase() === nm) && ok(x) && !x.key.endsWith('.ar'))
      if (c) return c.key
    }
    return undefined
  }
  const texty = (c: Col) => c.type === 'text' || c.type === 'yt'
  // a map's own key names its rows ("V4_t1"), unless the rows carry a real name; a field called `key` is data there
  const title = keyCol
    ? byName(['title', 'name', 'label', 'heading'], texty) || keyCol
    : byName(TITLE_KEYS, texty) || cols.find((c) => c.type === 'text' && c.filled >= n * 0.5)?.key
  const avgLen = (k: string) => rows.slice(0, 200).reduce((a, r) => a + textOf(r[k], 1000).length, 0) / Math.max(1, Math.min(rows.length, 200))
  const sub =
    byName(SUB_KEYS, (c) => c.type === 'text' && c.key !== title) ||
    cols.find((c) => c.type === 'text' && c.key !== title && !c.key.endsWith('.ar') && avgLen(c.key) > 24)?.key
  const image = cols.find((c) => c.type === 'image' && c.filled >= n * 0.5)?.key
  const time = cols.find((c) => c.type === 'date' && c.filled >= n * 0.8)?.key
  const isIdLike = (c: Col) => c.distinct === n && /(^|\.)(id|index|n|no|num|number|rank|order|year)$/i.test(c.key)
  const named = byName(NUM_KEYS, (c) => c.type === 'number')
  const num = named || cols.find((c) => c.type === 'number' && !isIdLike(c) && c.filled >= n * 0.5)?.key
  // a group has to merge rows (≤ 70% as many groups as rows), else a chart "by group" is just one bar per row
  const merges = (groups: number) => groups >= 2 && groups <= 12 && groups <= n * 0.7
  let group: Records['group']
  const g = cols.find((c) => c.type === 'text' && c.key !== title && c.key !== sub && c.key !== keyCol && merges(c.distinct) && c.filled >= n * 0.8 && n >= 4)
  if (g) group = { key: g.key, firstWord: false }
  else if (title && title !== keyCol && n >= 6) {
    const firsts = new Set(rows.map((r) => firstWord(r[title])).filter(Boolean))
    if (merges(firsts.size)) group = { key: title, firstWord: true }
  }
  return { title, sub, image, time, num, group, measure: !!named }
}

export const firstWord = (v: unknown) => textOf(v, 200).trim().split(/[\s/:·,]+/)[0] || ''

// ---- JSON → sections ------------------------------------------------------------------------------------------

/** A parsed JSON value → the sections the Visual view draws, in file order (≤ MAX_SECTIONS; the rest in one tree). */
export function jsonSections(value: unknown): Section[] {
  const out: Section[] = []
  if (Array.isArray(value)) out.push(arraySection('', 'Items', value))
  else if (isPlain(value)) objectSections(value, '', '', out, 0)
  else out.push({ kind: 'props', key: '', label: 'Value', items: [{ key: '', label: 'Value', value: textOf(value, 2000) }] })
  if (!out.length) out.push({ kind: 'props', key: '', label: 'Empty', items: [{ key: '', label: 'Empty', value: 'This file has no values yet' }] })
  if (out.length <= MAX_SECTIONS) return out
  const rest = out.slice(MAX_SECTIONS - 1)
  return [...out.slice(0, MAX_SECTIONS - 1), { kind: 'tree', key: '…', label: `${rest.length} more parts`, value: Object.fromEntries(rest.map((s) => [s.label, 'value' in s ? s.value : s.kind])) }]
}

function objectSections(obj: Record<string, unknown>, path: string, prefix: string, out: Section[], depth: number) {
  let props: { key: string; label: string; value: string }[] = []
  const flush = () => {
    if (props.length) out.push({ kind: 'props', key: path || 'details', label: prefix || 'Details', items: props })
    props = []
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = path ? `${path}.${k}` : k
    const label = prefix ? `${prefix} › ${humanize(k)}` : humanize(k)
    if (typeof v === 'string' && (ABOUT.test(k) || v.length >= 140)) {
      flush()
      out.push({ kind: 'note', key, label: ABOUT.test(k) ? prefix || 'About' : label, text: v })
    } else if (isScalar(v)) props.push({ key: k, label: humanize(k), value: textOf(v, 300) })
    else if (Array.isArray(v)) (flush(), out.push(arraySection(key, label, v)))
    else if (isPlain(v)) {
      flush()
      const keyed = keyedSection(key, label, v)
      if (keyed) out.push(keyed)
      // one level deeper, or any depth when it is only texts and numbers (prompt templates → notes + settings)
      else if (depth < 1 || Object.values(v).every(isScalar)) objectSections(v, key, label, out, depth + 1)
      else out.push({ kind: 'tree', key, label, value: v })
    }
  }
  flush()
}

/** A map whose values are objects (themes: {V: {…}, A: {…}}) or same-length number tuples (centers: {a: [x, y]}). */
function keyedSection(key: string, label: string, obj: Record<string, unknown>): Section | null {
  const entries = Object.entries(obj)
  if (entries.length < 2) return null
  const objs = entries.filter(([, v]) => isPlain(v)).length
  if (objs / entries.length >= 0.8) {
    const rows = entries.filter(([, v]) => isPlain(v)).map(([k, v]) => ({ __key: k, ...(v as object) }))
    return { kind: 'records', key, label, recs: recordsOf(rows, { key: '__key', label: 'ID' }), keyed: true }
  }
  const tuples = entries.filter(([, v]) => Array.isArray(v) && v.length >= 1 && v.length <= 4 && v.every((x) => typeof x === 'number'))
  if (tuples.length / entries.length >= 0.8) {
    const width = Math.max(...tuples.map(([, v]) => (v as number[]).length))
    const names = width === 2 ? ['x', 'y'] : width === 3 ? ['x', 'y', 'z'] : ['1', '2', '3', '4']
    const rows = tuples.map(([k, v]) => Object.fromEntries([['__key', k], ...(v as number[]).map((x, i) => [names[i], x])]))
    return { kind: 'records', key, label, recs: recordsOf(rows, { key: '__key', label: 'ID' }), keyed: true }
  }
  // all short scalars → settings; long texts (prompt templates) fall through to notes
  return entries.every(([, v]) => isScalar(v) && !(typeof v === 'string' && v.length >= 140))
    ? { kind: 'props', key, label, items: entries.map(([k, v]) => ({ key: k, label: humanize(k), value: textOf(v, 300) })) }
    : null
}

function arraySection(key: string, label: string, arr: unknown[]): Section {
  if (!arr.length) return { kind: 'props', key, label, items: [{ key: '', label: 'Empty', value: 'No items' }] }
  if (arr.every((v) => typeof v === 'number')) return { kind: 'numbers', key, label, values: (arr as number[]).slice(0, MAX_ROWS) }
  if (arr.every((v) => typeof v === 'string' && v.length <= 60) && arr.length <= 200) return { kind: 'chips', key, label, items: arr as string[] }
  if (arr.filter(isPlain).length / arr.length >= 0.8) return { kind: 'records', key, label, recs: recordsOf(arr.filter(isPlain)), keyed: false }
  const tuples = arr.filter((v) => Array.isArray(v) && v.length >= 1 && v.length <= 6 && v.every(isScalar)) as unknown[][]
  if (tuples.length / arr.length >= 0.8) {
    const width = Math.max(...tuples.map((t) => t.length))
    const rows = tuples.map((t) => Object.fromEntries(Array.from({ length: width }, (_, i) => [String(i + 1), t[i] ?? null])))
    return { kind: 'records', key, label, recs: recordsOf(rows), keyed: false }
  }
  if (arr.every(isScalar)) return { kind: 'records', key, label, recs: recordsOf(arr.map((v) => ({ value: v }))), keyed: false }
  return { kind: 'tree', key, label, value: arr }
}

/** The Table view of a JSON file: its biggest records section, else every leaf as a Path · Value row. */
export function jsonTable(value: unknown, sections = jsonSections(value)): { label: string; recs: Records } {
  const best = sections
    .filter((s): s is Extract<Section, { kind: 'records' }> => s.kind === 'records')
    .sort((a, b) => b.recs.rows.length - a.recs.rows.length)[0]
  if (best) return { label: best.label, recs: best.recs }
  const rows: Row[] = []
  const walk = (v: unknown, p: string) => {
    if (rows.length >= 5000) return
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`))
    else if (isPlain(v)) for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k)
    else rows.push({ path: p || '(value)', value: v })
  }
  walk(value, '')
  return { label: 'Every value', recs: recordsOf(rows) }
}

// ---- TSV / CSV --------------------------------------------------------------------------------------------------

/** Split TSV (tabs) or CSV (commas, or semicolons when those win; "quoted, cells" and "" escapes) into rows. */
export function parseDelimited(text: string, ext = ''): string[][] {
  const src = String(text ?? '').replace(/^﻿/, '')
  const firstLine = src.slice(0, src.search(/\r?\n|$/))
  const sep = ext === 'tsv' || (firstLine.includes('\t') && ext !== 'csv') ? '\t' : (firstLine.split(';').length > firstLine.split(',').length ? ';' : ',')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < src.length && rows.length < MAX_ROWS; i++) {
    const c = src[i]
    if (q) {
      if (c === '"' && src[i + 1] === '"') (cell += '"', i++)
      else if (c === '"') q = false
      else cell += c
    } else if (c === '"' && cell === '' && sep !== '\t') q = true
    else if (c === sep) (row.push(cell), (cell = ''))
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) (row.push(cell), rows.push(row))
  return rows.filter((r) => r.some((x) => x.trim() !== '')).map((r) => r.slice(0, MAX_COLS))
}

/** Rows of cells → records. The first row is a header when its cells are unique labels (not numbers or dates) and
 *  either the file is a CSV (they nearly always have one) or some column below holds numbers, dates or links. Without
 *  a header, columns take `names` (its folder README's `columns:`) or are named by what they hold ("Number", "Video"). */
export function delimitedRecords(cells: string[][], ext = '', names: string[] = []): Records {
  const width = Math.min(MAX_COLS, Math.max(0, ...cells.map((r) => r.length)))
  if (!cells.length || !width) return { cols: [], rows: [] }
  const body = cells.slice(1)
  const head = cells[0]
  const typed = Array.from({ length: width }, (_, j) => typeOf(body.map((r) => r[j])).type)
  const labelish = head.every((h, j) => j >= width || (h.trim() !== '' && numOf(h) === null && !DATE.test(h.trim()) && h.trim().length <= 60))
  const header =
    cells.length >= 2 &&
    labelish &&
    new Set(head.map((h) => h.trim())).size === head.length &&
    (ext === 'csv' || typed.some((t, j) => ['number', 'date', 'url', 'yt', 'image'].includes(t) && head[j] !== undefined))
  const dataRows = header ? body : cells
  const NAME: Record<ColType, string> = { number: 'Number', date: 'Date', bool: 'Yes / no', url: 'Link', image: 'Image', yt: 'Video', text: 'Text', json: 'Data', empty: 'Empty' }
  const allTyped = Array.from({ length: width }, (_, j) => typeOf(dataRows.map((r) => r[j])).type)
  const used = new Map<string, number>()
  const given = !header && names.some((n) => String(n ?? '').trim())
  const labels = Array.from({ length: width }, (_, j) => {
    if (header) return head[j].trim()
    if (given && String(names[j] ?? '').trim()) return String(names[j]).trim().slice(0, 60)
    const base = NAME[allTyped[j]]
    const n = (used.get(base) || 0) + 1
    used.set(base, n)
    return n > 1 ? `${base} ${n}` : base
  })
  const keys = labels.map((_, j) => `c${j}`)
  const rows = dataRows.map((r) => Object.fromEntries(keys.map((k, j) => [k, r[j] ?? ''])))
  const recs = recordsOf(rows)
  recs.cols.forEach((c, j) => (c.label = labels[j] || c.label))
  // real names ("Views", "Title") decide the title and the amount, as in a JSON file
  if (header || given) {
    const find = (list: string[], ok: (c: Col) => boolean) => recs.cols.find((c) => list.includes(c.label.toLowerCase()) && ok(c))?.key
    recs.title = find(TITLE_KEYS, (c) => c.type === 'text' || c.type === 'yt') || recs.title
    const named = find(NUM_KEYS, (c) => c.type === 'number')
    if (named) (recs.num = named), (recs.measure = true)
  } else {
    // no header: the longest text column names a row best (a title beats an id)
    const texts = recs.cols.filter((c) => c.type === 'text')
    const avg = (k: string) => rows.slice(0, 200).reduce((a, r) => a + String(r[k] ?? '').length, 0)
    if (texts.length) recs.title = texts.sort((a, b) => avg(b.key) - avg(a.key))[0].key
    recs.sub = undefined
  }
  return recs
}

// ---- charts (ChartSpec-shaped objects; components/charts parseChart caps and checks them again) ---------------------

export type Spec = { type: 'bar' | 'line'; title: string; subtitle?: string; unit?: string; labels: string[]; series: { name: string; data: number[] }[]; horizontal?: boolean }

const unitOf = (col?: Col) => (col && /usd|price|cost|amount|\$/i.test(col.key + col.label) ? '$' : undefined)
const colOf = (recs: Records, key?: string) => recs.cols.find((c) => c.key === key)
const round = (n: number) => Math.round(n * 100) / 100
/** A label inside a sentence: "Views" → "views", but "USD" stays "USD". */
const lc = (s: string) => (s && s !== s.toUpperCase() ? s[0].toLowerCase() + s.slice(1) : s)
/** The column a chart sums: the measure, or none (then it counts rows). */
const sumCol = (recs: Records) => (recs.measure ? colOf(recs, recs.num) : undefined)

/** Numeric column summed per day (or per month past 45 days); null when the records have no dates. `noun` names
 *  what a row is when rows are counted ("Works per day"). */
export function timeSpec(recs: Records, noun = 'Rows'): Spec | null {
  if (!recs.time) return null
  const num = sumCol(recs)
  const by = new Map<string, number>()
  for (const r of recs.rows) {
    const d = String(r[recs.time] ?? '').slice(0, 10)
    if (!DATE.test(d)) continue
    by.set(d, (by.get(d) || 0) + (num ? numOf(r[num.key]) ?? 0 : 1))
  }
  let days = [...by.keys()].sort()
  if (days.length < 2) return null
  let monthly = false
  if (days.length > 45) {
    monthly = true
    const m = new Map<string, number>()
    for (const d of days) m.set(d.slice(0, 7), (m.get(d.slice(0, 7)) || 0) + by.get(d)!)
    by.clear()
    for (const [k, v] of m) by.set(k, v)
    days = [...m.keys()].sort()
  }
  const fmtDay = (d: string) => (monthly ? new Date(d + '-01T00:00:00Z') : new Date(d + 'T00:00:00Z')).toLocaleDateString('en', { month: 'short', ...(monthly ? { year: '2-digit' } : { day: 'numeric' }), timeZone: 'UTC' })
  const what = num ? num.label : noun
  return {
    type: days.length > 31 ? 'line' : 'bar',
    title: `${what} per ${monthly ? 'month' : 'day'}`,
    unit: unitOf(num),
    labels: days.slice(-60).map(fmtDay),
    series: [{ name: what, data: days.slice(-60).map((d) => round(by.get(d)!)) }],
  }
}

/** Numeric column summed (or rows counted) per group, biggest first (≤12). */
export function groupSpec(recs: Records, noun = 'Rows'): Spec | null {
  if (!recs.group) return null
  const num = sumCol(recs)
  const by = new Map<string, number>()
  for (const r of recs.rows) {
    const g = recs.group.firstWord ? firstWord(r[recs.group.key]) : textOf(r[recs.group.key], 40)
    if (!g) continue
    by.set(g, (by.get(g) || 0) + (num ? numOf(r[num.key]) ?? 0 : 1))
  }
  if (by.size < 2) return null
  const top = [...by].sort((a, b) => b[1] - a[1]).slice(0, 12)
  const gl = colOf(recs, recs.group.key)?.label || 'Group'
  const by_ = recs.group.firstWord ? 'kind' : lc(gl)
  return {
    type: 'bar',
    horizontal: true,
    title: `${num ? num.label : noun} by ${by_}`,
    subtitle: recs.group.firstWord ? `Kind = the first word of ${lc(gl)}` : undefined,
    unit: unitOf(num),
    labels: top.map(([k]) => k),
    series: [{ name: num ? num.label : noun, data: top.map(([, v]) => round(v)) }],
  }
}

/** The biggest rows by the numeric column, named by the title column (≤15): "top videos by views". */
export function topSpec(recs: Records, n = 15): Spec | null {
  const num = colOf(recs, recs.num)
  if (!num || !recs.title || recs.rows.length < 3) return null
  const top = recs.rows
    .map((r) => ({ label: textOf(r[recs.title!], 40), v: numOf(r[num.key]) }))
    .filter((x): x is { label: string; v: number } => x.v !== null && !!x.label)
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
  if (top.length < 3) return null
  return { type: 'bar', horizontal: true, title: `Top ${top.length} by ${lc(num.label)}`, unit: unitOf(num), labels: top.map((x) => x.label), series: [{ name: num.label, data: top.map((x) => x.v) }] }
}

/** Header numbers for a records set: rows, and the numeric column's total / average / max. */
export function recordStats(recs: Records): { label: string; value: string }[] {
  const out = [{ label: 'Rows', value: recs.rows.length.toLocaleString('en') }]
  const num = colOf(recs, recs.num)
  if (num) {
    const vs = recs.rows.map((r) => numOf(r[num.key])).filter((v): v is number => v !== null)
    if (vs.length) {
      const u = unitOf(num) || ''
      const f = (v: number) => u + (Math.abs(v) >= 1e4 ? Math.round(v).toLocaleString('en') : round(v).toLocaleString('en'))
      const sum = vs.reduce((a, b) => a + b, 0)
      if (recs.measure) out.push({ label: `Total ${lc(num.label)}`, value: f(sum) })
      out.push({ label: `Average ${lc(num.label)}`, value: f(sum / vs.length) }, { label: `Highest ${lc(num.label)}`, value: f(Math.max(...vs)) })
    }
  }
  if (recs.time) {
    const ds = recs.rows.map((r) => String(r[recs.time!] ?? '').slice(0, 10)).filter((d) => DATE.test(d)).sort()
    if (ds.length) out.push({ label: 'Dates', value: ds[0] === ds[ds.length - 1] ? ds[0] : `${ds[0]} → ${ds[ds.length - 1]}` })
  }
  return out
}

// ---- Raw view --------------------------------------------------------------------------------------------------

export type Tok = { t: 'key' | 'str' | 'num' | 'lit' | 'pun'; s: string }

/** Pretty JSON → tokens for the Raw view's colours (keys, strings, numbers, true/false/null, punctuation). */
export function jsonTokens(pretty: string): Tok[] {
  const out: Tok[] = []
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:\s]+)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(pretty))) {
    if (m.index > last) out.push({ t: 'pun', s: pretty.slice(last, m.index) })
    if (m[1]) out.push({ t: m[2] ? 'key' : 'str', s: m[1] }, ...(m[2] ? [{ t: 'pun' as const, s: m[2] }] : []))
    else if (m[3]) out.push({ t: 'num', s: m[3] })
    else if (m[4]) out.push({ t: 'lit', s: m[4] })
    else out.push({ t: 'pun', s: m[5] })
    last = re.lastIndex
  }
  if (last < pretty.length) out.push({ t: 'pun', s: pretty.slice(last) })
  return out
}
