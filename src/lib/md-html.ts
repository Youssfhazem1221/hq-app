// Markdown → sanitized HTML (marked + DOMPurify). Kept out of md.ts so the data layer (hq.ts, people.ts, sync.ts) and
// the first paint never load the markdown renderer; only components/ui.tsx Markdown imports this.
//
// Everything rendered here can come from someone else: teammates' posts and notes, and AI answers (which may carry
// prompt-injected text, even while they stream). So markdown is the only markup that renders:
// - raw HTML in the markdown is shown as text (no forms, overlays, <style> or tracking tags),
// - markdown images become plain links (the browser never fetches a URL just because text mentioned it),
// - DOMPurify then drops anything interactive, styling or embedding that slipped through (defence in depth).
// index.html adds a CSP (img-src, form-action, base-uri, object-src) as the last layer.
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

marked.setOptions({ gfm: true, breaks: false })
marked.use({
  renderer: {
    html({ text }) {
      // HTML comments (e.g. a log's hidden "removed" marker) stay hidden; any other raw HTML shows as text.
      return /^\s*<!--[\s\S]*?-->\s*$/.test(text) ? '' : esc(text)
    },
    image({ href, text }) {
      const label = esc(text || href || 'image')
      return href ? `<a href="${esc(href)}">${label}</a>` : label
    },
  },
})

/** What DOMPurify may keep. Tags/attributes that can draw over the app, post data, load remote media or restyle the
 *  page are always dropped. Exported for the test. */
export const PURIFY = {
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'object', 'embed', 'img', 'picture', 'source', 'video', 'audio', 'svg', 'math', 'link', 'meta', 'base'],
  FORBID_ATTR: ['style', 'action', 'formaction', 'srcset', 'background', 'poster', 'src'],
}

/** Markdown → HTML string before sanitizing (pure, runs in node; the test checks it). */
export function mdToRawHtml(md: string) {
  return marked.parse(md || '', { async: false }) as string
}

export function toHtml(md: string) {
  return DOMPurify.sanitize(mdToRawHtml(md), PURIFY) as string
}
