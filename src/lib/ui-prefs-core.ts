// HQ look preferences core (UiPrefs v1): flat keys, enum-only values, ONE total normalizer for every
// source (people/<slug>/ui.md, the localStorage cache, the ui-tweak model patch, presets, the palette).
// One file, shared by everything:
//   - edge (Deno):      supabase/functions/_shared/ui-prefs-core.ts  (this file, canonical; `ui-tweak`)
//   - app (Vite/TS):    app/src/lib/ui-prefs-core.ts                 (byte-identical copy, ui-parity test)
//   - scripts (Node):   imported as-is (type stripping)
//
// Rules: zero imports · erasable TypeScript only (no enum, namespace or parameter properties) · nothing
// here throws · no DOM, no clock, no storage. Values only ever leave this file as enum members (they become
// data-* attributes that CSS matches on); never CSS, HTML, URLs or colours from data or from the model.
// Pins are checked for FORMAT only; whether a pinned page still exists is decided at render time.
// Edit THIS file, then copy it to the app: cp supabase/functions/_shared/ui-prefs-core.ts app/src/lib/

export const UI_PREFS_V = 1

// ===========================================================================
// Vocabulary
// ===========================================================================

/** Every enum key and its allowed values. The app's inline pre-paint script carries the same lists
 *  (prepaint-parity test). The first value is NOT always the default: see DEFAULT_PREFS. */
export const ENUM = deepFreeze({
  theme: ['system', 'light', 'dark'],
  accent: ['violet', 'blue', 'green', 'amber', 'rose', 'slate'],
  density: ['compact', 'comfy', 'spacious'],
  size: ['s', 'm', 'l', 'xl', 'xxl'],
  font: ['inter', 'lexend', 'atkinson', 'system'],
  lh: ['normal', 'relaxed', 'loose'],
  ls: ['normal', 'wide'],
  motion: ['system', 'reduced', 'full'],
  contrast: ['normal', 'high'],
  calm: ['off', 'on'],
  focus: ['off', 'on'],
  keys: ['on', 'off'],
} as const)

/** Widget ids per page, in their built-in order. */
export const WIDGETS = deepFreeze({
  home: ['ask', 'foryou', 'week', 'projects', 'activity'],
  project: ['journey', 'explainers', 'team', 'files', 'activity'],
  person: ['checkins', 'foryou', 'time', 'energy', 'projects', 'log'],
} as const)

/** Sidebar / bottom-bar pages, in their built-in order. `home` can be moved but never hidden. */
export const NAV_IDS = deepFreeze(['home', 'projects', 'tasks', 'board', 'ask', 'people'] as const)

export type EnumKey = keyof typeof ENUM
export type EnumValue<K extends EnumKey> = (typeof ENUM)[K][number]
export type HomeWidget = (typeof WIDGETS)['home'][number]
export type ProjectWidget = (typeof WIDGETS)['project'][number]
export type PersonWidget = (typeof WIDGETS)['person'][number]
export type NavId = (typeof NAV_IDS)[number]

export type UiPrefs = {
  v: 1
  theme: EnumValue<'theme'>
  accent: EnumValue<'accent'>
  density: EnumValue<'density'>
  size: EnumValue<'size'>
  font: EnumValue<'font'>
  lh: EnumValue<'lh'>
  ls: EnumValue<'ls'>
  motion: EnumValue<'motion'>
  contrast: EnumValue<'contrast'>
  calm: EnumValue<'calm'>
  focus: EnumValue<'focus'>
  keys: EnumValue<'keys'>
  home_order: HomeWidget[]
  home_hidden: HomeWidget[]
  project_order: ProjectWidget[]
  project_hidden: ProjectWidget[]
  person_order: PersonWidget[]
  person_hidden: PersonWidget[]
  nav_order: NavId[]
  nav_hidden: NavId[]
  /** `project:<slug>` · `doc:<path>` · `person:<slug>`; none stored = derived at render (≤2 of my active projects) */
  pinned: string[]
}
export type PrefKey = Exclude<keyof UiPrefs, 'v'>
export type ListKey = 'home_order' | 'home_hidden' | 'project_order' | 'project_hidden' | 'person_order' | 'person_hidden' | 'nav_order' | 'nav_hidden'

export const ENUM_KEYS: readonly EnumKey[] = deepFreeze(Object.keys(ENUM) as EnumKey[])
export const LIST_KEYS: readonly ListKey[] = deepFreeze(['home_order', 'home_hidden', 'project_order', 'project_hidden', 'person_order', 'person_hidden', 'nav_order', 'nav_hidden'] as ListKey[])
/** Every preference key in its canonical order (frontmatter patches are written in this order). */
export const PREF_KEYS: readonly PrefKey[] = deepFreeze([...ENUM_KEYS, ...LIST_KEYS, 'pinned'] as PrefKey[])

/** The defaults. Frozen: use defaultPrefs() (or resolvePrefs()) for a copy you can change. */
export const DEFAULT_PREFS: Readonly<UiPrefs> = deepFreeze({
  v: 1,
  theme: 'system',
  accent: 'violet',
  density: 'comfy',
  size: 'm',
  font: 'inter',
  lh: 'normal',
  ls: 'normal',
  motion: 'system',
  contrast: 'normal',
  calm: 'off',
  focus: 'off',
  keys: 'on',
  home_order: [...WIDGETS.home],
  home_hidden: [],
  project_order: [...WIDGETS.project],
  project_hidden: [],
  person_order: [...WIDGETS.person],
  person_hidden: [],
  nav_order: [...NAV_IDS],
  nav_hidden: [],
  pinned: [],
} as UiPrefs)

export const LIMITS = deepFreeze({ pins: 8, pinPath: 120, wish: 200, clauses: 6, clause: 80, shown: 60, unsupported: 3, scan: 200, dropped: 40 })

/** `project:<slug>` · `doc:<path>` · `person:<slug>`; format only (existence is checked at render). */
export const PIN_RE = /^(project|doc|person):[\w./-]{1,120}$/

/** Frontmatter keys of ui.md that are not preferences (read silently, never reported as dropped). */
export const FILE_META_KEYS: readonly string[] = deepFreeze(['type', 'person', 'v', 'updated'])

// ===========================================================================
// Labels (chips, Settings, history) · copy only, no markup
// ===========================================================================

export const LABEL: Readonly<Record<PrefKey, string>> = deepFreeze({
  theme: 'Theme',
  accent: 'Accent',
  density: 'Density',
  size: 'Text size',
  font: 'Font',
  lh: 'Line spacing',
  ls: 'Letter spacing',
  motion: 'Motion',
  contrast: 'Contrast',
  calm: 'Calm colours',
  focus: 'Focus mode',
  keys: 'Single-key shortcuts',
  home_order: 'Home order',
  home_hidden: 'Hidden on Home',
  project_order: 'Project page order',
  project_hidden: 'Hidden on projects',
  person_order: 'Person page order',
  person_hidden: 'Hidden on your page',
  nav_order: 'Sidebar order',
  nav_hidden: 'Hidden in sidebar',
  pinned: 'Pinned',
})
export const SIZE_PCT: Readonly<Record<EnumValue<'size'>, string>> = deepFreeze({ s: '90%', m: '100%', l: '110%', xl: '120%', xxl: '135%' })
export const FONT_NAME: Readonly<Record<EnumValue<'font'>, string>> = deepFreeze({ inter: 'Inter', lexend: 'Lexend (readable)', atkinson: 'Atkinson Hyperlegible', system: 'System' })
export const WIDGET_NAME: Readonly<{ home: Record<HomeWidget, string>; project: Record<ProjectWidget, string>; person: Record<PersonWidget, string> }> = deepFreeze({
  home: { ask: 'Ask bar', foryou: 'For you', week: 'My week', projects: 'Projects', activity: 'Recent changes' },
  project: { journey: 'Journey', explainers: 'Explainer', team: 'Team', files: 'Pages', activity: 'Recent activity' },
  person: { checkins: 'Check-ins', foryou: 'For you', time: 'Time per project', energy: 'Energy', projects: 'Projects', log: 'Log' },
})
export const NAV_NAME: Readonly<Record<NavId, string>> = deepFreeze({ home: 'Home', projects: 'Projects', tasks: 'Tasks', board: 'Board', ask: 'Ask AI', people: 'People' })

/** A value as a person reads it in a chip: `Text size 100% → 120%`, `Hidden in sidebar none → Board`. */
export function fmtPref(key: string, value: unknown): string {
  try {
    if (key === 'size' && typeof value === 'string' && has(SIZE_PCT, value)) return SIZE_PCT[value as EnumValue<'size'>]
    if (key === 'font' && typeof value === 'string' && has(FONT_NAME, value)) return FONT_NAME[value as EnumValue<'font'>]
    if (Array.isArray(value)) {
      if (!value.length) return 'none'
      const m = LIST_RE.exec(key)
      const names: Record<string, string> = !m ? {} : m[1] === 'nav' ? NAV_NAME : WIDGET_NAME[m[1] as 'home' | 'project' | 'person']
      return value.map((x) => (typeof x !== 'string' ? '' : key === 'pinned' ? x.slice(x.indexOf(':') + 1) : has(names, x) ? names[x] : x)).filter(Boolean).join(', ')
    }
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

// ===========================================================================
// Presets (one tap, no AI)
// ===========================================================================

export type PresetId = 'focus' | 'calm' | 'large' | 'readable' | 'contrast'
export type Preset = { id: PresetId; icon: string; name: string; sub: string; patch: Partial<UiPrefs> }

export const PRESETS: readonly Preset[] = deepFreeze([
  { id: 'focus', icon: 'focus', name: 'Focus', sub: 'Next line + main block', patch: { focus: 'on', motion: 'reduced' } },
  { id: 'calm', icon: 'leaf', name: 'Calm', sub: 'Quiet colours, no motion', patch: { calm: 'on', accent: 'slate', motion: 'reduced' } },
  { id: 'large', icon: 'type', name: 'Large text', sub: '120% + more air', patch: { size: 'xl', lh: 'relaxed' } },
  { id: 'readable', icon: 'learned', name: 'Readable font', sub: 'Lexend, wider spacing', patch: { font: 'lexend', ls: 'wide', lh: 'relaxed' } },
  { id: 'contrast', icon: 'contrast', name: 'High contrast', sub: 'Darker text, strong lines', patch: { contrast: 'high' } },
] as Preset[])

/** A preset's patch (a fresh, normalized copy), or null for an unknown id. */
export function presetPatch(id: unknown): Partial<UiPrefs> | null {
  const p = PRESETS.find((x) => x.id === id)
  return p ? normalizePrefs(p.patch).prefs : null
}

// ===========================================================================
// Normalize (the ONLY way in) · resolve · diff
// ===========================================================================

export type Normalized = { prefs: Partial<UiPrefs>; dropped: string[] }

const LIST_RE = /^(home|project|person|nav)_(order|hidden)$/
const LIST_IDS: Readonly<Record<string, readonly string[]>> = deepFreeze({ home: WIDGETS.home, project: WIDGETS.project, person: WIDGETS.person, nav: NAV_IDS })

/** TOTAL (never throws). Keeps only known keys with allowed values: enum keys must be one of their
 *  values; id lists keep known ids (deduped, capped, `*_order` completed with the missing ids in
 *  built-in order, `*_hidden` in built-in order, `home` never hidden); `pinned` keeps well-formed ids
 *  (≤8, deduped, no `.`/`..` segments). `v` is ignored; every other key or bad value is listed in
 *  `dropped` (key names only, ≤40 of them, each ≤60 chars). `prefs` holds only the keys that survived. */
export function normalizePrefs(raw: unknown): Normalized {
  const out: Record<string, unknown> = {}
  const dropped: string[] = []
  const drop = (k: string) => {
    if (dropped.length < LIMITS.dropped) dropped.push(k.slice(0, 60))
  }
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { prefs: {}, dropped: ['not an object'] }
    const src = raw as Record<string, unknown>
    for (const k of Object.keys(src)) {
      const v = src[k]
      if (has(ENUM, k)) {
        if (typeof v === 'string' && (ENUM[k as EnumKey] as readonly string[]).indexOf(v) >= 0) out[k] = v
        else drop(k)
        continue
      }
      const m = LIST_RE.exec(k)
      if (m) {
        const r = idList(v, m[1], m[2] === 'order')
        if (r) out[k] = r
        else drop(k)
        continue
      }
      if (k === 'pinned') {
        const r = pinList(v)
        if (r) out[k] = r
        else drop(k)
        continue
      }
      if (k !== 'v') drop(k)
    }
  } catch {
    return { prefs: {}, dropped: ['unreadable'] }
  }
  return { prefs: out as Partial<UiPrefs>, dropped }
}

function idList(v: unknown, group: string, order: boolean): string[] | null {
  if (!Array.isArray(v)) return null
  const ids = LIST_IDS[group]
  const got: string[] = []
  const n = Math.min(Number(v.length) || 0, LIMITS.scan)
  for (let i = 0; i < n && got.length < ids.length; i++) {
    const x = v[i]
    if (typeof x !== 'string' || ids.indexOf(x) < 0 || got.indexOf(x) >= 0) continue
    if (group === 'nav' && !order && x === 'home') continue
    got.push(x)
  }
  if (order) {
    for (const id of ids) if (got.indexOf(id) < 0) got.push(id)
    return got
  }
  return ids.filter((id) => got.indexOf(id) >= 0)
}

/** A well-formed pin id (format only): `project|doc|person:` + a path of [A-Za-z0-9_./-], no `.`/`..`
 *  segments, no `//`. */
export function isPin(x: unknown): x is string {
  return typeof x === 'string' && PIN_RE.test(x) && !/(^|[:/])\.\.?(\/|$)/.test(x) && x.indexOf('//') < 0
}

function pinList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const got: string[] = []
  const n = Math.min(Number(v.length) || 0, LIMITS.scan)
  for (let i = 0; i < n && got.length < LIMITS.pins; i++) {
    const x = v[i]
    if (isPin(x) && got.indexOf(x) < 0) got.push(x)
  }
  return got
}

/** A fresh, changeable copy of the defaults. */
export function defaultPrefs(): UiPrefs {
  return copyPrefs(DEFAULT_PREFS)
}

function copyPrefs(p: Readonly<UiPrefs>): UiPrefs {
  const out = {} as Record<string, unknown>
  for (const k of Object.keys(p)) {
    const v = (p as Record<string, unknown>)[k]
    out[k] = Array.isArray(v) ? v.slice() : v
  }
  return out as UiPrefs
}

/** Full prefs from anything: the defaults, overlaid with whatever survives normalizePrefs(raw). */
export function resolvePrefs(raw?: unknown): UiPrefs {
  return withPatch(DEFAULT_PREFS, raw)
}

/** `base` (resolved) with `patch` (normalized) laid over it. Neither input is changed. */
export function withPatch(base: unknown, patch: unknown): UiPrefs {
  const out = defaultPrefs() as unknown as Record<string, unknown>
  for (const src of [base, patch]) {
    if (src === undefined || src === null) continue
    const n = normalizePrefs(src).prefs as Record<string, unknown>
    for (const k of Object.keys(n)) out[k] = n[k]
  }
  return out as unknown as UiPrefs
}

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i])
  return a === b
}

/** The keys whose resolved value differs between `a` and `b`, with b's values (canonical key order).
 *  diffPrefs(lastReadFile, now) = what this device changed since its last sync. */
export function diffPrefs(a: unknown, b: unknown): Partial<UiPrefs> {
  const A = resolvePrefs(a) as unknown as Record<string, unknown>
  const B = resolvePrefs(b) as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of PREF_KEYS) {
    if (same(A[k], B[k])) continue
    const v = B[k]
    out[k] = Array.isArray(v) ? v.slice() : v
  }
  return out as Partial<UiPrefs>
}

// ===========================================================================
// ui.md frontmatter (flat keys, block lists) · root data-* attributes
// ===========================================================================

export type FrontmatterPatch = Record<string, string | string[] | null>

/** Changed keys → a patch for setTopKeys(): a key back at its default → null (the line is removed),
 *  anything else → its value (lists stay lists, written as block lists). Junk never gets through
 *  (normalized first); keys come out in canonical order; `v` and file meta keys are not touched. */
export function toFrontmatterPatch(changed: unknown): FrontmatterPatch {
  const n = normalizePrefs(changed).prefs as Record<string, unknown>
  const def = DEFAULT_PREFS as unknown as Record<string, unknown>
  const out: FrontmatterPatch = {}
  for (const k of PREF_KEYS) {
    if (!has(n, k)) continue
    const v = n[k]
    out[k] = same(v, def[k]) ? null : Array.isArray(v) ? v.slice() : (v as string)
  }
  return out
}

/** Parsed ui.md frontmatter (any parser: scripts parseYaml, md.mjs fm(), the yaml package) → prefs.
 *  Forgiving about hand edits before the strict normalizer runs: `true/false` → on/off for on/off keys,
 *  enum strings trimmed + lower-cased, a single id or `a, b` string → a list. Meta keys (type, person,
 *  v, updated) and empty values are skipped silently. Never throws. */
export function fromFrontmatter(data: unknown): Normalized {
  try {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { prefs: {}, dropped: [] }
    const src = data as Record<string, unknown>
    const raw: Record<string, unknown> = {}
    for (const k of Object.keys(src)) {
      if (FILE_META_KEYS.indexOf(k) >= 0) continue
      let v = src[k]
      if (v === null || v === undefined) continue
      if (has(ENUM, k)) {
        const list = ENUM[k as EnumKey] as readonly string[]
        if (typeof v === 'boolean' && list.indexOf('on') >= 0) v = v ? 'on' : 'off'
        else if (typeof v === 'string') v = v.trim().toLowerCase()
      } else if (LIST_RE.test(k) || k === 'pinned') {
        const pins = k === 'pinned'
        if (typeof v === 'string') v = v.replace(/^\s*\[|\]\s*$/g, '').split(/[\s,]+/)
        if (Array.isArray(v)) v = v.map((x) => (typeof x === 'string' ? (pins ? x.trim() : x.trim().toLowerCase()) : x)).filter((x) => x !== '')
      }
      raw[k] = v
    }
    return normalizePrefs(raw)
  } catch {
    return { prefs: {}, dropped: ['unreadable'] }
  }
}

/** Attributes managed on <html>, apart from data-theme / data-theme-pref. */
export const DATA_ATTRS: readonly EnumKey[] = deepFreeze(['accent', 'density', 'size', 'font', 'lh', 'ls', 'contrast', 'calm', 'focus', 'motion'] as EnumKey[])

/** Is the resolved theme dark? `systemDark` = the OS answer to prefers-color-scheme: dark. */
export function isDark(prefs: unknown, systemDark = false): boolean {
  const t = resolvePrefs(prefs).theme
  return t === 'dark' || (t === 'system' && systemDark === true)
}

/** The <html> attributes for these prefs: `data-theme` (resolved light|dark) and `data-theme-pref`
 *  always; every DATA_ATTRS key as `data-<key>` = its value when it is not the default, else null
 *  (= remove the attribute). Every value is an enum member. */
export function toDataAttrs(prefs: unknown, systemDark = false): Record<string, string | null> {
  const p = resolvePrefs(prefs) as unknown as Record<string, string>
  const def = DEFAULT_PREFS as unknown as Record<string, string>
  const out: Record<string, string | null> = {
    'data-theme': isDark(p, systemDark) ? 'dark' : 'light',
    'data-theme-pref': p.theme,
  }
  for (const k of DATA_ATTRS) out['data-' + k] = p[k] !== def[k] ? p[k] : null
  return out
}

// ===========================================================================
// Wishes → clauses → patch (local rules; the ui-tweak model returns the same shape)
// ===========================================================================

export type TweakResult = { patch: Partial<UiPrefs>; unsupported: number[] }

// separators: , ; . line breaks · and · also · then · plus · with
const CLAUSE_SPLIT = /\s*(?:[,;.\r\n]|\band\b|\balso\b|\bthen\b|\bplus\b|\bwith\b)\s*/i
// control characters (except tab and line breaks), zero-width and bidi overrides become spaces
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g

/** A wish → ≤6 clauses of ≤80 characters (the wish itself is read up to 200). The ui-tweak request
 *  sends exactly these clauses, and `unsupported` indexes point into this array. Non-strings → []. */
export function clausesOf(text: unknown): string[] {
  if (typeof text !== 'string') return []
  return text
    .slice(0, LIMITS.wish)
    .replace(INVISIBLE, ' ')
    .split(CLAUSE_SPLIT)
    .map((c) => c.replace(/\s+/g, ' ').trim().slice(0, LIMITS.clause).trim())
    .filter(Boolean)
    .slice(0, LIMITS.clauses)
}

/** A clause as shown back in "Can't do yet": the person's own words, links removed, ≤60 characters. */
export function clauseText(clause: unknown): string {
  if (typeof clause !== 'string') return ''
  return clause.replace(INVISIBLE, ' ').replace(/[\t\r\n]+/g, ' ').replace(/\b(?:https?:\/\/|www\.)\S*/gi, '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.shown).trim()
}

type Draft = Record<string, unknown>
type Rule = [RegExp, (p: Draft, cur: UiPrefs, t: string) => void]

const COLOURS: Readonly<Record<string, EnumValue<'accent'>>> = deepFreeze({
  violet: 'violet', purple: 'violet', blue: 'blue', green: 'green', amber: 'amber', orange: 'amber', yellow: 'amber',
  rose: 'rose', pink: 'rose', slate: 'slate', grey: 'slate', gray: 'slate',
})
const COLOUR_RE = /\b(violet|purple|blue|green|amber|orange|yellow|rose|pink|slate|grey|gray)\b/
const NAV_WORDS: Readonly<Record<string, NavId>> = deepFreeze({ board: 'board', tasks: 'tasks', 'to-dos': 'tasks', todos: 'tasks', people: 'people', ask: 'ask' })
const HOME_WORDS: Readonly<Record<string, HomeWidget>> = deepFreeze({ 'recent changes': 'activity', activity: 'activity', 'my week': 'week', 'this week': 'week', 'ask bar': 'ask', 'for you': 'foryou' })
const SHOW = '(?:show|unhide|bring back|restore)'
// "turn it off" phrasings, judged inside ONE clause (the positive rule for the same key then stands down)
const CALM_OFF = /(?:\bno|turn off|switch off|disable|stop|exit)\s+(?:the\s+)?calm|calm(?: mode| colou?rs)? off\b/
const FOCUS_OFF = /(?:\bno|turn off|switch off|disable|stop|exit|leave)\s+(?:the\s+)?focus|focus(?: mode)? off\b/
const CONTRAST_OFF = /normal contrast|less contrast|contrast off\b|(?:\bno|turn off|switch off|disable)\s+(?:the\s+)?(?:high\s+)?contrast/

const listOf = (p: Draft, cur: UiPrefs, key: ListKey): string[] => ((p[key] as string[] | undefined) || (cur[key] as string[])).slice()
const stepOf = (p: Draft, cur: UiPrefs, key: 'size' | 'lh'): number => (ENUM[key] as readonly string[]).indexOf((p[key] as string) || cur[key])
const on = (re: RegExp, set: (p: Draft) => void): Rule => [re, (p) => set(p)]

/** ≈20 phrase rules (lower-cased clause padded with spaces). Order matters: later rules win a key. */
const RULES: readonly Rule[] = [
  [/bigger|larger|large text|too small|too tiny|is tiny|can['\u2019]?t read|zoom in|enlarge/, (p, cur) => {
    p.size = ENUM.size[Math.min(ENUM.size.length - 1, Math.max(stepOf(p, cur, 'size') + 1, 3))]
  }],
  [/smaller|zoom out|shrink|make it tiny/, (p, cur) => {
    p.size = ENUM.size[Math.max(0, stepOf(p, cur, 'size') - 1)]
  }],
  on(/\bdark\b|\bnight\b/, (p) => { p.theme = 'dark' }),
  on(/\blight (mode|theme)\b|\bbright\b|\bday mode\b|^ light $/, (p) => { p.theme = 'light' }),
  on(/follow (the )?system|system theme|match (my )?(os|system|computer|phone)/, (p) => { p.theme = 'system' }),
  on(CALM_OFF, (p) => { p.calm = 'off' }),
  [/calm|quiet|less busy|overwhelm|too much|noisy|relax(?!ed)/, (p, _cur, t) => {
    if (CALM_OFF.test(t)) return
    p.calm = 'on'
    p.motion = 'reduced'
    if (!COLOUR_RE.test(t)) p.accent = 'slate'
  }],
  on(FOCUS_OFF, (p) => { p.focus = 'off' }),
  [/focus|distract|one thing|tunnel/, (p, _cur, t) => {
    if (!FOCUS_OFF.test(t)) p.focus = 'on'
  }],
  on(/dyslex|readable|easier to read|lexend|reading/, (p) => {
    p.font = 'lexend'
    p.ls = 'wide'
    p.lh = 'relaxed'
  }),
  on(/atkinson|hyperlegible|legible/, (p) => { p.font = 'atkinson' }),
  on(CONTRAST_OFF, (p) => { p.contrast = 'normal' }),
  [/contrast|hard to see|faint|low vision/, (p, _cur, t) => {
    if (!CONTRAST_OFF.test(t)) p.contrast = 'high'
  }],
  [/motion|animation|moving|dizzy/, (p, _cur, t) => {
    p.motion = /more (motion|animations?)|animations? on\b|full motion|(turn|switch) on (the )?animations?/.test(t) ? 'full' : 'reduced'
  }],
  [/line (spacing|height)|space between (the )?lines|lines (are )?too close/, (p, cur, t) => {
    if (/(less|smaller|tighter|reduce|normal) (the )?line/.test(t)) p.lh = 'normal'
    else p.lh = ENUM.lh[Math.min(ENUM.lh.length - 1, Math.max(stepOf(p, cur, 'lh') + 1, 1))]
  }],
  [/letter spacing|space between (the )?letters|wider letters|letters (are )?too close/, (p, _cur, t) => {
    p.ls = /(less|smaller|tighter|reduce|normal) (the )?letter/.test(t) ? 'normal' : 'wide'
  }],
  on(/spacious|more space(?! between)|cramped|breathe|airy/, (p) => {
    p.density = 'spacious'
    p.lh = 'relaxed'
  }),
  on(/compact|dense|more on (the )?screen/, (p) => { p.density = 'compact' }),
  [COLOUR_RE, (p, _cur, t) => {
    const m = COLOUR_RE.exec(t)
    if (m) p.accent = COLOURS[m[1]]
  }],
  on(/\b(single[- ]key|shortcuts?) off\b|no (single[- ]key )?(keyboard )?shortcuts|voice control|(turn|switch) off (the )?(single[- ]key )?(keyboard )?shortcuts|disable (the )?(single[- ]key )?(keyboard )?shortcuts/, (p) => { p.keys = 'off' }),
  on(/\bshortcuts? on\b|(turn|switch) on (the )?(single[- ]key )?(keyboard )?shortcuts|enable (the )?(single[- ]key )?(keyboard )?shortcuts/, (p) => { p.keys = 'on' }),
  on(/projects first|my projects first|projects on top/, (p) => {
    p.home_order = ['projects', ...WIDGETS.home.filter((w) => w !== 'projects')]
  }),
]

type Toggle = { key: 'nav_hidden' | 'home_hidden'; id: string; hide: RegExp; show: RegExp }
const toggle = (key: Toggle['key'], id: string, word: string): Toggle => ({
  key, id, hide: new RegExp('\\bhide (the )?' + word), show: new RegExp('\\b' + SHOW + ' (the )?' + word),
})
/** hide / show a page in the sidebar (not "the ask bar", which is a Home widget), then a Home widget */
const TOGGLES: readonly Toggle[] = [
  ...Object.keys(NAV_WORDS).map((w) => toggle('nav_hidden', NAV_WORDS[w], w === 'ask' ? 'ask\\b(?! bar)' : w + '\\b')),
  ...Object.keys(HOME_WORDS).map((w) => toggle('home_hidden', HOME_WORDS[w], w + '\\b')),
]

function tweakClause(clause: string, p: Draft, cur: UiPrefs): number {
  const t = ' ' + clause.toLowerCase() + ' '
  let hit = 0
  for (const [re, f] of RULES) {
    if (!re.test(t)) continue
    f(p, cur, t)
    hit++
  }
  for (const g of TOGGLES) {
    if (g.hide.test(t)) p[g.key] = listOf(p, cur, g.key).concat([g.id])
    else if (g.show.test(t)) p[g.key] = listOf(p, cur, g.key).filter((x) => x !== g.id)
    else continue
    hit++
  }
  return hit
}

/** The no-AI parser (offline, AI down, signed out, and the palette's "Adjust look: …" check).
 *  Splits the wish with clausesOf(), maps each clause through the phrase rules, normalizes, and keeps
 *  only the keys that differ from `current`. A clause of ≥2 words that no rule understood is reported
 *  by its INDEX in clausesOf(text) (≤3), so the drawer can show the person's own words. Never throws;
 *  `current` is not changed. */
export function parseTweakLocal(text: unknown, current?: unknown): TweakResult {
  try {
    const cur = resolvePrefs(current)
    const p: Draft = {}
    const unsupported: number[] = []
    clausesOf(text).forEach((c, i) => {
      if (!tweakClause(c, p, cur) && c.split(/\s+/).length >= 2) unsupported.push(i)
    })
    const v = normalizePrefs(p).prefs as Record<string, unknown>
    const now = cur as unknown as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    for (const k of PREF_KEYS) if (has(v, k) && !same(v[k], now[k])) patch[k] = v[k]
    return { patch: patch as Partial<UiPrefs>, unsupported: unsupported.slice(0, LIMITS.unsupported) }
  } catch {
    return { patch: {}, unsupported: [] }
  }
}

/** A ui-tweak answer (from the model, or from the edge function in the browser) → the only shape
 *  anything downstream sees: `patch` normalized, `unsupported` = distinct integer clause indexes in
 *  [0, clauseCount), sorted, ≤6. Every other field (a `summary`, free text) is dropped. Never throws. */
export function normalizeTweak(raw: unknown, clauseCount: number): TweakResult {
  try {
    const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
    const patch = normalizePrefs(r.patch).prefs
    const n = Math.max(0, Math.min(LIMITS.clauses, Math.floor(Number(clauseCount) || 0)))
    const list = Array.isArray(r.unsupported) ? r.unsupported.slice(0, LIMITS.scan) : []
    const unsupported: number[] = []
    for (const x of list) if (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < n && unsupported.indexOf(x) < 0) unsupported.push(x)
    return { patch, unsupported: unsupported.sort((a, b) => a - b) }
  } catch {
    return { patch: {}, unsupported: [] }
  }
}

/** JSON Schema of a ui-tweak answer, built from ENUM / WIDGETS / NAV_IDS (so the model's allowed
 *  values can never drift from the normalizer). Standard lower-case JSON Schema; adapt the casing in
 *  the handler if the Gemini endpoint wants its OpenAPI subset. A fresh object each call. */
export function tweakJsonSchema(): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const k of ENUM_KEYS) props[k] = { type: 'string', enum: [...ENUM[k]] }
  for (const k of LIST_KEYS) {
    const ids = LIST_IDS[(LIST_RE.exec(k) as RegExpExecArray)[1]].filter((x) => !(k === 'nav_hidden' && x === 'home'))
    props[k] = { type: 'array', items: { type: 'string', enum: ids } }
  }
  props.pinned = { type: 'array', items: { type: 'string' }, maxItems: LIMITS.pins }
  return {
    type: 'object',
    properties: {
      patch: { type: 'object', properties: props },
      unsupported: { type: 'array', items: { type: 'integer' } },
    },
    required: ['patch', 'unsupported'],
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

function has(o: object, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k)
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const k of Object.keys(o as object)) deepFreeze((o as Record<string, unknown>)[k])
  }
  return o
}
