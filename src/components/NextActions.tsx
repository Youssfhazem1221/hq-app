// The one place every Next button acts (spec §2.3): Decide opens the Decide sheet, Done ticks the to-do (the bar fills
// for 520 ms, then the page moves on to the next item; reduced motion = instant), "Make it a to-do" creates one,
// Check in opens the check-in sheet, Open/Review go where the request lives. Also: the hooks pages read the queue from
// (useNext / useProjectNext) and the palette's "Next: …" suggestion.
//
// <NextActionsProvider> is safe to nest: only the outermost one is real (A2 mounts it once in App; until then each work
// page wraps itself, and the inner ones pass through).
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NextActionsContext, useHQMaybe } from '../lib/hq-context'
import { NEXT_BUTTON, NEXT_FILL_MS, type NextActions, type NextItem } from '../lib/contracts'
import { reducedMotion } from '../lib/bp'
import { rememberFocus, restoreFocus } from '../lib/focus'
import { go } from '../lib/router'
import { addTodo, displayName, type Model } from '../lib/hq'
import { dayOf, forYouFor, localTz } from '../lib/people'
import { completeItem, decide, nextFor, nextQueue, type NextOpts } from '../lib/next-core'
import type { Me } from '../lib/source'
import { registerPaletteSource } from './shell/shell-core'
import { openCheckin, toast } from './toast'

const DecideSheet = lazy(() => import('./DecideSheet'))

const same = (a: unknown, b: unknown) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Options for next-core from the loaded workspace: the exact For-you list (help/join) and display names. */
export function nextOpts(model: Model, me: Me): NextOpts {
  let forYou: NextOpts['forYou'] = null
  try {
    forYou = forYouFor(model, me)
  } catch {
    forYou = null // next-core derives help/join itself
  }
  return { forYou, nameOf: (l) => displayName(model, l) }
}

/** While an item's bar is filling, keep showing it even if a refresh already dropped it (local mode refreshes on the
 *  file event, before the 520 ms fill ends); the page moves on once the fill is over. */
function useHeld<T>(value: T, idOf: (v: T) => string | undefined): T {
  const { completing } = useContext(NextActionsContext)
  const last = useRef(value)
  if (completing && idOf(last.current) === completing && idOf(value) !== completing) return last.current
  last.current = value
  return value
}

/** My Next queue (never empty: the last item is the check-in nudge) + the first two items. */
export function useNext(): { queue: NextItem[]; first: NextItem | null; then: NextItem | null } {
  const hq = useHQMaybe()
  const v = useMemo(() => {
    if (!hq) return { queue: [] as NextItem[], first: null, then: null }
    const queue = nextQueue(hq.model, hq.me, Date.now(), nextOpts(hq.model, hq.me)) as NextItem[]
    return { queue, first: queue[0] || null, then: queue[1] && queue[1].kind !== 'checkin' ? queue[1] : null }
  }, [hq?.model, hq?.me]) // eslint-disable-line react-hooks/exhaustive-deps
  return useHeld(v, (x) => x.first?.id)
}

/** One project's Next (my first item there, else its `next:`, else its first open milestone), or null. */
export function useProjectNext(slug: string): NextItem | null {
  const hq = useHQMaybe()
  const v = useMemo(() => {
    if (!hq || !slug) return null
    return nextFor(hq.model, hq.me, slug, Date.now(), nextOpts(hq.model, hq.me)) as NextItem | null
  }, [hq?.model, hq?.me, slug]) // eslint-disable-line react-hooks/exhaustive-deps
  return useHeld(v, (x) => x?.id)
}

/** My local day (YYYY-MM-DD) for milestone dates: my profile's time zone, else the browser's. */
function myDay(model: Model, me: Me) {
  const tz = model.roster.find((p) => same(p.login, me.login))?.timezone || localTz()
  try {
    return dayOf(new Date().toISOString(), tz)
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

// Only the outermost provider is real.
const Mounted = createContext(false)

export function NextActionsProvider({ children }: { children: ReactNode }) {
  const outer = useContext(Mounted)
  if (outer) return <>{children}</>
  return <RealProvider>{children}</RealProvider>
}

function RealProvider({ children }: { children: ReactNode }) {
  const hq = useHQMaybe()
  const [completing, setCompleting] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<NextItem | null>(null)
  const busy = useRef(false)
  const hqRef = useRef(hq)
  hqRef.current = hq

  /** Run a write while the bar(s) with this id fill; then reload (the bar moves on) and toast with Undo. */
  const finish = useCallback(async (item: NextItem, work: () => Promise<{ undo: (() => Promise<void>) | null; text: string } | null>) => {
    const ctx = hqRef.current
    if (!ctx || busy.current) return
    busy.current = true
    setCompleting(item.id)
    const t0 = Date.now()
    try {
      const r = await work()
      const left = (reducedMotion() ? 0 : NEXT_FILL_MS) - (Date.now() - t0)
      if (left > 0) await sleep(left)
      await ctx.reload()
      if (r) {
        const undo = r.undo
        toast(r.text, 'ok', {
          undo: undo
            ? () => {
                undo()
                  .then(() => hqRef.current?.reload())
                  .then(() => toast('Undone', 'info'))
                  .catch((e) => toast('Could not undo: ' + (e?.message || e), 'error'))
              }
            : undefined,
        })
      }
    } catch (e: any) {
      toast(String(e?.message || e), 'error')
    } finally {
      busy.current = false
      setCompleting(null)
    }
  }, [])

  const act = useCallback(
    (item: NextItem) => {
      const ctx = hqRef.current
      if (!item) return
      switch (item.kind) {
        case 'decision':
          rememberFocus()
          setDeciding(item)
          return
        case 'todo':
          if (!ctx || !item.path) return
          void finish(item, async () => {
            const undo = await completeItem(ctx.source, ctx.me, ctx.model, item)
            return { undo, text: 'Done: ' + clip(item.text, 42) }
          })
          return
        case 'milestone':
        case 'status': {
          if (!ctx || busy.current) return
          busy.current = true
          addTodo(ctx.source, ctx.me, { title: item.text, owner: ctx.me.login, project: item.project })
            .then(() => ctx.reload())
            .then(() => toast('To-do created · ' + clip(item.text, 40), 'ok'))
            .catch((e) => toast(String(e?.message || e), 'error'))
            .finally(() => (busy.current = false))
          return
        }
        case 'checkin':
          rememberFocus()
          openCheckin()
          return
        case 'help': {
          const who = ctx?.model.roster.find((p) => same(p.login, item.from))
          go(who ? '/people/' + who.slug : '/tasks')
          return
        }
        case 'join':
          go('/board')
          return
      }
    },
    [finish],
  )

  const pick = useCallback(
    (item: NextItem, choice: string) => {
      setDeciding(null)
      // Picking closes the sheet like Esc does: focus goes back to what opened it (or the page title) once it unmounts.
      setTimeout(restoreFocus, 0)
      const ctx = hqRef.current
      if (!ctx || !item.path) return
      void finish(item, async () => {
        const r = await decide(ctx.source, ctx.me, ctx.model, item.path!, choice, { day: myDay(ctx.model, ctx.me) })
        if (!r.written) return { undo: null, text: 'Already decided' }
        return { undo: r.undo, text: 'Picked: ' + clip(choice, 40) + ' · to-do closed' }
      })
    },
    [finish],
  )

  // The palette's "Next: …" suggestion (empty query only).
  const actRef = useRef(act)
  actRef.current = act
  useEffect(
    () =>
      registerPaletteSource((q, c) => {
        if (q.trim() || !c.model || !c.me) return []
        const first = nextQueue(c.model, c.me, Date.now(), nextOpts(c.model, c.me))[0] as NextItem | undefined
        if (!first) return []
        return [{ id: 'suggest:next', group: 'Suggested', icon: 'arrow', label: 'Next: ' + first.text, hint: NEXT_BUTTON[first.kind].label, run: () => actRef.current(first) }]
      }),
    [],
  )

  const value: NextActions = useMemo(() => ({ act, completing }), [act, completing])
  return (
    <Mounted.Provider value={true}>
      <NextActionsContext.Provider value={value}>
        {children}
        {deciding && (
          <Suspense fallback={null}>
            <DecideSheet item={deciding} onClose={() => setDeciding(null)} onPick={(choice) => pick(deciding, choice)} />
          </Suspense>
        )}
      </NextActionsContext.Provider>
    </Mounted.Provider>
  )
}

export default NextActionsProvider
