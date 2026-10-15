import { useEffect, useState } from 'react'
import type { PageName, Route } from './contracts'
import { store } from './util'

const readHash = () => {
  const raw = (typeof location !== 'undefined' && location.hash) || '#/'
  try {
    return decodeURIComponent(raw.slice(1)) || '/'
  } catch {
    return raw.slice(1) || '/'
  }
}

/** Hash routing (#/board, #/docs/path.md) so GitHub Pages needs no server rewrites. Returns the path after '#'. */
export function useRoute() {
  const [hash, setHash] = useState(readHash)
  useEffect(() => {
    const f = () => setHash(readHash())
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  return hash
}

export const go = (route: string) => {
  location.hash = route
}

/** Route for a hash path ('/projects/demo'). Unknown paths go Home. `#/me` → Person with person '@me' (App replaces it
 *  with my own slug once the workspace is loaded). */
export function parseRoute(raw: string): Route {
  const path = ('/' + String(raw || '').replace(/^#?\/*/, '')).replace(/[?#].*$/, '').replace(/\/+$/, '') || '/'
  const parts = path.split('/').filter(Boolean)
  const [top = '', a, ...rest] = parts
  switch (top) {
    case '':
    case 'home':
      return { page: 'Home', nav: 'home', path }
    case 'projects':
      return a ? { page: 'Project', nav: 'projects', path, slug: a } : { page: 'Projects', nav: 'projects', path }
    case 'tasks':
    case 'todos':
      return { page: 'Tasks', nav: 'tasks', path }
    case 'board':
      return { page: 'Board', nav: 'board', path }
    case 'ask':
      return { page: 'Ask', nav: 'ask', path }
    case 'people':
      if (!a) return { page: 'People', nav: 'people', path }
      if (a === '_team') return { page: 'People', nav: 'people', path, tab: 'together' }
      return { page: 'Person', nav: 'people', path, person: a }
    case 'me':
      return { page: 'Person', nav: 'people', path, person: '@me' }
    case 'docs':
      return { page: 'Docs', nav: 'docs', path, doc: [a, ...rest].filter(Boolean).join('/') || undefined }
    case 'settings':
      return { page: 'Settings', nav: 'settings', path }
    default:
      // Dev-only previews keep their path (routes.tsx previewFor); anything else is Home.
      return { page: 'Home', nav: 'home', path: top === '__preview' && a ? path : '/' }
  }
}

/** The page module to load for a page name, given the page files that exist (names without .tsx). One file per page. */
export function pickPage(page: PageName, available: Iterable<string>): string | null {
  return new Set(available).has(page) ? page : null
}

/** Name shown in the browser tab: "<page> · HQ". */
export const docTitle = (label: string) => (label ? `${label} · HQ` : 'HQ')

/** Ask AI from anywhere: the Ask page reads this prefill on mount ({q, project?, auto?}). */
export const ASK_PREFILL_KEY = 'hq.askPrefill'
export function askAnywhere(q: string, opts: { project?: string; auto?: boolean } = {}) {
  store.set(ASK_PREFILL_KEY, { q, project: opts.project, auto: opts.auto ?? true })
  if (readHash() === '/ask') dispatchEvent(new Event('hq:remount'))
  else go('/ask')
}

/** Post on the Board from anywhere: the Board page reads this prefill on mount (C2's read-core BoardPrefill shape). */
export const BOARD_PREFILL_KEY = 'hq.boardPrefill'
export type BoardPrefill = { body?: string; type?: string; to?: string; project?: string; forClaude?: boolean }
export function boardAnywhere(prefill: BoardPrefill) {
  store.set(BOARD_PREFILL_KEY, prefill)
  if (readHash() === '/board') dispatchEvent(new Event('hq:remount'))
  else go('/board')
}
