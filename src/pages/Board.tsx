// Board (spec §6.6, plan C2): feed first. No tiles; a Next bar only for a real item (a join/leave request on my
// project, a post to me, a new reply to my post). One-line composer that expands; its type is guessed from the text
// (chips wrap); Flag for Claude shows the tracker; posts flagged for Claude show posted → picked up → replied from the
// files and the doorbell's bridge events. Join/leave requests are cards with the owner's buttons (blueprint §8.10).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useHQ } from '../lib/hq-context'
import { Icon } from '../lib/icons'
import { HQ_EVENTS, type IconName, type NextItem, type PageProps } from '../lib/contracts'
import { displayName, postMessage, postReply, projectSlug, setPostStatus } from '../lib/hq'
import { answerJoin, answerLeave, forYouFor } from '../lib/people'
import { postFromHash } from '../lib/notify-core'
import type { Doc } from '../lib/md'
import { onEscape } from '../lib/focus'
import { ago, store } from '../lib/util'
import {
  BOARD_PREFILL_KEY, POST_TYPES, TRACKER_STEPS, boardCounts, boardNextItem, detectType, firstLine, howSteps, isClaudeReply, postMatches,
  requestCard, trackerStage, type BoardFilter, type BoardPrefill, type PostType, type TrackerStage,
} from '../lib/read-core'
import { PageHeader } from '../components/shell/PageHeader'
import { NextBar } from '../components/shell/NextBar'
import { colorSlot } from '../components/shell/shell-core'
import { BridgeChip } from '../components/bridge'
import { Avatar, Empty, Markdown, Switch } from '../components/ui'
import { toast } from '../components/toast'

export const v3 = true

const TYPE_ICON: Record<string, IconName> = { idea: 'idea', thought: 'thought', question: 'question', update: 'update' }
const TYPE_LABEL: Record<PostType, string> = { idea: 'Idea', thought: 'Thought', question: 'Question', update: 'Update' }
const HOW_ICON: IconName[] = ['arrow', 'flag', 'bot', 'check', 'spark', 'route']
/** Posts shown before "Show more" (spec §4: lists ≤6 rows, then "+N more"). */
const LIMIT = 6

const str = (v: unknown) => (v == null ? '' : String(v))
const eq = (a: unknown, b: unknown) => !!str(a).trim() && str(a).trim().toLowerCase() === str(b).trim().toLowerCase()
const isTrue = (v: unknown) => v === true || str(v).toLowerCase() === 'true'
const postId = (m: Doc) => str(m.data.id) || m.path.split('/').pop()!.replace(/\.md$/i, '')
const errText = (e: unknown) => String((e as Error)?.message || e).split('\n')[0].slice(0, 160)

/** reply: open the reply box · answer: a request's buttons · view: a notification's link (replies open, the post lights up). */
type Focus = { id: string; mode: 'reply' | 'answer' | 'view'; n: number } | null
/** How long a linked post stays lit. */
const LIT_MS = 2400

export default function Board(_: PageProps) {
  const { model, me, source, reload } = useHQ()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<PostType | null>(null)
  const [flag, setFlag] = useState(false)
  const [to, setTo] = useState('')
  const [project, setProject] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<BoardFilter>('all')
  const [limit, setLimit] = useState(LIMIT)
  const [focus, setFocus] = useState<Focus>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const type = picked ?? detectType(text)

  const posts = model.board
  const counts = boardCounts(posts, me.login)
  const active: BoardFilter = (filter === 'me' && !counts.me) || (filter === 'claude' && !counts.claude) ? 'all' : filter
  const list = posts.filter((p) => postMatches(p, active, me.login))
  const owners = useMemo(() => new Map(model.projects.map((p) => [projectSlug(p), str(p.data.owner)])), [model])
  const people = useMemo(() => model.knownLogins.filter((l) => !eq(l, me.login)).map((l) => [l, displayName(model, l)] as const), [model, me.login])
  const next = useMemo(() => boardNext(model, me.login), [model, me.login])

  const expand = () => {
    setOpen(true)
    setTimeout(() => area.current?.focus(), 0)
  }
  const collapse = (clear: boolean) => {
    if (clear) {
      setText('')
      setPicked(null)
      setFlag(false)
      setTo('')
      setProject('')
    }
    setOpen(false)
    setTimeout(() => opener.current?.focus({ preventScroll: true }), 0)
  }

  // N (the shell's "new item") opens the composer.
  useEffect(() => {
    const f = (e: Event) => {
      const page = (e as CustomEvent).detail?.page
      if (page && page !== 'Board') return
      e.preventDefault()
      expand()
    }
    addEventListener(HQ_EVENTS.newItem, f)
    return () => removeEventListener(HQ_EVENTS.newItem, f)
  }, [])

  // A notification's link (#/board?post=<id>): show that post. The query is dropped again, so a reload stays calm.
  useEffect(() => {
    const look = () => {
      const id = postFromHash(location.hash)
      if (!id) return
      history.replaceState(null, '', '#/board')
      const at = posts.findIndex((p) => postId(p) === id)
      if (at < 0) return toast('That post is gone (deleted or moved)', 'info')
      setFilter('all')
      setLimit((n) => Math.max(n, at + 1))
      setFocus({ id, mode: 'view', n: Date.now() })
    }
    look()
    addEventListener('hashchange', look)
    return () => removeEventListener('hashchange', look)
  }, [posts])

  // A prefill ("Post to board" from an answer) opens the composer with it.
  useEffect(() => {
    const p = store.get<BoardPrefill | null>(BOARD_PREFILL_KEY, null)
    if (!p || typeof p !== 'object') return
    store.del(BOARD_PREFILL_KEY)
    setText(str(p.body).slice(0, 4000))
    if (p.type && (POST_TYPES as readonly string[]).includes(p.type)) setPicked(p.type)
    if (p.to) setTo(str(p.to))
    if (p.project) setProject(str(p.project))
    setFlag(!!p.forClaude)
    expand()
  }, [])

  // Esc folds the composer (the draft stays).
  useEffect(() => {
    if (!open) return
    return onEscape(() => collapse(false))
  }, [open])

  const send = async () => {
    const body = text.trim()
    if (!body || saving) return
    setSaving(true)
    try {
      await postMessage(source, me, { type, body, forClaude: flag, project: project || undefined, to: to || undefined })
      toast(flag ? 'Posted · flagged for Claude' : 'Posted', 'commit')
      collapse(true)
      await reload()
    } catch (e) {
      toast('Could not post: ' + errText(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const act = (item: NextItem) => {
    const id = item.path ? postIdForPath(model, item.path) : ''
    if (!id) return
    setFilter('all')
    const at = posts.findIndex((p) => postId(p) === id)
    if (at >= limit) setLimit(at + 1)
    setFocus({ id, mode: item.kind === 'join' ? 'answer' : 'reply', n: Date.now() })
  }

  return (
    <div className="board-page">
      <PageHeader icon="board" title="Board" sub={<BridgeChip />} />
      {next && <NextBar item={next} onAct={act} completing={false} />}

      {!open ? (
        <button ref={opener} className="compose-c" type="button" onClick={expand} aria-label="Write a post">
          <Avatar name={me.name || me.login} src={me.avatar} size={28} />
          <span>{text.trim() ? firstLine(text, 90) : 'Write a post…'}</span>
          <Icon name="board" size="s" />
        </button>
      ) : (
        <div className="w compose" role="group" aria-label="New post">
          <label className="sr" htmlFor="bpost">
            Post
          </label>
          <textarea
            id="bpost"
            ref={area}
            className="inp"
            rows={3}
            placeholder="Write a post…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void send()
              }
            }}
          />
          <div className="chips ty" role="group" aria-label="Post type (guessed from your text)">
            {POST_TYPES.map((t) => (
              <button key={t} className="qchip" type="button" aria-pressed={type === t} onClick={() => setPicked(t)}>
                <Icon name={TYPE_ICON[t]} />
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <div className="crow">
            <span className="flagsw">
              <Switch on={flag} onChange={setFlag} label="Flag for Claude" />
              Flag for Claude
            </span>
            {flag && <Tracker stage={-1} />}
            <span className="grow" />
            <label className="sel">
              <span className="sr">To</span>
              <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="To">
                <option value="">To: anyone</option>
                {people.map(([l, n]) => (
                  <option key={l} value={l}>
                    To: {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="sel">
              <span className="sr">Project</span>
              <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
                <option value="">No project</option>
                {model.projects.map((p) => (
                  <option key={p.path} value={projectSlug(p)}>
                    {str(p.data.title || projectSlug(p))}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="crow end">
            <button className="btn ghost" type="button" onClick={() => collapse(true)}>
              Cancel
            </button>
            <button className="btn primary" type="button" disabled={saving || !text.trim()} onClick={send}>
              {saving ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      )}

      <div className="chips filters" role="group" aria-label="Show">
        <button className="qchip" type="button" aria-pressed={active === 'all'} onClick={() => setFilter('all')}>
          All · {counts.all}
        </button>
        {counts.me > 0 && (
          <button className="qchip" type="button" aria-pressed={active === 'me'} onClick={() => setFilter('me')}>
            To me · {counts.me}
          </button>
        )}
        {counts.claude > 0 && (
          <button className="qchip" type="button" aria-pressed={active === 'claude'} onClick={() => setFilter('claude')}>
            For Claude · {counts.claude}
          </button>
        )}
      </div>

      {list.length ? (
        <div className="w feed" aria-label="Posts">
          {list.slice(0, limit).map((m) => (
            <Post key={m.path} m={m} owners={owners} focus={focus && focus.id === postId(m) ? focus : null} />
          ))}
          {list.length > limit && (
            <button className="btn ghost more-posts" type="button" onClick={() => setLimit((n) => n + 12)}>
              Show {Math.min(12, list.length - limit)} more
            </button>
          )}
        </div>
      ) : (
        <Empty icon="board" text="Nothing here yet. Write the first post above." />
      )}
    </div>
  )
}

/** The post a For-you item points at (a reply's file → its parent post). */
function postIdForPath(model: ReturnType<typeof useHQ>['model'], path: string) {
  const d = model.byPath.get(path)
  if (!d) return ''
  if (path.startsWith('board/replies/')) return str(d.data.parent)
  return postId(d)
}

/** Board's Next: only a real board item waiting on me (spec §6.6), from the For-you rules (people.ts). */
function boardNext(model: ReturnType<typeof useHQ>['model'], me: string): NextItem | null {
  try {
    const title = (s: string) => str(model.projects.find((d) => projectSlug(d) === s)?.data.title || s)
    return boardNextItem(forYouFor(model, me), (l) => displayName(model, l), title)
  } catch {
    return null
  }
}

/** posted → picked up → replied (spec §4 Tracker). -1 = the composer preview. */
function Tracker({ stage }: { stage: TrackerStage }) {
  return (
    <ol className="trk" aria-label="Claude progress">
      {TRACKER_STEPS.map((s, i) => {
        const on = stage > 0 && i < stage
        const cur = stage > 0 && i === stage
        return (
          <li key={s} className={on ? 'on' : cur ? 'cur' : undefined} aria-current={cur ? 'step' : undefined}>
            <i aria-hidden="true" />
            {s}
          </li>
        )
      })}
    </ol>
  )
}

function Post({ m, owners, focus }: { m: Doc; owners: Map<string, string>; focus: Focus }) {
  const { model, me, source, reload, bell } = useHQ()
  const id = postId(m)
  const replies = model.replies.get(id) || []
  const author = str(m.data.author)
  const name = displayName(model, author)
  const claude = eq(author, 'claude')
  const done = str(m.data.status).toLowerCase() === 'done'
  const flagged = isTrue(m.data.for_claude)
  const req = requestCard(m, me.login, owners)
  const how = claude && isTrue(m.data.welcome) ? howSteps(m.body) : null
  const type = str(m.data.type).toLowerCase()
  const slug = str(m.data.project)
  const proj = slug ? model.projects.find((p) => projectSlug(p) === slug) : undefined
  const [showReplies, setShowReplies] = useState(false)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLInputElement>(null)
  const self = useRef<HTMLElement>(null)
  const [lit, setLit] = useState(false)
  // the doorbell's bridge state (re-render on bridge events)
  const [, setTick] = useState(0)
  useEffect(() => (flagged && bell ? bell.subscribe(() => setTick((n) => n + 1)) : undefined), [flagged, bell])

  useEffect(() => {
    if (!focus) return
    self.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    if (focus.mode === 'view') {
      if (replies.length) setShowReplies(true)
      self.current?.focus({ preventScroll: true })
      setLit(true)
      const t = setTimeout(() => setLit(false), LIT_MS)
      return () => clearTimeout(t)
    }
    if (focus.mode === 'reply') {
      setShowReplies(true)
      setTimeout(() => box.current?.focus({ preventScroll: true }), 50)
    } else self.current?.querySelector<HTMLElement>('.req .btn.primary, .req .btn')?.focus({ preventScroll: true })
  }, [focus?.n])

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast(ok, 'commit')
      await reload()
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const sendReply = () => {
    const body = reply.trim()
    if (!body) return
    return run(async () => {
      await postReply(source, me, id, body)
      setReply('')
    }, 'Reply posted')
  }
  const stage = flagged ? trackerStage({ id, path: m.path, status: m.data.status, closedBy: m.data.closed_by }, replies.some((r) => isClaudeReply(r.data)), bell?.bridge, bell?.working) : null

  return (
    <article ref={self} className={'post' + (done ? ' is-done' : '') + (lit ? ' is-lit' : '')} id={'post-' + id} aria-labelledby={'ph-' + id} tabIndex={-1}>
      <Avatar name={name} bot={claude} size={36} />
      <div className="p-main">
        <div className="ph2" id={'ph-' + id}>
          <b>{name}</b>
          {type && (
            <span className="typeic">
              <Icon name={TYPE_ICON[type] || 'thought'} size="s" />
              {type}
            </span>
          )}
          <span title={str(m.data.created)}>· {ago(m.data.created)}</span>
          {flagged && (
            <span className="chip acc">
              <Icon name="flag" />
              for Claude
            </span>
          )}
          {str(m.data.to) && !req && (
            <span className="chip line">
              <Icon name="arrow" />
              {eq(m.data.to, me.login) ? 'you' : displayName(model, m.data.to)}
            </span>
          )}
          {proj && (
            <a className={'chip line pj pc' + colorSlot(proj.data.color)} href={'#/projects/' + slug}>
              <span className="pdot" aria-hidden="true" />
              {str(proj.data.title || slug)}
            </a>
          )}
          {done && (
            <span className="chip ok">
              <Icon name="check" />
              done
            </span>
          )}
        </div>

        {req ? (
          <RequestCardView post={m} card={req} busy={busy} run={run} />
        ) : how ? (
          <div className="body">
            {how.lead && (
              <div className="how-lead">
                <Markdown md={how.lead} base={m.path} />
              </div>
            )}
            <ol className="how">
              {how.steps.map((s, i) => (
                <li key={i}>
                  <span className="hn" aria-hidden="true">
                    <Icon name={HOW_ICON[i] || 'arrow'} />
                  </span>
                  <b>{s.title}</b>
                  {s.text && <span>{s.text}</span>}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="body">
            <Markdown md={m.body} base={m.path} />
          </div>
        )}

        {stage && <Tracker stage={stage} />}

        <div className="pacts">
          <button className="btn ghost sm" type="button" aria-expanded={showReplies} onClick={() => setShowReplies((v) => !v)}>
            <Icon name="thought" size="s" />
            {replies.length ? `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}` : 'Reply'}
          </button>
          {!req && (
            <button
              className="btn ghost sm"
              type="button"
              disabled={busy}
              onClick={() => run(() => setPostStatus(source, me, m, done ? 'open' : 'done'), done ? 'Reopened' : 'Marked done')}
            >
              <Icon name={done ? 'undo' : 'check'} size="s" />
              {done ? 'Reopen' : 'Mark done'}
            </button>
          )}
        </div>

        {showReplies && (
          <div className="replies">
            {replies.map((r) => {
              const rn = isClaudeReply(r.data) ? 'Claude' : displayName(model, r.data.author)
              return (
                <div key={r.path} className="reply">
                  <Avatar name={rn} bot={rn === 'Claude'} size={24} />
                  <div className="p-main">
                    <div className="ph2">
                      <b>{rn}</b>
                      <span title={str(r.data.created)}>· {ago(r.data.created)}</span>
                    </div>
                    <div className="body">
                      <Markdown md={r.body} base={r.path} />
                    </div>
                  </div>
                </div>
              )
            })}
            <div className="reply-box">
              <label className="sr" htmlFor={'r-' + id}>
                Reply to {name}
              </label>
              <input
                id={'r-' + id}
                ref={box}
                className="inp"
                placeholder="Write a reply…"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void sendReply()
                  }
                }}
              />
              <button className="btn primary sm" type="button" disabled={busy || !reply.trim()} onClick={sendReply}>
                Send
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

/** A join/leave request: who · what · the owner's buttons ([Add] [Not now] / [Remove]) or who it waits on. */
function RequestCardView(p: { post: Doc; card: NonNullable<ReturnType<typeof requestCard>>; busy: boolean; run: (fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const { model, me, source } = useHQ()
  const { card, post, busy, run } = p
  const who = displayName(model, card.who)
  const proj = model.projects.find((d) => projectSlug(d) === card.project)
  const ptitle = proj ? str(proj.data.title || card.project) : card.project
  const owner = displayName(model, proj?.data.owner || post.data.to)
  return (
    <div className={'req' + (card.open ? '' : ' answered')}>
      <Icon name={card.kind === 'join' ? 'users' : 'logout'} />
      <p>
        <b>{who}</b> asks to {card.kind} <b>{ptitle}</b>
        {card.kind === 'join' && card.part ? ` as ${card.part}` : ''}
      </p>
      {card.open && card.mine ? (
        <div className="req-acts">
          {card.kind === 'join' ? (
            <>
              {/* not primary: the board's one primary is its Next (or Post); several requests never add several */}
              <button className="btn sm" type="button" disabled={busy} onClick={() => run(() => answerJoin(source, me, model, post, 'add'), `Added ${who} to ${ptitle}`)}>
                Add
              </button>
              <button className="btn ghost sm" type="button" disabled={busy} onClick={() => run(() => answerJoin(source, me, model, post, 'decline'), 'Answered: not now')}>
                Not now
              </button>
            </>
          ) : (
            <button className="btn sm" type="button" disabled={busy} onClick={() => run(() => answerLeave(source, me, model, post), `Removed ${who} from ${ptitle}`)}>
              Remove
            </button>
          )}
        </div>
      ) : (
        <span className="hint">{card.open ? `Waiting on ${owner}` : 'Answered'}</span>
      )}
    </div>
  )
}
