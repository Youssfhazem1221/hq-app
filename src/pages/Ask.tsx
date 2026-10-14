import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUp, Brain, ChartColumn, Cloud, Database, FolderOpen, Globe, History, Link2, ListChecks, LoaderCircle, Lock, MessageSquarePlus,
  Monitor, Sparkles, Target, TrendingUp, TriangleAlert, Zap,
} from 'lucide-react'
import { useHQ } from '../App'
import { Ago, Badge, Markdown, Segmented } from '../components/ui'
import { askAi, displayName, projectSlug, requestId, type AskOptions, type Connector } from '../lib/hq'
import { askViaEdge, edgeAvailable } from '../lib/edge'
import type { Doc } from '../lib/md'
import { ago, firstName, makeId, store } from '../lib/util'

const CONNECTORS: [Connector, ReactNode, string, string][] = [
  ['web', <Globe className="i sm" />, 'Web', 'Google Search with cited sources'],
  ['links', <Link2 className="i sm" />, 'Links', 'Reads any URL you paste'],
  ['history', <History className="i sm" />, 'History', 'What changed, when, by whom (git)'],
  ['supabase', <Database className="i sm" />, 'Supabase', 'Reads your Supabase tables (read-only)'],
]
const TOOL_ICON: [RegExp, ReactNode][] = [
  [/web/, <Globe className="i" />],
  [/link/, <Link2 className="i" />],
  [/history/, <History className="i" />],
  [/supabase/i, <Database className="i" />],
  [/read |listed files|searched workspace/, <FolderOpen className="i" />],
]
const SUGGESTIONS: [ReactNode, string][] = [
  [<Target className="i" />, 'What should I do next? Top 3 only.'],
  [<TrendingUp className="i" />, 'Chart my LinkedIn numbers.'],
  [<ChartColumn className="i" />, 'Compare the 5 money options visually.'],
  [<ListChecks className="i" />, 'How far along is each project? Show progress.'],
]
type Mode = 'fast' | 'deep'
type Pending = { thread: string; question: string } | null

export default function Ask() {
  const { model, me, source, reload } = useHQ()
  const [active, setActiveState] = useState<string>(() => store.get('hq.chat', 'new'))
  const [q, setQ] = useState('')
  const [connectors, setConnectors] = useState<Connector[]>(store.get('hq.connectors', ['web', 'links']))
  const [mode, setModeState] = useState<Mode>(store.get('hq.aimode', 'fast'))
  const [project, setProject] = useState<string | undefined>()
  const [pending, setPending] = useState<Pending>(null)
  const [venue, setVenue] = useState<'local' | 'edge' | 'actions'>(source.kind === 'local' ? 'local' : 'actions')
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  const setActive = (id: string) => {
    store.set('hq.chat', id)
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

  useEffect(() => {
    const p = store.get<{ q: string; project?: string } | null>('hq.askPrefill', null)
    if (p) {
      setActive('new')
      setQ(p.q || '')
      setProject(p.project)
      store.del('hq.askPrefill')
      setTimeout(() => input.current?.focus(), 50)
    }
    edgeAvailable(source).then((ok) => ok && setVenue('edge'))
  }, [source])

  // Conversations: the first question + its follow-ups (same `thread`), newest activity first.
  const threads = useMemo(() => {
    const groups = new Map<string, Doc[]>()
    for (const r of [...model.requests].reverse()) {
      const root = String(r.data.thread || requestId(r))
      groups.set(root, [...(groups.get(root) || []), r])
    }
    const last = (rs: Doc[]) => String(rs[rs.length - 1].data.created || '')
    return [...groups.entries()].sort((a, b) => last(b[1]).localeCompare(last(a[1])))
  }, [model])
  const turns = active === 'new' ? [] : threads.find(([root]) => root === active)?.[1] || []
  const showPending = pending && pending.thread === active

  // Keep the newest message in view.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [active, turns.length, showPending, model])

  // GitHub Actions venue: poll until the answer file appears.
  const waiting = model.requests.filter((r) => !model.answers.has(requestId(r)))
  const waitingKey = waiting.map(requestId).join(',')
  useEffect(() => {
    if (source.kind !== 'github' || !waiting.length) return
    const t = setInterval(async () => {
      for (const r of waiting) {
        if (await source.read(`ai/answers/${requestId(r)}.md`).catch(() => null)) {
          await reload()
          break
        }
      }
    }, 10000)
    return () => clearInterval(t)
  }, [source, waitingKey])

  const send = async (text = q) => {
    const question = text.trim()
    if (!question || pending) return
    const id = makeId(me.login)
    const thread = active === 'new' ? undefined : active
    const opts: AskOptions & { id: string } = { id, question, kind: 'ask', thread, connectors, model: mode, project: thread ? undefined : project }
    setQ('')
    if (!thread) setActive(id)
    setPending({ thread: thread || id, question })
    try {
      if (venue === 'edge') await askViaEdge(source, opts)
      else {
        await askAi(source, me, opts)
        if (source.runAi) await source.runAi(id)
      }
      await reload()
      setProject(undefined)
    } catch (e: any) {
      alert(e?.message || e)
      setQ(question)
    } finally {
      setPending(null)
    }
  }

  const projectTitle = (slug?: unknown) => String(model.projects.find((p) => projectSlug(p) === slug)?.data.title || slug || '')
  const titleOf = (rs: Doc[]) => rs[0].body.trim().split('\n')[0].slice(0, 70) || 'Untitled'

  return (
    <div className="chat">
      <aside className="chat-list">
        <div className="chat-list-h">
          <button className="btn primary block" onClick={() => { setActive('new'); setTimeout(() => input.current?.focus(), 30) }}>
            <MessageSquarePlus className="i sm" /> New chat
          </button>
        </div>
        <div className="chat-items">
          {threads.map(([root, rs]) => (
            <button key={root} className={'chat-item' + (root === active ? ' on' : '')} onClick={() => setActive(root)}>
              <span className="t">{titleOf(rs)}</span>
              <span className="s">
                {ago(rs[rs.length - 1].data.created)} · {rs.length} {rs.length === 1 ? 'message' : 'messages'}
              </span>
            </button>
          ))}
          {!threads.length && <div className="muted small pad">No chats yet.</div>}
        </div>
      </aside>

      <section className="chat-main">
        <div className="chat-mobile-bar">
          <select value={active} onChange={(e) => setActive(e.target.value)} aria-label="Conversation">
            <option value="new">New chat</option>
            {threads.map(([root, rs]) => <option key={root} value={root}>{titleOf(rs)}</option>)}
          </select>
          <button className="btn sm" onClick={() => setActive('new')}><MessageSquarePlus className="i sm" /></button>
        </div>

        <div className="chat-scroll" ref={scroller}>
          {!turns.length && !showPending ? (
            <div className="chat-empty">
              <div className="chat-empty-ico"><Sparkles className="i lg" /></div>
              <h2>Hi {firstName(me.name)}, what do you want to know?</h2>
              <p className="muted">I read your whole workspace, and can search the web, read links and draw charts.</p>
              <div className="suggest">
                {SUGGESTIONS.map(([icon, text]) => (
                  <button key={text} onClick={() => send(text)} disabled={!!pending}>
                    {icon}
                    <span>{text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {turns.map((r) => <Turn key={r.path} r={r} projectTitle={projectTitle} />)}
              {showPending && (
                <>
                  <UserBubble text={pending!.question} />
                  <div className="msg-row">
                    <div className="ai-avatar"><Sparkles className="i sm" /></div>
                    <div className="ai-msg"><Typing /></div>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="chat-composer">
          <div className="composer-box">
            {project && (
              <div className="row">
                <a className="proj-chip" href={'#/projects/' + project}>{projectTitle(project)}</a>
                <button className="btn ghost sm" onClick={() => setProject(undefined)}>remove</button>
              </div>
            )}
            <textarea
              ref={input}
              rows={1}
              placeholder={active === 'new' ? 'Ask anything… (Enter to send, Shift+Enter for a new line)' : 'Reply…'}
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(200, e.target.scrollHeight) + 'px'
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <div className="composer-row">
              <span className="chip sm on locked" title="Always on: your .md files"><Lock className="i sm" /> Workspace</span>
              {CONNECTORS.map(([id, icon, label, hint]) => (
                <button key={id} className={'chip sm' + (connectors.includes(id) ? ' on' : ' off')} onClick={() => toggle(id)} title={hint} aria-pressed={connectors.includes(id)}>
                  {icon} {label}
                </button>
              ))}
              <span className="spacer" />
              <Segmented<Mode> value={mode} onChange={setMode} options={[['fast', <><Zap className="i sm" /> Fast</>], ['deep', <><Brain className="i sm" /> Deep</>]]} />
              <button className="send" onClick={() => send()} disabled={!!pending || !q.trim()} aria-label="Send">
                {pending ? <LoaderCircle className="i spin" /> : <ArrowUp className="i" />}
              </button>
            </div>
          </div>
          <div className="composer-note muted small">
            {venue === 'actions' ? <Cloud className="i sm" /> : <Monitor className="i sm" />}
            {venue === 'local' && 'Answers on this PC.'}
            {venue === 'edge' && 'Instant answers via Supabase.'}
            {venue === 'actions' && 'Answered by GitHub Actions (about a minute).'}
          </div>
        </div>
      </section>
    </div>
  )
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="msg-row user">
      <div className="bubble user">{text}</div>
    </div>
  )
}

function Typing() {
  return (
    <span className="typing" aria-label="Thinking">
      <i /> <i /> <i />
    </span>
  )
}

function Turn({ r, projectTitle }: { r: Doc; projectTitle: (s?: unknown) => string }) {
  const { model, me } = useHQ()
  const a = model.answers.get(requestId(r))
  const tools: string[] = Array.isArray(a?.data.tools) ? a!.data.tools.map(String) : []
  const deep = /argon/.test(String(a?.data.model || '')) || r.data.model === 'deep'
  const mine = String(r.data.author || '').toLowerCase() === me.login.toLowerCase()
  return (
    <>
      <div className="msg-row user">
        <div className="user-col">
          {(!mine || r.data.project) && (
            <div className="user-meta small muted">
              {!mine && displayName(model, r.data.author)}
              {r.data.project && <a className="proj-chip" href={'#/projects/' + r.data.project}>{projectTitle(r.data.project)}</a>}
            </div>
          )}
          <div className="bubble user">{r.body.trim()}</div>
        </div>
      </div>
      <div className="msg-row">
        <div className="ai-avatar"><Sparkles className="i sm" /></div>
        <div className="ai-msg">
          {a ? (
            <>
              <div className="answer-meta">
                {a.data.status === 'error' ? (
                  <Badge tone="bad"><TriangleAlert className="i" /> error</Badge>
                ) : (
                  <Badge tone={deep ? 'accent' : 'info'}>{deep ? <Brain className="i" /> : <Zap className="i" />} {deep ? 'Deep' : 'Fast'}</Badge>
                )}
                {tools.slice(0, 4).map((t) => (
                  <Badge key={t} tone="muted">{TOOL_ICON.find(([re]) => re.test(t))?.[1]} {t}</Badge>
                ))}
                {a.data.seconds !== undefined && <span className="muted small num">{String(a.data.seconds)}s</span>}
                <Ago iso={a.data.created} />
              </div>
              <Markdown md={a.body} base={a.path} />
            </>
          ) : (
            <Typing />
          )}
        </div>
      </div>
    </>
  )
}
