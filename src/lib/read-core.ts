// Read + talk pages (module C2): the pure rules behind Board, the Docs reader, the Explain panel and Ask AI.
// Zero imports, erasable TypeScript (node tests import it as-is). No React, no app state, never throws.

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
const lower = (v: unknown) => str(v).trim().toLowerCase()
const same = (a: unknown, b: unknown) => !!str(a).trim() && lower(a) === lower(b)
const isTrue = (v: unknown) => v === true || lower(v) === 'true'

/** Leading emoji, symbols and spaces ("🧠 RAG index" → "RAG index"). Letters, digits and markdown marks stay. */
export const stripLeadingSymbols = (s: unknown) => str(s).replace(/^[^\p{L}\p{N}*_`[(#"'“]+/u, '').trim()

/** Inline markdown → plain text: links keep their text, emphasis and code marks go, citations keep the path. */
export function plainInline(md: unknown): string {
  return str(md)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/** First sentence of a plain line, at most `n` characters (with an ellipsis). */
export function firstSentence(text: unknown, n = 110): string {
  const t = str(text).trim()
  const m = t.match(/^(.+?[.!?])(\s|$)/)
  const s = (m ? m[1] : t).trim()
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s
}

// =====================================================================================================================
// Board
// =====================================================================================================================

export const POST_TYPES = ['idea', 'thought', 'question', 'update'] as const
export type PostType = (typeof POST_TYPES)[number]

/** The post type guessed from what was typed (spec §6.6). Idea openers first ("what if…?" is an idea), then a question
 *  mark or a question word, then update words; anything else is a thought. */
export function detectType(text: unknown): PostType {
  const s = lower(text)
  if (!s) return 'thought'
  if (/^(idea\b|what if\b|maybe\b|we could\b|we should\b|let'?s\b|how about\b|wouldn'?t it be)/.test(s)) return 'idea'
  if (/\?\s*$/.test(s) || /^(how|what|why|who|when|where|which|can|could|should|would|is|are|do|does|did|will|any)\b/.test(s)) return 'question'
  if (/^(done|shipped|fixed|update|finished|released|merged|launched|deployed)\b/.test(s)) return 'update'
  return 'thought'
}

/** The three steps a post flagged for Claude goes through (spec §4 Tracker). */
export const TRACKER_STEPS = ['posted', 'picked up', 'replied'] as const
/** 1 = posted, waiting to be picked up · 2 = picked up, Claude is working on it · 3 = replied. The step at the index is
 *  the current one (`cur`); steps before it are done (`on`). -1 = the composer preview (nothing yet). */
export type TrackerStage = -1 | 1 | 2 | 3

export type BridgeSeen = { state?: unknown; id?: unknown; seen?: number } | null | undefined

/** Where a flagged post is. `replied` = a reply by Claude (or through the bridge) exists. The doorbell's bridge events
 *  move it before the files arrive: `working` with this post's id → 2, `done` with this post's id → 3. The bridge
 *  names a post by its file name, so both the id and the file's base name match. */
export function trackerStage(
  post: { id: unknown; path?: unknown; status?: unknown; closedBy?: unknown },
  replied: boolean,
  bridge: BridgeSeen,
  working: { id?: unknown } | null | undefined,
): 1 | 2 | 3 {
  if (replied) return 3
  if (lower(post.status) === 'done' && same(post.closedBy, 'claude')) return 3
  const base = str(post.path).split('/').pop()!.replace(/\.md$/i, '')
  const mine = (x: unknown) => !!str(x) && (str(x) === str(post.id) || str(x) === base)
  if (bridge && lower(bridge.state) === 'done' && mine(bridge.id)) return 3
  if (working && mine(working.id)) return 2
  return 1
}

/** A reply that counts as Claude's answer to a flagged post. */
export const isClaudeReply = (data: Record<string, unknown> | undefined) => !!data && (same(data.author, 'claude') || lower(data.via) === 'bridge')

export type BridgeChipView = 'neutral' | 'online' | 'working' | 'offline'
export const BRIDGE_SEEN_MS = 3 * 60_000
export const BRIDGE_WORKING_MAX_MS = 20 * 60_000

/** The bridge chip (spec C2): neutral "Claude bridge" until the first heartbeat, never a "Checking…" phase. Online or
 *  working while the last heartbeat is under 3 minutes old; offline after an `offline` event or when it went quiet. */
export function bridgeChipView(
  bell: { bridge?: { state?: unknown; seen?: number } | null; working?: { since?: number } | null } | null | undefined,
  now: number,
): BridgeChipView {
  const b = bell?.bridge
  if (!b || typeof b.seen !== 'number') return 'neutral'
  if (lower(b.state) === 'offline' || now - b.seen >= BRIDGE_SEEN_MS) return 'offline'
  const w = bell?.working
  if (w && typeof w.since === 'number' && now - w.since < BRIDGE_WORKING_MAX_MS) return 'working'
  return 'online'
}

export type HowStep = { title: string; text: string }

/** The welcome post's numbered steps as a picture (spec §6.6 "welcome = 3-step picture"): a lead line, then 2–6 items
 *  like "1. ✍️ **Write a post**: an idea, a thought…". null when the body isn't shaped like that (it then renders as
 *  plain markdown). */
export function howSteps(body: unknown): { lead: string; steps: HowStep[] } | null {
  const lines = str(body).replace(/\r\n?/g, '\n').split('\n')
  const lead: string[] = []
  const steps: HowStep[] = []
  let inList = false
  for (const raw of lines) {
    const line = raw.trim()
    const item = line.match(/^\d+[.)]\s+(.*)$/)
    if (item) {
      inList = true
      const t = stripLeadingSymbols(item[1])
      const bold = t.match(/^\*\*(.+?)\*\*\s*[:—–-]?\s*(.*)$/)
      const [title, text] = bold ? [bold[1], bold[2]] : t.split(/\s*[:—–]\s+/, 2).concat('').slice(0, 2)
      if (!plainInline(title)) return null
      steps.push({ title: plainInline(title).replace(/[.:]$/, ''), text: plainInline(text) })
      continue
    }
    if (!line) continue
    if (inList) return null
    lead.push(line)
  }
  if (steps.length < 2 || steps.length > 6) return null
  return { lead: stripLeadingSymbols(lead.join(' ')), steps }
}

/** Prefill for the Board composer (e.g. "Post to board" from an AI answer). The Board reads and clears it on mount. */
export const BOARD_PREFILL_KEY = 'hq.boardPrefill'
export type BoardPrefill = { body?: string; type?: PostType; to?: string; project?: string; forClaude?: boolean }

export type BoardFilter = 'all' | 'me' | 'claude'
type PostLike = { path?: string; data: Record<string, unknown> }
const isOpen = (p: PostLike) => lower(p.data.status) !== 'done'

/** Which posts each filter chip shows. "To me" and "For Claude" count open posts only. */
export function postMatches(p: PostLike, f: BoardFilter, me: string) {
  if (f === 'me') return isOpen(p) && same(p.data.to, me)
  if (f === 'claude') return isOpen(p) && isTrue(p.data.for_claude)
  return true
}
/** Counts behind the filter chips: All · n always; To me and For Claude only appear when > 0. */
export function boardCounts(posts: PostLike[], me: string) {
  const n = (f: BoardFilter) => posts.filter((p) => postMatches(p, f, me)).length
  return { all: posts.length, me: n('me'), claude: n('claude') }
}

/** For-you items (people-core forYou) the Board may lead with: requests on my projects, posts to me, replies to me. */
export const BOARD_NEXT_KINDS = ['join', 'leave', 'to-me', 'reply'] as const
type ForYouLike = { kind: string; path: string; title?: string; from?: string; since?: string; project?: string; part?: string }
export type BoardNextItem = { kind: 'join' | 'help'; id: string; text: string; path: string; project?: string; from?: string; since?: string }

/** Board's Next (spec §6.6: only a real item): the first board-shaped For-you item, in the shared resolver's words and
 *  ids ('post:<path>', 'reply:<path>'). Join/leave → Review (kind 'join'); a post or reply to me → Open (kind 'help'). */
export function boardNextItem(items: ForYouLike[], nameOf: (login: string) => string = (l) => l, projectTitle: (slug: string) => string = (s) => s): BoardNextItem | null {
  const fy = (items || []).find((x) => x && (BOARD_NEXT_KINDS as readonly string[]).includes(x.kind) && x.path)
  if (!fy) return null
  const who = nameOf(str(fy.from)) || str(fy.from) || 'Someone'
  const pt = fy.project ? projectTitle(fy.project) || fy.project : ''
  const title = firstLine(stripLeadingSymbols(fy.title), 90)
  const text =
    fy.kind === 'join' ? `${who} asks to join ${pt} as ${fy.part || 'a member'}`
      : fy.kind === 'leave' ? `${who} asks to leave ${pt}`
        : fy.kind === 'reply' ? `${who} replied to your post “${firstLine(title, 60)}”`
          : `${who} → you: ${title}`
  const item: BoardNextItem = { kind: fy.kind === 'join' || fy.kind === 'leave' ? 'join' : 'help', id: (fy.kind === 'reply' ? 'reply:' : 'post:') + fy.path, text, path: fy.path }
  if (fy.project) item.project = fy.project
  if (fy.from) item.from = fy.from
  if (fy.since) item.since = fy.since
  return item
}

export type RequestCard ={ kind: 'join' | 'leave'; who: string; project: string; part: string; open: boolean; mine: boolean }

/** A join/leave request post as a card. `mine` = it is addressed to me AND I own the project (only then the owner
 *  buttons show). `owners` = project slug → owner login. */
export function requestCard(p: PostLike, me: string, owners: Map<string, string>): RequestCard | null {
  const kind = lower(p.data.request)
  if (kind !== 'join' && kind !== 'leave') return null
  const project = str(p.data.project).trim()
  return {
    kind,
    who: str(p.data.author).trim(),
    project,
    part: str(p.data.part).trim(),
    open: isOpen(p),
    mine: same(p.data.to, me) && same(owners.get(project), me),
  }
}

// =====================================================================================================================
// Docs reader
// =====================================================================================================================

export type DocSection = { id: string; title: string; md: string; summary: string }
export type DocOutline = { intro: string; sections: DocSection[]; long: boolean }
/** A doc with this many `##` sections or more is "long": sections after the first OPEN_SECTIONS start collapsed. */
export const LONG_SECTIONS = 6
export const OPEN_SECTIONS = 3

/** "🚦 v2 at a glance" → "v2-at-a-glance" (unique within `used`). */
export function sectionId(title: string, used: Set<string>) {
  const base =
    'sec-' +
    (stripLeadingSymbols(plainInline(title))
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'part')
  let id = base
  for (let i = 2; used.has(id); i++) id = `${base}-${i}`
  used.add(id)
  return id
}

/** One-line summary of a markdown section: its first sentence of plain text (headings, tables, code and quotes
 *  skipped). '' when the section has no prose. */
export function oneLine(md: unknown, n = 110): string {
  let inCode = false
  for (const raw of str(md).replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (/^```/.test(line)) {
      inCode = !inCode
      continue
    }
    if (inCode || !line || /^(#|\||>|-{3,}|<)/.test(line)) continue
    const text = plainInline(line.replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, ''))
    const clean = stripLeadingSymbols(text)
    if (clean.length >= 3) return firstSentence(clean, n)
  }
  return ''
}

/** A doc body (H1 already stripped) → the intro before the first `##`, the `##` sections and whether it's long. */
export function docOutline(body: unknown): DocOutline {
  const used = new Set<string>()
  const sections: DocSection[] = []
  let intro = ''
  let cur: { title: string; md: string } | null = null
  let inCode = false
  for (const line of str(body).replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) inCode = !inCode
    const h = !inCode && line.match(/^##\s+(.+?)\s*#*\s*$/)
    if (h) {
      if (cur) sections.push({ id: sectionId(cur.title, used), title: cur.title, md: cur.md, summary: oneLine(cur.md) })
      cur = { title: h[1], md: '' }
    } else if (cur) cur.md += line + '\n'
    else intro += line + '\n'
  }
  if (cur) sections.push({ id: sectionId(cur.title, used), title: cur.title, md: cur.md, summary: oneLine(cur.md) })
  return { intro: intro.trim(), sections, long: sections.length >= LONG_SECTIONS }
}

/** Heading text for display: leading emoji dropped, inline marks removed. */
export const headingText = (title: unknown) => stripLeadingSymbols(plainInline(title)) || plainInline(title)

export type MdTable = { header: string[]; rows: string[][] }
export type TablePart = { kind: 'md'; text: string } | { kind: 'table'; table: MdTable; raw: string }

const SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
/** "| a | b \| c |" → ['a', 'b | c'] */
export function tableCells(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && t[i + 1] === '|') {
      cur += '|'
      i++
    } else if (t[i] === '|') {
      out.push(cur.trim())
      cur = ''
    } else cur += t[i]
  }
  out.push(cur.trim())
  return out
}

/** Markdown → plain parts and GFM tables, in order (tables inside code fences stay text). */
export function splitTables(md: unknown): TablePart[] {
  const lines = str(md).replace(/\r\n?/g, '\n').split('\n')
  const out: TablePart[] = []
  let buf: string[] = []
  let inCode = false
  const flush = () => {
    if (buf.join('\n').trim()) out.push({ kind: 'md', text: buf.join('\n') })
    buf = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*```/.test(line)) inCode = !inCode
    if (!inCode && line.includes('|') && i + 1 < lines.length && SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = tableCells(line)
      const rows: string[][] = []
      let j = i + 2
      for (; j < lines.length && lines[j].includes('|') && lines[j].trim(); j++) {
        const cells = tableCells(lines[j])
        rows.push(header.map((_, k) => cells[k] ?? ''))
      }
      flush()
      out.push({ kind: 'table', table: { header, rows }, raw: lines.slice(i, j).join('\n') })
      i = j - 1
      continue
    }
    buf.push(line)
  }
  flush()
  return out
}

const MARK = /[✅⚠❌\u{1f4ad}\u{1f534}\u{1f7e1}\u{1f7e2}]/u
const STATUS_HEAD = /^(state|status|live\??|health|works\??)$/i
export type StatusRow = { name: string; line: string; cell: string; word: string; worst: 'ok' | 'warn' | 'bad' | 'idea' | null }

/** A ✅/⚠️ status table (spec §6.6 "status boards for ✅/⚠️ tables"): 2–16 rows, ≤4 columns, a column headed
 *  State/Status whose every cell carries a status mark. Evidence tables ("Source" columns) stay tables. The worst
 *  mark in a cell wins (❌ > ⚠️ > 💭 > ✅); `word` = the short phrase after the first mark when there is one mark. */
export function statusRows(t: MdTable): StatusRow[] | null {
  if (!t || t.rows.length < 2 || t.rows.length > 16 || t.header.length < 2 || t.header.length > 4) return null
  const col = t.header.findIndex((h, i) => i > 0 && STATUS_HEAD.test(headingText(h)))
  if (col < 0 || !t.rows.every((r) => MARK.test(r[col] || ''))) return null
  return t.rows.map((r) => {
    const cell = r[col] || ''
    const worst = /[❌\u{1f534}]/u.test(cell) ? 'bad' : /[⚠\u{1f7e1}]/u.test(cell) ? 'warn' : /\u{1f4ad}/u.test(cell) ? 'idea' : /[✅\u{1f7e2}]/u.test(cell) ? 'ok' : null
    const marks = (cell.match(new RegExp(MARK.source, 'gu')) || []).length
    const after = plainInline(cell.replace(MARK, '').replace(/️/g, '')).split(/[:·(,;]/)[0].trim()
    const word = marks === 1 && after.length && after.length <= 16 ? after : ''
    const others = r.filter((_, k) => k !== 0 && k !== col).map((c) => plainInline(c)).filter(Boolean)
    return { name: headingText(r[0]), line: firstSentence(others.join(' · '), 90), cell, word, worst }
  })
}

/** A table is "wide" (cards on phone) from 3 columns. */
export const isWide = (t: MdTable) => t.header.length >= 3

// =====================================================================================================================
// Ask AI + Explain panel
// =====================================================================================================================

export type AnswerSource = { path?: string; url?: string; title?: string }
export type AnswerVisual = { lang: 'chart' | 'explainer'; src: string; raw: string }
/** An answer in the spec's anatomy (§6.5): lead → one visual → bullets (≤3 shown) → Next → numbered sources. `rest`
 *  keeps everything else (tables, extra paragraphs, later blocks), so nothing the model wrote is lost. */
export type AnswerParts = { lead: string; visual: AnswerVisual | null; bullets: string[]; rest: string; next: string; sources: AnswerSource[] }
export const SHOWN_BULLETS = 3

const FENCE_OPEN = /^\s*```\s*([\w-]*)/
const LIST_ITEM = /^([-*+]|\d+[.)])\s+/

/** Repo path from a Sources link ("../../investigations/01.md" → "investigations/01.md"). */
const cleanPath = (href: string) => href.replace(/^(\.\.?\/)+/, '').replace(/^\//, '').split('#')[0]

/** The "---\n**Sources**" list the AI appends: file paths and web links, deduped, in order. */
export function parseSources(block: unknown): AnswerSource[] {
  const out: AnswerSource[] = []
  const seen = new Set<string>()
  for (const line of str(block).split(/\r?\n/)) {
    const m = line.match(/\[([^\]]+)\]\(([^)\s]+)\)/)
    if (!m) continue
    const [, text, href] = m
    const src: AnswerSource = /^https?:/i.test(href) ? { url: href, title: plainInline(text) } : { path: /\.md$/i.test(text) ? text.trim() : cleanPath(href) }
    const key = src.url || src.path || ''
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(src)
  }
  return out
}

/** Split an answer's markdown into the anatomy parts. Total: any text gives a result; an answer with no lead and no
 *  bullets keeps everything in `rest` (it renders as plain markdown). */
/** An answer file's "Proposed changes" block (Ask AI changes; lib/ai-changes.ts reads it for the Apply cards). */
const CHANGES_BLOCK = /\n[ \t]*-{3,}[ \t]*\n+[ \t]*\*\*Proposed changes\*\*[^\n]*\n+```hq-changes[ \t]*\n[^\n]*\n```[ \t]*(?:\n|$)/

/** An answer without its "Proposed changes" block: the block is data for the Apply cards, never shown as text. */
export const stripChanges = (md: unknown) => str(md).replace(/\r\n?/g, '\n').replace(CHANGES_BLOCK, '\n')

export function answerParts(md: unknown): AnswerParts {
  let text = stripChanges(md)
  let sources: AnswerSource[] = []
  const src = text.match(/\n-{3,}[ \t]*\n+[ \t]*\*\*Sources\*\*[^\n]*\n([\s\S]*)$/)
  if (src) {
    sources = parseSources(src[1])
    text = text.slice(0, src.index)
  }
  // blocks: paragraphs / lists / headings / fences, separated by blank lines (fences kept whole)
  type Block = { kind: 'p' | 'list' | 'h' | 'fence' | 'other'; text: string; lang?: string }
  const blocks: Block[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const f = line.match(FENCE_OPEN)
    if (f) {
      let j = i + 1
      while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) j++
      blocks.push({ kind: 'fence', lang: f[1].toLowerCase(), text: lines.slice(i, Math.min(j + 1, lines.length)).join('\n') })
      i = j
      continue
    }
    if (/^#{1,6}\s/.test(line)) {
      blocks.push({ kind: 'h', text: line })
      continue
    }
    let j = i
    const chunk: string[] = []
    while (j < lines.length && lines[j].trim() && !FENCE_OPEN.test(lines[j]) && !/^#{1,6}\s/.test(lines[j])) chunk.push(lines[j++])
    i = j - 1
    const first = chunk[0].trim()
    blocks.push({ kind: LIST_ITEM.test(first) ? 'list' : /^(\||>)/.test(first) ? 'other' : 'p', text: chunk.join('\n') })
  }
  // Next: the last "**Next:** …" line (anywhere in a paragraph or list)
  let next = ''
  for (let b = blocks.length - 1; b >= 0 && !next; b--) {
    if (blocks[b].kind === 'fence') continue
    const ls = blocks[b].text.split('\n')
    const k = ls.findIndex((l) => /^\s*(?:[-*+]\s+)?(?:\*\*|__)?Next:?(?:\*\*|__)?:?\s+\S/i.test(l))
    if (k < 0) continue
    next = ls[k].replace(/^\s*(?:[-*+]\s+)?(?:\*\*|__)?Next:?(?:\*\*|__)?:?\s+/i, '').trim()
    ls.splice(k, 1)
    blocks[b] = { ...blocks[b], text: ls.join('\n') }
    if (!blocks[b].text.trim()) blocks.splice(b, 1)
  }
  const used = new Set<number>()
  const leadAt = blocks.findIndex((b) => b.kind === 'p')
  const lead = leadAt >= 0 && leadAt <= 1 ? blocks[leadAt].text.replace(/\s*\n\s*/g, ' ').trim() : ''
  if (lead) used.add(leadAt)
  const visAt = blocks.findIndex((b) => b.kind === 'fence' && (b.lang === 'chart' || b.lang === 'explainer') && /\n\s*```\s*$/.test(b.text))
  let visual: AnswerVisual | null = null
  if (visAt >= 0) {
    const b = blocks[visAt]
    visual = { lang: b.lang as 'chart' | 'explainer', src: b.text.split('\n').slice(1, -1).join('\n'), raw: b.text }
    used.add(visAt)
  }
  const listAt = blocks.findIndex((b) => b.kind === 'list')
  const bullets: string[] = []
  if (listAt >= 0 && (lead || visual)) {
    for (const l of blocks[listAt].text.split('\n')) {
      if (LIST_ITEM.test(l)) bullets.push(l.replace(LIST_ITEM, '').trim())
      else if (bullets.length) bullets[bullets.length - 1] += ' ' + l.trim()
    }
    used.add(listAt)
    // a heading right above the list ("### Key takeaways") is a label for it: dropped with it
    if (listAt > 0 && blocks[listAt - 1].kind === 'h' && !used.has(listAt - 1)) used.add(listAt - 1)
  }
  const rest = blocks
    .filter((_, i) => !used.has(i))
    .map((b) => b.text)
    .join('\n\n')
    .trim()
  return { lead, visual, bullets, rest, next, sources }
}

/** The status line while an answer streams (spec §6.5 "status line per stage"): the server's stage text, repo paths
 *  shown as page titles; "Writing the answer" once words arrive. '' when there is nothing to say. */
export function stageText(state: unknown, status: unknown, hasText: boolean, titleOf: (path: string) => string = (p) => p): string {
  const st = lower(state)
  const s = str(status).trim()
  if (st === 'waiting') return s || 'GitHub Actions is answering (about a minute)'
  if (st !== 'streaming') return ''
  if (hasText && (!s || /^(thinking|connecting)$/i.test(s))) return 'Writing the answer'
  const pretty = s.replace(/[\w./-]+\.md\b/g, (p) => titleOf(p) || p)
  return pretty || 'Connecting'
}

/** "Compare the 5 money options visually." → "compare-5-money-options-visually" (≤40 chars, 'answer' when empty). */
export function topicSlug(q: unknown): string {
  const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'for', 'and', 'or', 'in', 'on', 'my', 'me', 'is', 'are', 'what', 'how', 'about', 'with', 'please', 'show', 'can', 'you', 'i', 'it', 'this', 'that'])
  const words = lower(q)
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w && !STOP.has(w))
  let out = ''
  for (const w of words) {
    if ((out ? out.length + 1 : 0) + w.length > 40) break
    out = out ? out + '-' + w : w
    if (out.split('-').length >= 6) break
  }
  return out || 'answer'
}

export const PROJECT_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/i

/** Where "Save to project" writes (spec §5.2): projects/<slug>/explainer-<topic>.md. null for a bad slug. */
export function explainerPath(slug: unknown, question: unknown): string | null {
  const s = str(slug).trim()
  return PROJECT_SLUG.test(s) ? `projects/${s}/explainer-${topicSlug(question)}.md` : null
}

/** The question "Explain this page" asks. Its first line names the new chat after the page. */
export function explainQuestion(title: unknown, path: unknown) {
  const t = plainInline(title).slice(0, 80) || str(path)
  return `About “${t}”\nExplain ${str(path)} for me: the main point in one sentence first, then one picture (an explainer or chart) if the page describes a process, structure, options, dates or numbers, then at most 3 bullets.`
}

/** True for a question made by explainQuestion() (its bubble shows only the first line; the rest is the instruction). */
export const isExplainQuestion = (q: unknown) => /^About “[^\n]+”\r?\nExplain [^\n]+ for me: /.test(str(q))

/** First line of a question, for chat titles. */
export const firstLine = (s: unknown, n = 70) => (str(s).trim().split(/\r?\n/)[0] || '').slice(0, n)
