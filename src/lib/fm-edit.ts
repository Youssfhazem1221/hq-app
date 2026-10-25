// Editing inside the app (HQ as a portfolio, phase 3): exact text edits for a note, so only the part a person changed
// moves and every other byte stays (CRLF kept). Pure and lazy: the Project page, the block editor and the upload
// panel import it; nothing here touches the network.
//   milestones: rename, set or clear a date, remove, move up / down (the `milestones:` block list of a project.md)
//   blocks: a note's body as top-level blocks (heading, paragraph, list, table, quote, code / chart / explainer)
//           with exact offsets; replace, insert, remove, move one block
//   uploads: safe file names and the folder a file goes to (STRUCTURE.md: notes in the folder, data/, media/)

/** A note changed while it was open: the edit is refused instead of overwriting someone's newer text. */
export class StalePartError extends Error {
  constructor(message = 'This part changed since you opened it. Reload the page and try again.') {
    super(message)
    this.name = 'StalePartError'
  }
}

const str = (v: unknown) => (v == null ? '' : String(v))
const linesOf = (src: string): string[] => [...(src.match(/[^\n]*\n|[^\n]+$/g) || [])]
const content = (l: string) => l.replace(/\r?\n$/, '')
const eolOf = (src: string) => (src.includes('\r\n') ? '\r\n' : '\n')
/** A YAML scalar for a milestone's text: always double-quoted (JSON escapes are valid YAML). */
const quote = (s: string) => JSON.stringify(s.replace(/[\r\n]+/g, ' ').trim())

// ---- milestones ---------------------------------------------------------------------------------------------------

type MsBlock = { lines: string[]; heads: number[]; end: number; dash: number }

/** The `milestones:` block list of a frontmatter: its item head lines (by the first dash column) and its end. */
function msBlock(text: string): MsBlock | null {
  const lines = linesOf(str(text))
  if (!lines.length || !/^﻿?---[ \t]*$/.test(content(lines[0]))) return null
  let close = -1
  for (let i = 1; i < lines.length; i++) if (/^---[ \t]*$/.test(content(lines[i]))) { close = i; break }
  if (close < 0) return null
  const start = lines.findIndex((l, i) => i > 0 && i < close && /^milestones[ \t]*:[ \t]*(#.*)?$/.test(content(l)))
  if (start < 0) return null
  let end = start + 1
  while (end < close && (content(lines[end]).trim() === '' || /^[ \t]+\S|^-( |$)/.test(content(lines[end])))) end++
  while (end > start + 1 && content(lines[end - 1]).trim() === '') end--
  const heads: number[] = []
  let dash = -1
  for (let i = start + 1; i < end; i++) {
    const m = content(lines[i]).match(/^([ \t]*)-( |$)/)
    if (!m) continue
    if (dash < 0) dash = m[1].length
    if (m[1].length === dash) heads.push(i)
  }
  return heads.length ? { lines, heads, end, dash } : null
}

const itemRange = (b: MsBlock, index: number): [number, number] | null =>
  index >= 0 && index < b.heads.length ? [b.heads[index], b.heads[index + 1] ?? b.end] : null

/** How many items the `milestones:` block list has (0 when it is missing or written inline). */
export const milestoneCount = (text: string) => msBlock(text)?.heads.length ?? 0

/** Rename a milestone and/or set its date (`date: null` removes the date line). Only that item's lines change. */
export function editMilestone(text: string, index: number, patch: { text?: string; date?: string | null }): string {
  const src = str(text)
  const b = msBlock(src)
  const r = b && itemRange(b, index)
  if (!b || !r) return src
  const eol = eolOf(src)
  const out = b.lines.slice()
  const [from, to] = r
  const body = (i: number) => (i === from ? content(out[i]).slice(b.dash + 2) : content(out[i]).trimStart())
  const indent = ' '.repeat(b.dash + 2)
  let changed = false
  if (patch.text !== undefined) {
    const t = str(patch.text).trim()
    if (!t) return src
    for (let i = from; i < to; i++) {
      if (!/^text[ \t]*:/.test(body(i))) continue
      const next = out[i].replace(/(text[ \t]*:[ \t]*)(.*?)(\r?\n)?$/, (_m, k: string, _v: string, nl: string | undefined) => k + quote(t) + (nl ?? ''))
      if (next !== out[i]) (out[i] = next), (changed = true)
      break
    }
  }
  if (patch.date !== undefined) {
    const at = out.slice(from, to).findIndex((_, k) => /^date[ \t]*:/.test(body(from + k)))
    const d = patch.date === null ? null : str(patch.date).trim()
    if (d !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return src
    if (at >= 0 && d === null) (out.splice(from + at, 1), (changed = true))
    else if (at >= 0 && d) {
      const next = out[from + at].replace(/(date[ \t]*:[ \t]*)(.*?)(\r?\n)?$/, (_m, k: string, _v: string, nl: string | undefined) => k + d + (nl ?? ''))
      if (next !== out[from + at]) (out[from + at] = next), (changed = true)
    } else if (at < 0 && d) {
      // after the text line (the head when it is "- text: …")
      const tl = out.slice(from, to).findIndex((_, k) => /^text[ \t]*:/.test(body(from + k)))
      const pos = from + (tl >= 0 ? tl : 0) + 1
      const line = `${indent}date: ${d}${eol}`
      if (!/\r?\n$/.test(out[pos - 1])) out[pos - 1] += eol
      out.splice(pos, 0, line)
      changed = true
    }
  }
  return changed ? out.join('') : src
}

/** Remove one milestone (all of its lines). */
export function removeMilestone(text: string, index: number): string {
  const src = str(text)
  const b = msBlock(src)
  const r = b && itemRange(b, index)
  if (!b || !r) return src
  const out = b.lines.slice()
  out.splice(r[0], r[1] - r[0])
  // the list's last item went: the block keeps its key with an empty list
  if (b.heads.length === 1) {
    const k = out.findIndex((l) => /^milestones[ \t]*:[ \t]*(#.*)?$/.test(content(l)))
    if (k >= 0) out[k] = out[k].replace(/^milestones[ \t]*:[ \t]*(#.*)?(\r?\n)?$/, (_m, _c, nl: string | undefined) => 'milestones: []' + (nl ?? ''))
  }
  const joined = out.join('')
  return /\r?\n$/.test(src) && !/\r?\n$/.test(joined) ? joined + eolOf(src) : joined
}

/** Move one milestone up (-1) or down (+1); at either end nothing changes. */
export function moveMilestone(text: string, index: number, dir: -1 | 1): string {
  const src = str(text)
  const b = msBlock(src)
  const j = index + dir
  const a = b && itemRange(b, Math.min(index, j))
  const c = b && itemRange(b, Math.max(index, j))
  if (!b || !a || !c || index < 0 || j < 0) return src
  const eol = eolOf(src)
  const seg = (r: [number, number]) => {
    const part = b.lines.slice(r[0], r[1])
    if (part.length && !/\r?\n$/.test(part[part.length - 1])) part[part.length - 1] += eol
    return part
  }
  const out = [...b.lines.slice(0, a[0]), ...seg(c), ...seg(a), ...b.lines.slice(c[1])]
  const joined = out.join('')
  return /\r?\n$/.test(src) ? joined : joined.replace(/\r?\n$/, '')
}

// ---- blocks --------------------------------------------------------------------------------------------------------

export type BlockKind = 'heading' | 'para' | 'list' | 'table' | 'quote' | 'code' | 'chart' | 'explainer' | 'rule' | 'html'
export type Block = { start: number; end: number; src: string; kind: BlockKind }

/** Where the body starts: after the frontmatter's closing --- line (0 when there is none). */
export function bodyStart(text: string): number {
  const src = str(text)
  const m = src.match(/^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/)
  return m ? m[0].length : 0
}

const kindOf = (first: string): BlockKind => {
  const l = first.trim()
  if (/^#{1,6}\s/.test(l)) return 'heading'
  const f = l.match(/^(`{3,}|~{3,})\s*([\w-]*)/)
  if (f) return f[2] === 'chart' ? 'chart' : f[2] === 'explainer' ? 'explainer' : 'code'
  if (/^([-*+]|\d+[.)])\s/.test(l)) return 'list'
  if (/^\|/.test(l)) return 'table'
  if (/^>/.test(l)) return 'quote'
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(l)) return 'rule'
  if (/^<[a-z!]/i.test(l)) return 'html'
  return 'para'
}

/** A note's body as top-level blocks, each with its exact source and offsets in the whole text. Blank lines separate
 *  blocks; a heading is always its own block; a fenced block (```chart / ```explainer / code) stays whole. */
export function splitBlocks(text: string): Block[] {
  const src = str(text)
  const out: Block[] = []
  let at = bodyStart(src)
  let cur: { start: number; end: number } | null = null
  let fence: { ch: string; n: number } | null = null
  const push = () => {
    if (cur) out.push({ start: cur.start, end: cur.end, src: src.slice(cur.start, cur.end), kind: kindOf(src.slice(cur.start, src.indexOf('\n', cur.start) < 0 ? cur.end : src.indexOf('\n', cur.start))) })
    cur = null
  }
  while (at < src.length) {
    const nl = src.indexOf('\n', at)
    const lineEnd = nl < 0 ? src.length : nl
    const line = src.slice(at, lineEnd).replace(/\r$/, '')
    const contentEnd = at + line.length
    if (fence) {
      cur!.end = contentEnd
      const close = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/)
      if (close && close[1][0] === fence.ch && close[1].length >= fence.n) (fence = null), push()
    } else {
      const open = line.match(/^\s{0,3}(`{3,}|~{3,})/)
      if (line.trim() === '') push()
      else if (open) {
        push()
        cur = { start: at, end: contentEnd }
        fence = { ch: open[1][0], n: open[1].length }
      } else if (/^\s{0,3}#{1,6}\s/.test(line)) {
        push()
        cur = { start: at, end: contentEnd }
        push()
      } else if (cur) cur.end = contentEnd
      else cur = { start: at, end: contentEnd }
    }
    at = nl < 0 ? src.length : nl + 1
  }
  push()
  return out
}

const check = (text: string, b: Block) => {
  if (str(text).slice(b.start, b.end) !== b.src) throw new StalePartError()
}

/** Replace one block's text (an empty text removes it). */
export function replaceBlock(text: string, b: Block, next: string): string {
  const src = str(text)
  check(src, b)
  const t = str(next).replace(/\r\n/g, '\n').replace(/\s+$/, '').replace(/\n/g, eolOf(src))
  if (!t.trim()) return removeBlock(src, b)
  return src.slice(0, b.start) + t + src.slice(b.end)
}

/** Remove one block and the blank lines after it (the blank line before it then separates its neighbours). */
export function removeBlock(text: string, b: Block): string {
  const src = str(text)
  check(src, b)
  let after = b.end
  while (after < src.length && (src[after] === '\n' || src[after] === '\r')) after++
  let before = b.start
  if (after >= src.length) {
    // the last block: what is left before it ends with exactly one line end
    while (before > 0 && (src[before - 1] === '\n' || src[before - 1] === '\r')) before--
    const head = src.slice(0, before)
    return head ? head + eolOf(src) : ''
  }
  return src.slice(0, before) + src.slice(after)
}

/** Insert a new block after `b` (or at the end of the note when `b` is null), separated by one blank line. */
export function insertBlock(text: string, b: Block | null, next: string): string {
  const src = str(text)
  const eol = eolOf(src)
  const t = str(next).replace(/\r\n/g, '\n').trim().replace(/\n/g, eol)
  if (!t) return src
  if (b) {
    check(src, b)
    return src.slice(0, b.end) + eol + eol + t + src.slice(b.end)
  }
  const base = src.replace(/\s+$/, '')
  const body = base.length > bodyStart(src) || bodyStart(src) === 0 ? base + eol + eol : base + eol
  return (base ? body : '') + t + eol
}

/** Move block `i` up (-1) or down (+1) by swapping it with its neighbour; the blank lines between stay. */
export function moveBlock(text: string, blocks: Block[], i: number, dir: -1 | 1): string {
  const src = str(text)
  const j = i + dir
  if (i < 0 || j < 0 || i >= blocks.length || j >= blocks.length) return src
  const [a, c] = i < j ? [blocks[i], blocks[j]] : [blocks[j], blocks[i]]
  check(src, a)
  check(src, c)
  return src.slice(0, a.start) + c.src + src.slice(a.end, c.start) + a.src + src.slice(c.end)
}

// ---- uploads -------------------------------------------------------------------------------------------------------

/** Text files an upload saves as text (one policy-checked commit each); media files go up as bytes. */
export const UPLOAD_TEXT = new Set(['md', 'json', 'csv', 'tsv', 'txt', 'html'])
export const UPLOAD_BYTES = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg', 'mp3', 'wav', 'm4a', 'ogg', 'mp4', 'webm', 'mov'])
/** Largest upload: text as the write policy allows (200 KB), images 25 MB, audio and video 50 MB. */
export const uploadMax = (ext: string) => (UPLOAD_TEXT.has(ext) ? 200_000 : /^(mp3|wav|m4a|ogg|mp4|webm|mov)$/.test(ext) ? 50_000_000 : 25_000_000)

const extOf = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() || ''

/** "My Notes (v2).MD" → "my-notes-v2.md": letters, digits, dot, dash and underscore only, ≤ 80 characters. */
export function safeFileName(name: string): string {
  const base = str(name).split(/[\\/]/).pop() || ''
  const ext = extOf(base)
  const stem = (ext ? base.slice(0, -(ext.length + 1)) : base)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 70)
  return (stem || 'file') + (ext ? '.' + ext : '')
}

/** The folder a file goes to inside its project (STRUCTURE.md): notes and pages in the folder itself, data in data/,
 *  pictures, video and audio in media/. '' = the project folder. null = not a kind HQ uploads. */
export function uploadFolder(name: string): string | null {
  const ext = extOf(name)
  if (ext === 'md' || ext === 'html') return ''
  if (['json', 'csv', 'tsv', 'txt'].includes(ext)) return 'data'
  if (UPLOAD_BYTES.has(ext)) return 'media'
  return null
}

/** The repo path an upload is saved at, or null when the folder or name is not allowed. */
export function uploadPath(slug: string, name: string, folder?: string | null): string | null {
  const s = str(slug)
  if (!/^[\w.-]+$/.test(s) || s.startsWith('.')) return null
  const file = safeFileName(name)
  const ext = extOf(file)
  if (!UPLOAD_TEXT.has(ext) && !UPLOAD_BYTES.has(ext)) return null
  const dir = str(folder ?? uploadFolder(file) ?? '').trim().replace(/^\/+|\/+$/g, '')
  if (dir && (dir.split('/').some((p) => !p || p === '.' || p === '..' || p.startsWith('.')) || !/^[\w./-]+$/.test(dir))) return null
  if (file === 'project.md' && !dir) return null
  return `projects/${s}/${dir ? dir + '/' : ''}${file}`
}
