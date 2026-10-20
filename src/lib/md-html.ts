// Markdown → sanitized HTML (marked + DOMPurify). Kept out of md.ts so the data layer (hq.ts, people.ts, sync.ts) and
// the first paint never load the markdown renderer; only components/ui.tsx Markdown imports this.
//
// Everything rendered here can come from someone else: teammates' posts and notes, and AI answers (which may carry
// prompt-injected text, even while they stream). So markdown is the only markup that renders:
// - raw HTML in the markdown is shown as text (no forms, overlays, <style> or tracking tags),
// - markdown images become plain links (the browser never fetches a URL just because text mentioned it); an image
//   that is a file in the data repo (relative to the note, see repoImagePath) gets a <span data-repo-img> placeholder
//   around that link, which only the Docs reader turns into an <img>, from bytes read through the Source,
// - DOMPurify then drops anything interactive, styling or embedding that slipped through (defence in depth).
// index.html adds a CSP (img-src, form-action, base-uri, object-src) as the last layer.
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** The MIME type of an image a note may show (.png .jpg .jpeg .webp .gif), else null (never SVG: it can run script). */
export function imageType(path: string) {
  const m = /\.(png|jpe?g|webp|gif)$/i.exec(String(path || ''))
  if (!m) return null
  const ext = m[1].toLowerCase()
  return 'image/' + (ext === 'jpg' ? 'jpeg' : ext)
}

/**
 * A markdown image's href → the path of an image file in the data repo, or null (it stays a plain link). Relative hrefs
 * resolve against the note's folder (`base` = the note's path), "/x" against the repo root. Refused: any scheme
 * (https:, data:, blob:, javascript:, C:), "//host", backslashes, queries, control or Windows-reserved characters, ".."
 * above the repo root, dot-folders (.git, .hq) and every extension but .png .jpg .jpeg .webp .gif.
 */
export function repoImagePath(base: string, href: string): string | null {
  let h = String(href ?? '').trim()
  if (!h || h.length > 512 || /^[a-z][a-z0-9+.-]*:/i.test(h) || /^[\\/]{2}/.test(h) || /[\\?]/.test(h)) return null
  h = h.replace(/#.*$/, '')
  try {
    h = decodeURIComponent(h)
  } catch {
    return null
  }
  // after decoding too: %5C, %3F, %3A (a drive letter or a Windows stream), %00, "//" that was %2F%2F, a folder ("x/")
  if (/[\\:*?"<>|#\u0000-\u001f\u007f]/.test(h) || h.startsWith('//') || h.endsWith('/')) return null
  const parts = h.startsWith('/') ? [] : String(base || '').split('/').slice(0, -1).filter(Boolean)
  for (const seg of h.split('/')) {
    if (seg === '..') {
      if (!parts.length) return null
      parts.pop()
    } else if (seg && seg !== '.') parts.push(seg)
  }
  if (!parts.length || parts.some((p) => p.startsWith('.'))) return null
  const path = parts.join('/')
  return imageType(path) ? path : null
}

/** The note being rendered (toHtml's `base`), only while marked runs: its repo images get a placeholder. */
let imgBase = ''

marked.setOptions({ gfm: true, breaks: false })
marked.use({
  renderer: {
    html({ text }) {
      // HTML comments (e.g. a log's hidden "removed" marker) stay hidden; any other raw HTML shows as text.
      return /^\s*<!--[\s\S]*?-->\s*$/.test(text) ? '' : esc(text)
    },
    image({ href, text }) {
      const label = esc(text || href || 'image')
      if (!href) return label
      const link = `<a href="${esc(href)}">${label}</a>`
      const repo = imgBase ? repoImagePath(imgBase, href) : null
      return repo ? `<span data-repo-img="${esc(repo)}" data-alt="${esc(text || '')}">${link}</span>` : link
    },
  },
})

/** What DOMPurify may keep. Tags/attributes that can draw over the app, post data, load remote media or restyle the
 *  page are always dropped. Exported for the test. */
export const PURIFY = {
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'object', 'embed', 'img', 'picture', 'source', 'video', 'audio', 'svg', 'math', 'link', 'meta', 'base'],
  FORBID_ATTR: ['style', 'action', 'formaction', 'srcset', 'background', 'poster', 'src'],
}

/** Markdown → HTML string before sanitizing (pure, runs in node; the test checks it). `base` = the note's repo path:
 *  its repo images get a placeholder (none without it). */
export function mdToRawHtml(md: string, base = '') {
  imgBase = base
  try {
    return marked.parse(md || '', { async: false }) as string
  } finally {
    imgBase = ''
  }
}

export function toHtml(md: string, base = '') {
  return DOMPurify.sanitize(mdToRawHtml(md, base), PURIFY) as string
}
