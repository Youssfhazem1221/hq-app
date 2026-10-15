// For you (module D, blueprint §8.11 + spec §6.1): everything waiting for me, from other people (forYou rules 1–8).
// One row = one control: a to-do ticks (Undo toast), a decision opens C1's Decide sheet, a join/leave request gets the
// owner's answer, "you were added" gets Got it, the rest open. Age sits in the meta with "from <name> · <age> ago" as a
// tooltip. Frozen props: <ForYouList limit? />. Opening the list marks this device's seen time (blueprint P12); the rows
// stay put until the page is left, so nothing jumps while you read.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useHQ, useNextActions } from '../../lib/hq-context'
import { displayName, type Model } from '../../lib/hq'
import { answerJoin, answerLeave, forYouFor, seenStore, type ForYouItem, type Seen } from '../../lib/people'
import { projectSlugOf, colorSlot } from '../shell/shell-core'
import { Popover } from '../shell/Popover'
import { Icon } from '../../lib/icons'
import type { NextItem } from '../../lib/contracts'
import { toast } from '../toast'
import { Empty } from '../ui'
import { isDecision, projectOfTodo, type NextModel } from '../../lib/next-core'
import { useNext } from '../NextActions'
import { forYouView, type FyView } from './people-ui-core'

export type ForYouListProps = {
  /** Rows shown before "+N more" (default 6). */
  limit?: number
  /** Opening this list counts as "seen" on this device (default true). */
  markSeen?: boolean
  /** Text for the empty state. */
  empty?: string
}

const ACK_EVENT = 'hq:fy-ack'

/** My For-you items with this device's seen state as it was when the page opened (plus any Got it since). */
export function useForYouItems(markSeen = true) {
  const { model, me } = useHQ()
  const [seen0] = useState<Seen>(() => seenStore.get(me.login))
  const [acked, setAcked] = useState<string[]>([])
  useEffect(() => {
    if (markSeen) seenStore.markSeen(me.login)
  }, [me.login, markSeen])
  const items = useMemo(() => {
    try {
      return forYouFor(model, me, undefined, { at: seen0.at, ack: [...seen0.ack, ...acked] })
    } catch {
      return []
    }
  }, [model, me, seen0, acked])
  // every list and count on the page drops an item the moment one of them says Got it
  useEffect(() => {
    const on = (e: Event) => {
      const h = String((e as CustomEvent).detail || '')
      if (h) setAcked((a) => (a.includes(h) ? a : [...a, h]))
    }
    addEventListener(ACK_EVENT, on)
    return () => removeEventListener(ACK_EVENT, on)
  }, [])
  const ack = (hash: string) => {
    seenStore.ack(me.login, hash)
    dispatchEvent(new CustomEvent(ACK_EVENT, { detail: hash }))
  }
  return { items, ack }
}

/** The Next queue id of a For-you item (help and assigned to-dos: 'todo:<path>', join requests: 'post:<path>'). */
const queueId = (it: ForYouItem) => (it.kind === 'join' ? 'post:' : 'todo:') + it.path

/** Items in the order of the one Next queue (Home's hero, Tasks), so both blocks agree on what comes first; items the
 *  queue doesn't list (replies, mentions, "added to"…) keep their order after the queued ones. */
export function inQueueOrder(items: ForYouItem[], queueIds: string[]): ForYouItem[] {
  const rank = (it: ForYouItem) => {
    const i = it.kind === 'help' || it.kind === 'join' || it.kind === 'assigned' ? queueIds.indexOf(queueId(it)) : -1
    return i < 0 ? queueIds.length : i
  }
  return items.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it) - rank(b.it) || a.i - b.i).map((x) => x.it)
}

export default function ForYouList({ limit = 6, markSeen = true, empty = 'Nothing waiting on you.' }: ForYouListProps) {
  const { model, me } = useHQ()
  const { items: raw, ack } = useForYouItems(markSeen)
  const { queue } = useNext()
  const items = useMemo(() => inQueueOrder(raw, queue.map((q) => q.id)), [raw, queue])
  const [all, setAll] = useState(false)
  if (!items.length) return <Empty icon="inbox" text={empty} />
  const shown = all ? items : items.slice(0, Math.max(1, limit))
  return (
    <>
      <div className="rows fy" role="list">
        {shown.map((it) => (
          <ForYouRow key={it.id} it={it} model={model} me={me} onAck={ack} />
        ))}
      </div>
      {items.length > shown.length && (
        <button className="more" type="button" onClick={() => setAll(true)}>
          +{items.length - shown.length} more
        </button>
      )}
    </>
  )
}
export { ForYouList }

function ProjectTag({ model, slug }: { model: Model; slug?: string }) {
  if (!slug) return null
  const p = model.projects.find((d) => projectSlugOf(d) === slug)
  const title = String(p?.data.title || slug)
  return (
    <span className="pj" title={title}>
      <i className={'pdot pc' + colorSlot(p?.data.color)} aria-hidden="true" />
      <span className="pj-t">{title}</span>
    </span>
  )
}

function ForYouRow({ it, model, me, onAck }: { it: ForYouItem; model: Model; me: { login: string; name: string }; onAck: (hash: string) => void }) {
  const { source, reload } = useHQ()
  const next = useNextActions()
  const doc = model.byPath.get(it.path)
  const nm = model as unknown as NextModel
  // the same decision rule and project as the Next queue and Tasks (next-core): link anchors, ./ and / are ignored, and
  // a to-do without project: gets it from its link (doc → hub/folder → project)
  const decision = it.kind === 'assigned' && !!doc && isDecision(doc, nm)
  const project = it.project || (doc && (it.kind === 'assigned' || it.kind === 'help') ? projectOfTodo(doc, nm) : undefined)
  const v: FyView = forYouView(it, (l) => displayName(model, l), new Date().toISOString(), decision, (s) => String(model.projects.find((d) => projectSlugOf(d) === s)?.data.title || s))
  const [busy, setBusy] = useState(false)
  const [review, setReview] = useState(false)
  const reviewBtn = useRef<HTMLButtonElement>(null)

  // to-dos tick and decisions open the Decide sheet through C1's Next actions (same id everywhere: 'todo:<path>'),
  // so a Next bar showing the same item fills too, and the Undo toast comes from one place
  const todoItem = (kind: 'todo' | 'decision'): NextItem => ({
    kind, id: 'todo:' + it.path, text: String(doc?.data.title || it.title), path: it.path, project, from: it.from, since: it.since,
  })
  const filling = next.completing === 'todo:' + it.path
  const tick = () => {
    if (!doc || busy || filling) return
    next.act(todoItem('todo'))
  }
  const decide = () => next.act(todoItem('decision'))
  const answer = async (what: 'add' | 'decline' | 'remove') => {
    if (!doc || busy) return
    setReview(false)
    setBusy(true)
    try {
      if (what === 'remove') await answerLeave(source, me, model, doc)
      else await answerJoin(source, me, model, doc, what)
      toast(what === 'add' ? `Added ${displayName(model, it.from)} to the team` : what === 'remove' ? `Removed ${displayName(model, it.from)} from the team` : 'Answered: not now', 'ok')
      await reload()
    } catch (e: any) {
      toast(String(e?.message || e), 'error')
    } finally {
      setBusy(false)
    }
  }

  let control
  if (v.control === 'tick')
    control = (
      <button className="cbx" type="button" role="checkbox" aria-checked={filling} data-tick="" disabled={busy || filling || !doc} aria-label={'Done: ' + it.title} onClick={tick}>
        <Icon name="check" />
      </button>
    )
  else if (v.control === 'decide')
    control = (
      <button className="btn sm dec" type="button" onClick={decide}>
        Decide
      </button>
    )
  else if (v.control === 'review')
    control = (
      <>
        <button ref={reviewBtn} className="btn sm" type="button" aria-haspopup="dialog" aria-expanded={review} disabled={busy || !doc} onClick={() => setReview((o) => !o)}>
          Review
        </button>
        <Popover anchor={reviewBtn.current} open={review} onClose={() => setReview(false)} role="dialog" label={v.text} width={260}>
          <div className="fy-rev">
            <p>{v.text}</p>
            <div className="pp-ctrl">
              {it.kind === 'join' ? (
                <>
                  <button className="btn primary sm" type="button" onClick={() => answer('add')}>
                    Add
                  </button>
                  <button className="btn ghost sm" type="button" onClick={() => answer('decline')}>
                    Not now
                  </button>
                </>
              ) : (
                <button className="btn primary sm" type="button" onClick={() => answer('remove')}>
                  Remove
                </button>
              )}
            </div>
          </div>
        </Popover>
      </>
    )
  else if (v.control === 'gotit')
    control = (
      <button className="btn sm" type="button" onClick={() => onAck(it.hash)}>
        Got it
      </button>
    )
  else
    control = (
      <a className="btn ghost sm" href={v.href}>
        Open
      </a>
    )

  return (
    <div className={'row frow' + (filling ? ' done' : '')} role="listitem" data-fy={it.kind}>
      {control}
      {/* a tick row's checkbox already says what it is: no kind icon next to it */}
      {v.control !== 'tick' && <Icon name={v.icon} className="fy-i" />}
      <span className="t" title={v.text}>
        {v.text}
        {v.tip && <span className="sr"> · {v.tip}</span>}
      </span>
      <span className="meta">
        <ProjectTag model={model} slug={project} />
        {v.age && (
          <span className="age" data-tipt={v.tip} aria-hidden="true">
            {v.age}
          </span>
        )}
      </span>
    </div>
  )
}
