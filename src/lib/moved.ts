// Moved pages (STRUCTURE.md `moved:`): old repo path → new path, for one file or a whole folder (a key ending in /).
// Links in chat history, board posts and logs keep their old paths, so the Docs reader follows this list instead of
// showing "Page not found". Zero imports: only the Docs chunk loads it.

/** Where `path` lives now, or '' when the moved list doesn't name it. An exact file entry wins over a folder entry;
 *  among folders the longest match wins. Only plain relative repo paths come back (no "..", no scheme). */
export function movedTo(moved: unknown, path: string): string {
  if (!moved || typeof moved !== 'object' || Array.isArray(moved) || !path) return ''
  const map = moved as Record<string, unknown>
  const ok = (p: unknown): p is string => typeof p === 'string' && !!p && !/^[a-z][a-z0-9+.-]*:|^\/|(^|\/)\.\.(\/|$)/i.test(p)
  const exact = map[path]
  if (ok(exact)) return exact
  let best = ''
  for (const [from, to] of Object.entries(map)) {
    if (!from.endsWith('/') || !path.startsWith(from) || from.length <= best.length || !ok(to)) continue
    best = from
  }
  if (!best) return ''
  const to = map[best] as string
  return (to.endsWith('/') ? to : to + '/') + path.slice(best.length)
}
