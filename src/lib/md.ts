// Frontmatter + markdown text helpers (no rendering: markdown → HTML lives in md-html.ts).
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export type Doc = { path: string; data: Record<string, any>; body: string }

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/** Split a markdown file into frontmatter properties + body. A leading byte-order mark (Windows editors, PowerShell
 *  Set-Content) is ignored, as next-core, people-core, prefs and the dev server already do. */
export function parse(path: string, raw: string): Doc {
  const text = String(raw ?? '')
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const m = src.match(FM)
  if (!m) return { path, data: {}, body: src }
  let data: Record<string, any> = {}
  try { data = parseYaml(m[1]) ?? {} } catch { data = {} }
  return { path, data: typeof data === 'object' && data ? data : {}, body: src.slice(m[0].length) }
}

export function serialize(data: Record<string, unknown>, body: string) {
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
  return `---\n${stringifyYaml(clean, { lineWidth: 0 }).trimEnd()}\n---\n\n${String(body || '').trim()}\n`
}

/** Body without its first "# Title" line (the page shows the title itself). */
export const stripH1 = (body: string) => body.replace(/^\s*#\s+.*\r?\n/, '')

export function title(doc: Doc) {
  return String(doc.data.title || doc.body.match(/^#\s+(.+)$/m)?.[1] || doc.path.split('/').pop()!.replace(/\.md$/i, ''))
}

/** Split a body at "## " headings → collapsible sections (outline mode). */
export function sections(body: string) {
  const out: { title: string; md: string }[] = []
  let cur = { title: '', md: '' }
  let inCode = false
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) inCode = !inCode
    const h = !inCode && line.match(/^##\s+(.*)$/)
    if (h) {
      if (cur.title || cur.md.trim()) out.push(cur)
      cur = { title: h[1].trim(), md: '' }
    } else cur.md += line + '\n'
  }
  if (cur.title || cur.md.trim()) out.push(cur)
  return out
}

/** Open "- [ ] ..." checkboxes in a doc, with the heading they sit under. */
export function openTasks(doc: Doc) {
  const out: { text: string; heading: string }[] = []
  let heading = ''
  let inCode = false
  for (const line of doc.body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) inCode = !inCode
    if (inCode) continue
    const h = line.match(/^#{1,4}\s+(.*)$/)
    if (h) heading = h[1].trim()
    const t = line.match(/^\s*[-*]\s+\[ \]\s+(.*)$/)
    if (t) out.push({ text: t[1].replace(/\*\*/g, '').trim(), heading })
  }
  return out
}

/** Resolve a relative link inside a doc ("../general.md") to a repo path. */
export function resolvePath(fromDoc: string, rel: string) {
  const parts = fromDoc.split('/').slice(0, -1)
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}
