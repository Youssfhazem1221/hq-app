// Docs reader: shows the images a note embeds from the data repo (![Props](props_flat.jpg)). lib/md-html.ts leaves a
// <span data-repo-img="repo/path.jpg" data-alt="…"> placeholder with the old plain link inside; this hook swaps the link
// for an <img> once the placeholder is near the screen (images in collapsed sections load when opened).
// - The bytes come through the active Source (local dev server, or the GitHub API with the token in a header), never
//   from a URL the note names, so the CSP only needs img-src blob:.
// - The blob is re-typed from the file extension (image/png, image/jpeg, image/webp, image/gif), so opening it full size
//   in a new tab can never render HTML or SVG.
// - One read per path per open page; every blob: URL is revoked when the page closes.
import { useEffect, useRef, type RefObject } from 'react'
import type { Source } from '../lib/source'
import { imageType, repoImagePath } from '../lib/md-html'

/** Bigger files keep their plain link (a note image is a few MB at most). */
export const MAX_IMAGE_BYTES = 25_000_000
/** Placeholders not handled yet, in the note's own text only (intro and sections, not the Explain panel's AI answer). */
const TODO = '.doc-intro [data-repo-img]:not([data-repo-state]), .dsec [data-repo-img]:not([data-repo-state])'

type State = { urls: Map<string, Promise<string | null>>; io: IntersectionObserver | null; closed: boolean }

/** The path in a placeholder, only if it is still a clean repo image path (md-html made it; check again anyway). */
export const placeholderPath = (path: string | undefined) => {
  const p = String(path || '')
  return p && repoImagePath('', '/' + p) === p ? p : null
}

/** Draws the repo images inside `root` (runs after every render: re-rendered markdown brings new placeholders). */
export function useRepoImages(root: RefObject<HTMLElement | null>, source: Source) {
  const st = useRef<State | null>(null)
  const src = useRef(source)
  src.current = source

  useEffect(
    () => () => {
      const s = st.current
      st.current = null
      if (!s) return
      s.closed = true
      s.io?.disconnect()
      for (const p of s.urls.values()) void p.then((u) => u && URL.revokeObjectURL(u))
      s.urls.clear()
    },
    [],
  )

  useEffect(() => {
    const el = root.current
    if (!el || typeof src.current.readBytes !== 'function') return
    const todo = el.querySelectorAll<HTMLElement>(TODO)
    if (!todo.length) return
    const s = (st.current ??= { urls: new Map(), io: null, closed: false })
    const show = (span: HTMLElement) => hydrate(span, s, src.current)
    for (const span of todo) span.dataset.repoState = 'wait'
    if (typeof IntersectionObserver === 'undefined') {
      todo.forEach(show)
      return
    }
    const io = (s.io ??= new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          io.unobserve(e.target)
          show(e.target as HTMLElement)
        }
      },
      { rootMargin: '600px 0px' },
    ))
    todo.forEach((span) => io.observe(span))
  })
}

/** Reads one placeholder's image (cached per path) and replaces its link with the <img>; a miss keeps the link. */
function hydrate(span: HTMLElement, s: State, source: Source) {
  const path = placeholderPath(span.dataset.repoImg)
  const type = path && imageType(path)
  if (!path || !type || typeof source.readBytes !== 'function') return
  let url = s.urls.get(path)
  if (!url) {
    url = source.readBytes(path).then(
      (b) => (b && b.size > 0 && b.size <= MAX_IMAGE_BYTES ? URL.createObjectURL(new Blob([b], { type })) : null),
      () => null,
    )
    s.urls.set(path, url)
  }
  void url.then((u) => {
    // closed meanwhile (the unmount revokes it) or the markdown re-rendered (its new placeholder asks again)
    if (s.closed || !span.isConnected) return
    if (!u) {
      span.dataset.repoState = 'missing'
      span.title = `Could not load ${path}`
      return
    }
    const img = document.createElement('img')
    img.src = u
    img.alt = span.dataset.alt || ''
    img.loading = 'lazy'
    img.decoding = 'async'
    img.title = 'Open full size'
    img.tabIndex = 0
    img.setAttribute('role', 'link')
    img.style.maxWidth = '100%'
    img.style.cursor = 'zoom-in'
    const open = () => void window.open(u, '_blank', 'noopener')
    img.addEventListener('click', open)
    img.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      open()
    })
    span.replaceChildren(img)
    span.dataset.repoState = 'shown'
  })
}
