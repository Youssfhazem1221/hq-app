// App-wide React contexts: the workspace (useHQ), the look prefs (PrefsContext, filled by lib/prefs.ts usePrefs in App),
// the Next actions (components/NextActions.tsx fills it) and the current route.
import { createContext, useContext } from 'react'
import type { Doorbell } from './doorbell'
import type { Model } from './hq'
import type { Me, Source } from './source'
import type { NextActions, PrefsApi, Route, UiPrefs } from './contracts'
import { DEFAULT_PREFS } from './ui-prefs-core'
import { useMedia } from './bp'

// ---- workspace ----

export type HQCtx = {
  source: Source
  model: Model
  me: Me
  /** Full reload with the busy spinner (after the user's own writes). */
  reload: () => Promise<void>
  /** Quiet change check: free when nothing changed; rebuilds the model and toasts when files did. */
  refresh: () => Promise<void>
  busy: boolean
  loadedAt: number
  /** Realtime doorbell (push + Claude bridge hints); null until the source is ready. */
  bell: Doorbell | null
}
export const HQContext = createContext<HQCtx | null>(null)

/** The loaded workspace. Throws outside a loaded workspace (pages always have one). */
export function useHQ() {
  const c = useContext(HQContext)
  if (!c) throw new Error('HQ context missing')
  return c
}
/** Same, but null while nothing is loaded (the shell renders before the workspace). */
export const useHQMaybe = () => useContext(HQContext)

// ---- Next actions (C1's NextActionsProvider renders <NextActionsContext.Provider>) ----

export const NextActionsContext = createContext<NextActions>({ act: () => {}, completing: null })
export const useNextActions = () => useContext(NextActionsContext)

// ---- route ----

export const RouteContext = createContext<Route>({ page: 'Home', nav: 'home', path: '/' })
export const useCurrentRoute = () => useContext(RouteContext)

// ---- look prefs ----
// The store is E's lib/prefs.ts (usePrefs): App provides it through PrefsContext. Outside App (tests, previews) the
// context holds the default look and does nothing.

const noop = () => {}
export const PrefsContext = createContext<PrefsApi>({ prefs: DEFAULT_PREFS as UiPrefs, preview: noop, apply: noop, undo: noop, reset: noop })
export const usePrefsApi = () => useContext(PrefsContext)

/** Is the page dark right now? (theme pref, 'system' follows the OS live). */
export function useIsDark(theme?: UiPrefs['theme']) {
  const ctx = useContext(PrefsContext)
  const t = theme ?? ctx.prefs.theme
  const os = useMedia('(prefers-color-scheme: dark)')
  return t === 'dark' || (t === 'system' && os)
}
