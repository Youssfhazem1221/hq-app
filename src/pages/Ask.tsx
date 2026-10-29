// Ask AI (spec §6.5, plan C2). Answers in one anatomy (lead → one visual → ≤3 bullets → Next → numbered sources →
// Make it a to-do · Save to project · Copy). Composer: question · Sources · n (popover) · Fast/Deep with speed tips ·
// send. A status line follows the stream's stages. Opening a chat scrolls to its newest question + lead, not the end.
// Save to project = owner-only, create-only; otherwise "Post to board".
// Changes the AI proposes (to-dos, posts, replies, notes, code) show as a preview card with Apply / Undo under the
// answer (components/AiChanges.tsx, lazy); only the person who asked can apply them, and nothing is saved before that.
import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useHQ } from '../lib/hq-context'
import { Icon } from '../lib/icons'
import type { IconName, PageProps } from '../lib/contracts'
import { addTodo, displayName, projectSlug, requestId, type Connector } from '../lib/hq'
import type { Doc } from '../lib/md'
import { ASK_PREFILL_KEY, go } from '../lib/router'
import { useIsPhone } from '../lib/bp'
import { ago, makeId, store } from '../lib/util'
import { ask, dropLive, historyOf, ownedProjects, saveRefusal, saveToProject, useLive, type Live } from '../lib/askStream'
import { splitChanges, type Change } from '../lib/ai-changes'
import { BOARD_PREFILL_KEY, answerParts, firstLine, isExplainQuestion, plainInline, type BoardPrefill } from '../lib/read-core'
import { ASK_CHAT_KEY, AnswerView, LiveAnswer, StatusLine } from '../components/ExplainPanel'
import { MenuItem, Popover } from '../components/shell/Popover'
import { Switch } from '../components/ui'
import { toast } from '../components/toast'

export const v3 = true

type Mode = 'fast' | 'deep'
type Prefill = { q: string; project?: string; kind?: 'ask' | 'summarize'; target?: string; auto?: boolean }

const CONNECTORS: { id: Connector; label: string; hint: string; icon: IconName }[] = [
  { id: 'web', label: 'The web', hint: 'Google Search, with cited sources', icon: 'globe' },
  { id: 'links', label: 'Links you paste', hint: 'Reads a link you write in the question', icon: 'link' },
  { id: 'history', label: 'Change history', hint: 'What changed, when, by whom', icon: 'history' },
  { id: 'supabase', label: 'Pinwheel database', hint: "Looks things up in Pinwheel's own tables, never changes them", icon: 'db' },
]
const RECENT_MS = 15 * 60_000
const str = (v: unknown) => (v == null ? '' : String(v))
const AiChanges = lazy(() => import('../components/AiChanges'))

/** The Apply card for an answer's proposed changes (nothing when there are none). */
const Changes = ({ changes, mine, forName }: { changes?: Change[]; mine: boolean; forName?: string }) =>
  changes?.length ? (
    <Suspense fallback={null}>
      <AiChanges changes={changes} mine={mine} forName={forName} />
    </Suspense>
  ) : null
const errText = (e: unknown) => String((e as Error)?.message || e).split('\n')[0].slice(0, 160)

/** A chat's title: its first question's first line. */
const titleOf = (rs: Doc[]) => firstLine(rs[0].body) || 'Untitled'

export default function Ask(_: PageProps) {
  const { model, me, source, refresh } = useHQ()
  const phone = useIsPhone()
  const [active, setActiveState] = useState<string>(() => store.get(ASK_CHAT_KEY, 'new'))
  const [q, setQ] = useState('')
  const [connectors, setConnectors] = useState<Connector[]>(() => {
    const v = store.get<unknown>('hq.connectors', ['web', 'links'])
    return Array.isArray(v) ? (v.filter((c) => CONNECTORS.some((x) => x.id === c)) as Connector[]) : ['web', 'links']
  })
  const [mode, setModeState] = useState<Mode>(() => (store.get<string>('hq.aimode', 'fast') === 'deep' ? 'deep' : 'fast'))
  const [project, setProject] = useState<string | undefined>()
  const lives = useLive()
  const busy = lives.some((l) => l.state === 'streaming')
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  /** Set when the view should land on the newest question (thread opened / question sent); cleared after the jump. */
  const jump = useRef(true)

  const setActive = (id: string) => {
    store.set(ASK_CHAT_KEY, id)
    jump.current = true
    setActiveState(id)
  }
  const setMode = (m: Mode) => {
    store.set('hq.aimode', m)
    setModeState(m)
  }
  const toggle = (c: Connector) => {
    const next = connectors.includes(c) ? connectors.filter((x) => x !== c) : [...connectors, c]
    store.set('hq.connectors', next)
    setConnectors(next)
  }

  // Chats: the first question + its follow-ups (same `thread`), newest activity first.
  const threads = useMemo(() => {
    const groups = new Map<string, Doc[]>()
    for (const r of [...model.requests].reverse()) {
      const root = str(r.data.thread || requestId(r))
      groups.set(root, [...(groups.get(root) || []), r])
    }
    const last = (rs: Doc[]) => str(rs[rs.length - 1].data.created)
    return [...groups.entries()].sort((a, b) => last(b[1]).localeCompare(last(a[1])))
  }, [model])
  const liveOnly = lives.filter((l) => l.thread === l.id && !threads.some(([root]) => root === l.id))
  const liveIds = new Set(lives.map((l) => l.id))
  const turns = active === 'new' ? [] : (threads.find(([root]) => root === active)?.[1] || []).filter((r) => !liveIds.has(requestId(r)))
  const liveTurns = lives.filter((l) => l.thread === active)
  const known = active === 'new' || threads.some(([r]) => r === active) || liveOnly.some((l) => l.id === active)
  const chatTitle = active === 'new' ? '' : threads.find(([r]) => r === active)?.[1] ? titleOf(threads.find(([r]) => r === active)![1]) : firstLine(liveOnly.find((l) => l.id === active)?.question)

  // A chat that no longer exists (deleted elsewhere) → a new chat.
  useEffect(() => {
    if (!known) setActive('new')
  }, [known])

  // A live answer gives way to its saved file once the files reload.
  useEffect(() => {
    for (const l of lives) if (l.state !== 'streaming' && model.answers.has(l.id)) dropLive(l.id)
  }, [model, lives])

  // Land on the newest question (its lead right under it), never the bottom of a long answer.
  useLayoutEffect(() => {
    if (!jump.current) return
    const el = scroller.current
    if (!el) return
    const all = el.querySelectorAll<HTMLElement>('.turn')
    const last = all[all.length - 1]
    if (!last && active !== 'new') return
    jump.current = false
    el.scrollTop = last ? Math.max(0, last.offsetTop - 12) : 0
  }, [active, turns.length, liveTurns.length])

  // GitHub Actions answers (the slow path): re-check every 10 s while one is due (a free 304 when nothing changed).
  const waiting =
    source.kind === 'github' &&
    (lives.some((l) => l.state === 'waiting') ||
      model.requests.some((r) => !model.answers.has(requestId(r)) && Date.now() - Date.parse(str(r.data.created)) < RECENT_MS))
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => refresh(), 10_000)
    return () => clearInterval(t)
  }, [waiting, refresh])

  const send = async (o: { text: string; fresh?: boolean; kind?: 'ask' | 'summarize'; target?: string; project?: string }) => {
    const question = o.text.trim()
    if (!question || busy) return
    const id = makeId(me.login)
    const root = o.fresh || active === 'new' ? id : active
    const followUp = root !== id
    const prior = followUp
      ? [
          ...(threads.find(([r]) => r === root)?.[1] || []).map((r) => ({
            question: r.body,
            answer: model.answers.get(requestId(r))?.body ?? lives.find((l) => l.id === requestId(r))?.text,
          })),
          ...lives.filter((l) => l.thread === root && !model.requests.some((r) => requestId(r) === l.id)).map((l) => ({ question: l.question, answer: l.text })),
        ]
      : []
    setQ('')
    if (input.current) input.current.style.height = ''
    jump.current = true
    if (!followUp) setActive(id)
    const proj = followUp ? undefined : (o.project ?? project)
    setProject(undefined)
    await ask(source, me, { id, question, kind: o.kind || 'ask', target: o.target, thread: root, connectors, model: mode, project: proj }, historyOf(prior), refresh)
  }

  // An auto-send prefill waits while another answer streams, then goes out.
  const [queued, setQueued] = useState<Prefill | null>(null)
  useEffect(() => {
    if (!queued || busy) return
    setQueued(null)
    void send({ text: queued.q, fresh: true, kind: queued.kind, target: queued.target, project: queued.project })
  }, [queued, busy])

  useEffect(() => {
    const p = store.get<Prefill | null>(ASK_PREFILL_KEY, null)
    if (!p || typeof p !== 'object' || !str(p.q).trim()) return
    store.del(ASK_PREFILL_KEY)
    if (p.auto) {
      setQueued({ ...p, q: str(p.q) })
      return
    }
    setActive('new')
    setQ(str(p.q))
    setProject(p.project || undefined)
    setTimeout(() => input.current?.focus(), 50)
  }, [])

  const projectTitle = (slug?: unknown) => str(model.projects.find((p) => projectSlug(p) === slug)?.data.title || slug || '')
  const suggestions = useMemo(() => {
    const out = ["What's waiting on me?", 'Where is each project?', 'What changed this week?']
    const p = model.projects.find((d) => str(d.data.status) === 'active')
    if (p) out.push(`What's next for ${str(p.data.title || projectSlug(p))}?`)
    return out
  }, [model])
  const newChat = () => {
    setActive('new')
    setTimeout(() => input.current?.focus(), 30)
  }
  const empty = !turns.length && !liveTurns.length

  return (
    <div className="ask-page">
      <h1 className="sr" tabIndex={-1}>
        Ask AI{chatTitle ? ': ' + chatTitle : ''}
      </h1>
      <div className="ask">
        {!phone && (
          <nav className="threads" aria-label="Chats">
            <button className="btn primary" type="button" onClick={newChat}>
              <Icon name="plus" size="s" />
              New chat
            </button>
            <div className="thr-list">
              {liveOnly.map((l) => (
                <button key={l.id} className="thr" type="button" aria-current={l.id === active} onClick={() => setActive(l.id)}>
                  <b>{firstLine(l.question)}</b>
                  <span>{l.state === 'streaming' ? 'answering…' : l.state === 'waiting' ? 'waiting for GitHub Actions' : l.state === 'error' ? 'error' : 'just now'}</span>
                </button>
              ))}
              {threads.map(([root, rs]) => (
                <button key={root} className="thr" type="button" aria-current={root === active} onClick={() => setActive(root)}>
                  <b>{titleOf(rs)}</b>
                  <span>{ago(rs[rs.length - 1].data.created)}</span>
                </button>
              ))}
              {!threads.length && !liveOnly.length && <p className="hint pad">No chats yet.</p>}
            </div>
          </nav>
        )}
        <section className="convo" aria-label="Chat">
          {phone && (
            <div className="ask-bar">
              <label className="sr" htmlFor="chat-pick">
                Chat
              </label>
              <select id="chat-pick" className="inp" value={active} onChange={(e) => setActive(e.target.value)}>
                <option value="new">New chat</option>
                {liveOnly.map((l) => (
                  <option key={l.id} value={l.id}>
                    {firstLine(l.question)}
                  </option>
                ))}
                {threads.map(([root, rs]) => (
                  <option key={root} value={root}>
                    {titleOf(rs)}
                  </option>
                ))}
              </select>
              <button className="icon-btn" type="button" aria-label="New chat" onClick={newChat}>
                <Icon name="plus" />
              </button>
            </div>
          )}
          <div className="msgs" ref={scroller}>
            {empty ? (
              <div className="ask-empty">
                <span className="ae-ico" aria-hidden="true">
                  <Icon name="spark" size="l" />
                </span>
                <h2>What do you want to know?</h2>
                <p className="hint">Ask about your notes, projects or the web.</p>
                <div className="chips">
                  {suggestions.map((s) => (
                    <button key={s} className="qchip" type="button" disabled={busy} onClick={() => send({ text: s })}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {turns.map((r) => (
                  <SavedTurn key={r.path} r={r} projectTitle={projectTitle} />
                ))}
                {liveTurns.map((l) => (
                  <LiveTurn key={l.id} l={l} projectTitle={projectTitle} />
                ))}
              </>
            )}
          </div>
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault()
              void send({ text: q })
            }}
          >
            <div className="comp-box">
              {project && (
                <div className="comp-proj">
                  <span className="chip line">
                    <Icon name="projects" />
                    {projectTitle(project)}
                  </span>
                  <button className="btn ghost sm" type="button" onClick={() => setProject(undefined)}>
                    Remove
                  </button>
                </div>
              )}
              <label className="sr" htmlFor="askq">
                Ask
              </label>
              <textarea
                id="askq"
                ref={input}
                rows={1}
                placeholder={active === 'new' ? 'Ask anything…' : 'Ask a follow-up…'}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(160, e.target.scrollHeight) + 'px'
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void send({ text: q })
                  }
                }}
              />
              <div className="comp-row">
                <SourcesButton on={connectors} toggle={toggle} />
                <span className="grow" />
                <div className="seg" role="group" aria-label="Speed">
                  <button type="button" aria-pressed={mode === 'fast'} onClick={() => setMode('fast')} data-tipt="Fast · first words in about 5 s">
                    <Icon name="zap" />
                    Fast
                  </button>
                  <button type="button" aria-pressed={mode === 'deep'} onClick={() => setMode('deep')} data-tipt="Deep · thinks longer, about 30 s">
                    <Icon name="spark" />
                    Deep
                  </button>
                </div>
                <button className="send" type="submit" aria-label="Send" disabled={busy || !q.trim()}>
                  <Icon name={busy ? 'loader' : 'up'} className={busy ? 'spin' : undefined} />
                </button>
              </div>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}

/** "Sources · n": your notes (always) + the connectors you switched on. */
function SourcesButton({ on, toggle }: { on: Connector[]; toggle: (c: Connector) => void }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={btn} className="qchip srcbtn" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="layers" />
        Sources · {1 + on.length}
        <Icon name="chevD" size="s" />
      </button>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} label="Sources" role="dialog" width={300}>
        <div className="src-pop">
          <div className="src-row">
            <Icon name="file" />
            <span>
              <b>Your notes</b>
              <small>Always on</small>
            </span>
            <Icon name="lock" className="muted" />
          </div>
          {CONNECTORS.map((c) => (
            <div key={c.id} className="src-row">
              <Icon name={c.icon} />
              <span>
                <b>{c.label}</b>
                <small>{c.hint}</small>
              </span>
              <Switch on={on.includes(c.id)} onChange={() => toggle(c.id)} label={c.label} />
            </div>
          ))}
        </div>
      </Popover>
    </>
  )
}

/** The question bubble (explain requests show only their first line: the rest is the instruction). */
function Question({ text, kind, project, author, projectTitle }: { text: string; kind?: unknown; project?: unknown; author?: string; projectTitle: (s?: unknown) => string }) {
  const shown = kind === 'summarize' || isExplainQuestion(text) ? firstLine(text, 200) : text.trim()
  return (
    <div className="q-row">
      {(!!author || !!project) && (
        <div className="q-meta">
          {author}
          {!!project && (
            <a className="chip line" href={'#/projects/' + str(project)}>
              <Icon name="projects" />
              {projectTitle(project)}
            </a>
          )}
        </div>
      )}
      <div className="q">{shown}</div>
    </div>
  )
}

/** 'free-1' | 'free-2' | 'paid-3' | 'server' (+ '@owner' when borrowed) → a short chip; anything else → nothing. */
function KeyChip({ tag }: { tag?: unknown }) {
  const m = /^(free|paid)-(\d)(?:@([\w-]+))?$|^(server)$/.exec(str(tag))
  if (!m) return null
  const text = m[4] ? 'Server key' : m[1] === 'paid' ? 'Paid key' : `Free key ${m[2]}` + (m[3] ? ` · ${m[3]}` : '')
  return (
    <span className={'chip ' + (m[1] === 'paid' ? 'warn' : 'ok')} title={m[3] ? `Borrowed from ${m[3]} (you have no keys)` : 'The Gemini key that answered (Settings → AI keys)'}>
      <Icon name={m[1] === 'paid' ? 'coins' : 'zap'} />
      {text}
    </span>
  )
}

const ModelLine = ({ deep, seconds, error, keyTag }: { deep: boolean; seconds?: unknown; error?: boolean; keyTag?: unknown }) => (
  <div className="a-h">
    <span className="av ai" aria-hidden="true">
      <Icon name="spark" />
    </span>
    Pinwheel AI · {deep ? 'Deep' : 'Fast'}
    {seconds != null && seconds !== '' ? ` · ${seconds} s` : ''}
    <KeyChip tag={keyTag} />
    {error && (
      <span className="chip bad">
        <Icon name="alert" />
        error
      </span>
    )}
  </div>
)

function SavedTurn({ r, projectTitle }: { r: Doc; projectTitle: (s?: unknown) => string }) {
  const { model, me } = useHQ()
  const id = requestId(r)
  const a = model.answers.get(id)
  const mine = str(r.data.author).toLowerCase() === me.login.toLowerCase()
  const deep = /argon|deep|pro/i.test(str(a?.data.model)) || r.data.model === 'deep'
  // the answer text and the changes it proposed (kept in a block after its Sources)
  const { md, changes } = useMemo(() => splitChanges(a?.body ?? ''), [a?.body])
  return (
    <div className="turn" data-turn={id}>
      <Question text={r.body} kind={r.data.kind} project={r.data.project} author={mine ? undefined : displayName(model, r.data.author)} projectTitle={projectTitle} />
      <article className="a" aria-label="Answer">
        {a ? (
          <>
            <ModelLine deep={deep} seconds={a.data.seconds} error={a.data.status === 'error'} keyTag={a.data.key} />
            <AnswerView md={md} base={a.path}>
              <AnswerActions id={id} question={r.body} md={md} project={str(r.data.project) || undefined} />
            </AnswerView>
            <Changes changes={changes} mine={mine} forName={displayName(model, r.data.author)} />
          </>
        ) : (
          <StatusLine text="Waiting for the answer" />
        )}
      </article>
    </div>
  )
}

function LiveTurn({ l, projectTitle }: { l: Live; projectTitle: (s?: unknown) => string }) {
  return (
    <div className="turn" data-turn={l.id}>
      <Question text={l.question} project={l.project} projectTitle={projectTitle} />
      <article className="a" aria-label="Answer" aria-live="polite">
        <ModelLine deep={l.model === 'deep'} seconds={l.seconds} error={l.state === 'error'} keyTag={l.key} />
        <LiveAnswer l={l}>{l.state === 'done' && l.text ? <AnswerActions id={l.id} question={l.question} md={l.text} project={l.project} /> : null}</LiveAnswer>
        {l.state !== 'streaming' && <Changes changes={l.changes} mine />}
      </article>
    </div>
  )
}

/** Make it a to-do (from the answer's Next) · Save to project (owner-only, create-only) or Post to board · Copy. */
function AnswerActions({ id, question, md, project }: { id: string; question: string; md: string; project?: string }) {
  const { model, me, source, reload } = useHQ()
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(false)
  const saveBtn = useRef<HTMLButtonElement>(null)
  const parts = useMemo(() => answerParts(md), [md])
  const owned = ownedProjects(model, me)
  const refusal = project ? saveRefusal(model, me, project) : ''
  const answerPath = `ai/answers/${id}.md`
  const targets = project && !refusal ? owned.filter((p) => p.slug === project) : owned

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast(errText(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const makeTodo = () =>
    run(async () => {
      const title = plainInline(parts.next).replace(/\s*\[[\w./-]+\.md\]/g, '').slice(0, 140)
      await addTodo(source, me, { title, owner: me.login, project })
      toast('To-do added', 'commit')
      await reload()
    })
  const save = (slug: string, name: string) =>
    run(async () => {
      setMenu(false)
      const r = await saveToProject(source, me, model, { slug, question, answer: md, answerPath })
      if (r.written) {
        toast(`Saved as a new page in ${name}`, 'commit')
        await reload()
      } else toast(`${name} already has a page for this question. Nothing was overwritten.`, 'error')
    })
  const postToBoard = () => {
    const lead = plainInline(parts.lead) || firstLine(question, 140)
    const prefill: BoardPrefill = { body: `${lead}\n\nFrom Ask AI: “${firstLine(question, 100)}” [${answerPath}]`, type: 'update', project }
    store.set(BOARD_PREFILL_KEY, prefill)
    go('/board')
  }
  const copy = () => {
    const ok = () => toast('Copied', 'ok')
    const fail = () => toast('Couldn’t copy. Select the text instead.', 'error')
    try {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(md).then(ok, fail)
      else fail()
    } catch {
      fail()
    }
  }

  return (
    <>
      {parts.next && (
        <button className="btn sm" type="button" disabled={busy} onClick={makeTodo}>
          <Icon name="tasks" size="s" />
          Make it a to-do
        </button>
      )}
      {targets.length ? (
        <>
          <button
            ref={saveBtn}
            className="btn sm"
            type="button"
            disabled={busy}
            aria-haspopup={targets.length > 1 ? 'menu' : undefined}
            aria-expanded={targets.length > 1 ? menu : undefined}
            data-tipt={targets.length === 1 ? `Adds a new page to ${targets[0].title}` : undefined}
            onClick={() => (targets.length === 1 ? save(targets[0].slug, targets[0].title) : setMenu((v) => !v))}
          >
            <Icon name="pinned" size="s" />
            Save to project
          </button>
          <Popover anchor={saveBtn.current} open={menu} onClose={() => setMenu(false)} label="Save to project" width={240}>
            {targets.map((p) => (
              <MenuItem key={p.slug} icon="projects" label={p.title} onSelect={() => save(p.slug, p.title)} />
            ))}
          </Popover>
        </>
      ) : (
        <button className="btn sm" type="button" onClick={postToBoard} data-tipt={refusal || 'Only a project’s owner can add pages to it'}>
          <Icon name="board" size="s" />
          Post to board
        </button>
      )}
      <button className="btn ghost sm" type="button" onClick={copy}>
        <Icon name="copy" size="s" />
        Copy
      </button>
    </>
  )
}
