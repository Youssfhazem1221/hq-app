// Web pages in the repo, previewed live. The viewer draws them in a sandboxed frame (allow-scripts only): scripts run,
// but in an opaque origin, with no access to this app, its storage or the GitHub token. The frame also gets no network
// except Google Fonts (PREVIEW_CSP). So the page's own local stylesheets, scripts and images are put inline here first,
// read through the Source. That is how the code-drawn Shorts (videos/<n>/index.html + kit/engine/*) play inside HQ.
// Pure apart from the IO it is handed; string work only (no DOM), so it runs in tests too.
import { resolvePath } from './md'

export type PreviewIO = {
  has: (path: string) => boolean
  size: (path: string) => number
  text: (path: string) => Promise<string | null>
  bytes: (path: string) => Promise<Blob | null>
}
export type Preview = { doc: string; inlined: string[]; missing: string[]; skipped: string[] }

/** The frame's own policy (on top of the app's, which it inherits): inline code only, Google Fonts, data:/blob: media. */
export const PREVIEW_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com data:; img-src data: blob:; media-src data: blob:"
const MAX_TEXT = 2_000_000
const MAX_IMAGE = 3_000_000
const MAX_TOTAL = 12_000_000
const IMAGE_TYPE: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml' }

const isLocal = (url: string) => !!url && !/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url.trim())
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** The repo path a page's local URL points at: relative to the page, or "/x" from the site root (the nearest
 *  `public/` folder above the page, else the repo root). null = not a local file. */
export function localTarget(page: string, url: string): string | null {
  if (!isLocal(url)) return null
  let clean: string
  try {
    clean = decodeURIComponent(url.trim().split(/[?#]/)[0])
  } catch {
    return null
  }
  if (!clean || /[\\\0]/.test(clean)) return null
  if (clean.startsWith('/')) {
    const parts = page.split('/')
    const i = parts.lastIndexOf('public')
    return resolvePath((i >= 0 ? parts.slice(0, i + 1).join('/') + '/' : '') + 'x', '.' + clean) || null
  }
  return resolvePath(page, clean) || null
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)?.[2] ?? null
const extOf = (p: string) => /\.([a-z0-9]+)$/i.exec(p)?.[1].toLowerCase() || ''

async function dataUrl(blob: Blob, type: string) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${type};base64,${btoa(bin)}`
}

/** A page's HTML → a self-contained document for the sandboxed frame: local <link rel=stylesheet>, <script src> and
 *  <img src> inlined (each ≤ 2–3 MB, ≤ 12 MB in all), PREVIEW_CSP and no-referrer set first thing in <head>. */
export async function buildPreview(html: string, page: string, io: PreviewIO): Promise<Preview> {
  const inlined: string[] = []
  const missing: string[] = []
  const skipped: string[] = []
  let total = 0
  const target = (url: string) => {
    const p = localTarget(page, url)
    if (!p || !io.has(p)) {
      missing.push(url)
      return null
    }
    return p
  }
  const take = async <T>(p: string, max: number, read: () => Promise<T | null>): Promise<T | null> => {
    const size = io.size(p)
    if (size > max || total + size > MAX_TOTAL) {
      skipped.push(p)
      return null
    }
    const v = await read().catch(() => null)
    if (v === null) {
      missing.push(p)
      return null
    }
    total += size
    inlined.push(p)
    return v
  }

  // Find every tag to replace first (in order), then read them all, then splice: the HTML is only walked once.
  const jobs: { start: number; end: number; make: () => Promise<string | null> }[] = []
  const scan = (re: RegExp, make: (m: RegExpExecArray) => (() => Promise<string | null>) | null) => {
    for (let m: RegExpExecArray | null; (m = re.exec(html)); ) {
      const job = make(m)
      if (job) jobs.push({ start: m.index, end: m.index + m[0].length, make: job })
    }
  }
  scan(/<link\b[^>]*>/gi, (m) => {
    const tag = m[0]
    const href = attr(tag, 'href')
    if (!/\brel\s*=\s*(["'])?stylesheet\b/i.test(tag) || !href || !isLocal(href)) return null
    return async () => {
      const p = target(href)
      const css = p && (await take(p, MAX_TEXT, () => io.text(p)))
      return css === null || css === undefined ? null : `<style data-from="${escAttr(p!)}">\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`
    }
  })
  scan(/<script\b([^>]*)>\s*<\/script>/gi, (m) => {
    const src = attr(m[0], 'src')
    if (!src || !isLocal(src)) return null
    const keep = m[1].replace(/\b(src|async|defer|integrity|crossorigin)(\s*=\s*(["']).*?\3)?/gi, '').trim()
    return async () => {
      const p = target(src)
      const js = p && (await take(p, MAX_TEXT, () => io.text(p)))
      return js === null || js === undefined ? null : `<script${keep ? ' ' + keep : ''} data-from="${escAttr(p!)}">\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`
    }
  })
  scan(/<img\b[^>]*>/gi, (m) => {
    const tag = m[0]
    const src = attr(tag, 'src')
    const type = src ? IMAGE_TYPE[extOf(src.split(/[?#]/)[0])] : undefined
    if (!src || !type || !isLocal(src)) return null
    return async () => {
      const p = target(src)
      const blob = p && (await take(p, MAX_IMAGE, () => io.bytes(p)))
      if (!blob) return null
      const url = await dataUrl(blob, type)
      return tag.replace(/\bsrc\s*=\s*(["']).*?\1/i, `src="${url}"`)
    }
  })

  jobs.sort((a, b) => a.start - b.start)
  const made = await Promise.all(jobs.map((j) => j.make()))
  let doc = ''
  let at = 0
  jobs.forEach((j, i) => {
    if (j.start < at) return // overlapping match (a tag inside a tag): keep the first
    doc += html.slice(at, j.start) + (made[i] ?? html.slice(j.start, j.end))
    at = j.end
  })
  doc += html.slice(at)

  const head = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta name="referrer" content="no-referrer">`
  if (/<head\b[^>]*>/i.test(doc)) doc = doc.replace(/<head\b[^>]*>/i, (h) => h + head)
  else if (/<html\b[^>]*>/i.test(doc)) doc = doc.replace(/<html\b[^>]*>/i, (h) => `${h}<head>${head}</head>`)
  else doc = `<!doctype html><head>${head}</head>` + doc
  return { doc, inlined, missing: [...new Set(missing)], skipped }
}
