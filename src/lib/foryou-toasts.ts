// For-you toasts (module D, blueprint §8.11 "toast mechanics"): after each model rebuild, items that just appeared in
// my For you (e.g. "alice added you to demo (mobile app)") toast once, on any page, in an open tab. A2 calls the hook
// from App with the current model and me; it never toasts on the first load or after a change of person.
// Relevance is computed here, in the browser, after the normal authenticated refresh: the doorbell payload stays
// booleans (blueprint F36).
import { useEffect, useRef } from 'react'
import type { ForYouToastsHook } from './contracts'
import { displayName, type Model } from './hq'
import type { Me } from './source'
import { forYouFor, personCtx } from './people'
import { newForYou, toastLines } from '../components/people/people-ui-core'
import { toast } from '../components/toast'

/** The toasts a model change brings: `before` = For-you ids of the previous model (null on the first load). */
export function forYouToasts(before: Set<string> | null, model: Model, login: string, now?: string): { ids: Set<string>; lines: string[] } {
  const items = forYouFor(model, login, now)
  const ids = new Set(items.map((x) => x.id))
  const fresh = newForYou(before, items)
  return { ids, lines: toastLines(fresh, (l) => displayName(model, l)) }
}

export const useForYouToasts: ForYouToastsHook = (model: Model | null, me: Me | null) => {
  const last = useRef<{ login: string; ids: Set<string> } | null>(null)
  useEffect(() => {
    if (!model || !me?.login) return
    const login = me.login.toLowerCase()
    const prev = last.current && last.current.login === login ? last.current.ids : null
    let r: { ids: Set<string>; lines: string[] }
    try {
      r = forYouToasts(prev, model, me.login)
    } catch {
      return
    }
    last.current = { login, ids: r.ids }
    for (const line of r.lines) toast(line, 'you')
  }, [model, me?.login])
}

/** The People nav badge (blueprint §8.1): new For-you items that are not to-dos (to-dos already count on Tasks), and
 *  `quiet` = my last check-in is older than my nudge_days (a small amber dot, never red). A2 wires it into the sidebar. */
export function peopleNavBadge(model: Model, login: string, now: string = new Date().toISOString()): { count: number; quiet: boolean } {
  try {
    const count = forYouFor(model, login, now).filter((x) => x.isNew && x.kind !== 'assigned' && x.kind !== 'help').length
    const quiet = personCtx(model, login, now, { viewer: login }).quiet
    return { count, quiet }
  } catch {
    return { count: 0, quiet: false }
  }
}
