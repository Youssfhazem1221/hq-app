// A stale tab after a deploy. Every deploy renames the page files and deletes the old ones; a tab opened before it, or
// an index.html the browser kept (GitHub Pages sends max-age=600), still asks for the old names: "Failed to fetch
// dynamically imported module". One reload with a fresh index.html fixes it; a 30 s guard stops a loop.

const KEY = 'hq.fresh'

export const STALE_MSG = 'Pinwheel was updated. Reload to get the new version.'

/** A page file (or its CSS) that failed to load: Chrome, Firefox, Safari, Vite's CSS preload. */
export const isStaleChunk = (e: unknown) =>
  /dynamically imported module|module script failed|preload CSS/i.test(String((e as Error)?.message ?? e))

/** Reload with a fresh index.html. false = not now (already tried in the last 30 s; `force` skips that check). */
export function reloadFresh(force = false): boolean {
  try {
    if (!force && Date.now() - (Number(sessionStorage.getItem(KEY)) || 0) < 30_000) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    if (!force) return false // storage blocked: no guard, so no automatic reload (the page offers the button)
  }
  // refresh the cached index.html first, or the reload could get the old one again for up to 10 minutes
  fetch(location.pathname, { cache: 'reload' })
    .catch(() => {})
    .finally(() => location.reload())
  return true
}
