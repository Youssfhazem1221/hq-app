import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUp, Brain, ChartColumn, Cloud, Database, FileText, FolderOpen, Globe, History, Link2, ListChecks, LoaderCircle, Lock, MessageSquarePlus,
  Monitor, Sparkles, Target, TrendingUp, TriangleAlert, Zap,
} from 'lucide-react'
import { useHQ } from '../App'
import { Ago, Badge, Markdown, Segmented } from '../components/ui'
import { displayName, projectSlug, requestId, routeFor, type Connector } from '../lib/hq'
import { ask, dropLive, historyOf, liveMarkdown, useLive, type Live, type SourceRef } from '../lib/askStream'
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
  [/read |listed files|searched workspace|notes|knowledge/, <FolderOpen className="i" />],
]
const SUGGESTIONS: [ReactNode, string][] = [
  [<Target className="i" />, 'What should I do next? Top 3 only.'],
  [<TrendingUp className="i" />, 'Chart my LinkedIn numbers.'],
  [<ChartColumn className="i" />, 'Compare the 5 money options visually.'],
  [<ListChecks className="i" />, 'How far along is each project? Show progress.'],
]
type Mode = 'fast' | 'deep'
/** Set by other pages before opening Ask (e.g. Docs → Summarize, Projects → Ask AI about it). */
type Prefill = { q: string; project?: string; kind?: 'ask' | 'summarize'; target?: string; auto?: boolean }
const RECENT_MS = 15 * 60_000

const answerText = (a?: Doc) => (a ? a.body : undefined)

export default function Ask() {
  const { model, me, source, refresh } = useHQ()
  const [active, setActiveState] = useState<string>(() => store.get('hq.chat', 'new'))
  const [q, setQ] = useState('')
  const [connectors, setConnectors] = useState<Connector[]>(store.get('hq.connectors', ['web', 'links']))
  const [mode, setModeState] = useState<Mode>(store.get('hq.aimode', 'fast'))
  const [project, setProject] = useState<string | undefined>()
  const lives = useLive()
  const busy = lives.some((l) => l.state === 'streaming')
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
  // Brand-new chats exist only as live answers until their files are saved.
  const liveOnly = lives.filter((l) => l.thread === l.id && !threads.some(([root]) => root === l.id))

  const liveIds = new Set(lives.map((l) => l.id))
  const turns = active === 'new' ? [] : (threads.find(([root]) => root === active)?.[1] || []).filter((r) => !liveIds.has(requestId(r)))
  const liveTurns = lives.filter((l) => l.thread === active)

  // A live answer is replaced by its saved file once the files reload.
  useEffect(() => {
    for (const l of lives) if (l.state !== 'streaming' && model.answers.has(l.id)) dropLive(l.id)
  }, [model, lives])

  // Keep the newest message in view.
  const liveLen = liveTurns.reduce((n, l) => n + l.text.length + l.status.length, 0)
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [active, turns.length, liveTurns.length, liveLen, model])

  // GitHub Actions answers (the fallback path): re-check every 10 s while one is due.
  // A check is one conditional request, free when nothing changed.
  const waiting =
    source.kind === 'github' &&
    (lives.some((l) => l.state === 'waiting') ||
      model.requests.some((r) => !model.answers.has(requestId(r)) && Date.now() - Date.parse(String(r.data.created || '')) < RECENT_MS))
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
            answer: answerText(model.answers.get(requestId(r))) ?? lives.find((l) => l.id === requestId(r))?.text,
          })),
          ...lives.filter((l) => l.thread === root && !model.requests.some((r) => requestId(r) === l.id)).map((l) => ({ question: l.question, answer: l.text })),
        ]
      : []
    setQ('')
    if (input.current) input.current.style.height = 'auto'
    if (!followUp) setActive(id)
    const proj = followUp ? undefined : o.project ?? project
    setProject(undefined)
    await ask(
      source, me,
      { id, question, kind: o.kind || 'ask', target: o.target, thread: root, connectors, model: mode, project: proj },
      historyOf(prior), refresh,
    )
  }

  // An auto-send prefill (Docs → Summarize) waits here while another answer is streaming, then goes out.
  const [queued, setQueued] = useState<Prefill | null>(null)
  useEffect(() => {
    if (!queued || busy) return
    setQueued(null)
    send({ text: queued.q, fresh: true, kind: queued.kind, target: queued.target, project: queued.project })
  }, [queued, busy])

  useEffect(() => {
    const p = store.get<Prefill | null>('hq.askPrefill', null)
    if (!p) return
    store.del('hq.askPrefill')
    if (p.auto) {
      setQueued(p)
      return
    }
    setActive('new')
    setQ(p.q || '')
    setProject(p.project)
    setTimeout(() => input.current?.focus(), 50)
  }, [source])

  const projectTitle = (slug?: unknown) => String(model.projects.find((p) => projectSlug(p) === slug)?.data.title || slug || '')
  const titleOf = (rs: Doc[]) => rs[0].body.trim().split('\n')[0].slice(0, 70) || 'Untitled'
  const empty = !turns.length && !liveTurns.length

  return (
    <div className="chat">
      <aside className="chat-list">
        <div className="chat-list-h">
          <button className="btn primary block" onClick={() => { setActive('new'); setTimeout(() => input.current?.focus(), 30) }}>
            <MessageSquarePlus className="i sm" /> New chat
          </button>
        </div>
        <div className="chat-items">
          {liveOnly.map((l) => (
            <button key={l.id} className={'chat-item' + (l.id === active ? ' on' : '')} onClick={() => setActive(l.id)}>
              <span className="t">{l.question.split('\n')[0].slice(0, 70)}</span>
              <span className="s">just now · {l.state === 'streaming' ? 'answering' : l.state === 'waiting' ? 'waiting for GitHub Actions' : l.state === 'error' ? 'error' : '1 message'}</span>
            </button>
          ))}
          {threads.map(([root, rs]) => (
            <button key={root} className={'chat-item' + (root === active ? ' on' : '')} onClick={() => setActive(root)}>
              <span className="t">{titleOf(rs)}</span>
              <span className="s">
                {ago(rs[rs.length - 1].data.created)} · {rs.length} {rs.length === 1 ? 'message' : 'messages'}
              </span>
            </button>
          ))}
          {!threads.length && !liveOnly.length && <div className="muted small pad">No chats yet.</div>}
        </div>
      </aside>

      <section className="chat-main">
        <div className="chat-mobile-bar">
          <select value={active} onChange={(e) => setActive(e.target.value)} aria-label="Conversation">
            <option value="new">New chat</option>
            {liveOnly.map((l) => <option key={l.id} value={l.id}>{l.question.split('\n')[0].slice(0, 70)}</option>)}
            {threads.map(([root, rs]) => <option key={root} value={root}>{titleOf(rs)}</option>)}
          </select>
          <button className="btn sm" onClick={() => setActive('new')}><MessageSquarePlus className="i sm" /></button>
        </div>

        <div className="chat-scroll" ref={scroller}>
          {empty ? (
            <div className="chat-empty">
              <div className="chat-empty-ico"><Sparkles className="i lg" /></div>
              <h2>Hi {firstName(me.name)}, what do you want to know?</h2>
              <p className="muted">I read your whole workspace, and can search the web, read links and draw charts.</p>
              <div className="suggest">
                {SUGGESTIONS.map(([icon, text]) => (
                  <button key={text} onClick={() => send({ text })} disabled={busy}>
                    {icon}
                    <span>{text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {turns.map((r) => <Turn key={r.path} r={r} projectTitle={projectTitle} />)}
              {liveTurns.map((l) => <LiveTurn key={l.id} l={l} projectTitle={projectTitle} />)}
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
                  send({ text: q })
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
              <button className="send" onClick={() => send({ text: q })} disabled={busy || !q.trim()} aria-label="Send">
                {busy ? <LoaderCircle className="i spin" /> : <ArrowUp className="i" />}
              </button>
            </div>
          </div>
          <div className="composer-note muted small">
            {source.kind === 'local' ? <Monitor className="i sm" /> : <Cloud className="i sm" />}
            {source.kind === 'local' ? 'Streams from this PC.' : 'Streams via Supabase. Backup: GitHub Actions (about a minute).'}
          </div>
        </div>
      </section>
    </div>
  )
}

function UserBubble({ text, project, projectTitle }: { text: string; project?: string; projectTitle: (s?: unknown) => string }) {
  return (
    <div className="msg-row user">
      <div className="user-col">
        {project && (
          <div className="user-meta small muted">
            <a className="proj-chip" href={'#/projects/' + project}>{projectTitle(project)}</a>
          </div>
        )}
        <div className="bubble user">{text}</div>
      </div>
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

const ModeBadge = ({ deep }: { deep: boolean }) => (
  <Badge tone={deep ? 'accent' : 'info'}>{deep ? <Brain className="i" /> : <Zap className="i" />} {deep ? 'Deep' : 'Fast'}</Badge>
)

function Sources({ items }: { items: SourceRef[] }) {
  const seen = new Set<string>()
  const list = items.filter((s) => {
    const k = s.url || s.path || ''
    return k && !seen.has(k) && seen.add(k)
  })
  if (!list.length) return null
  return (
    <div className="sources">
      {list.slice(0, 12).map((s) =>
        s.url ? (
          <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" title={s.url}>
            <Globe className="i sm" /> {s.title || new URL(s.url, location.href).hostname}
          </a>
        ) : (
          <a key={s.path} href={'#' + routeFor(s.path!)} title={s.path}>
            <FileText className="i sm" /> {s.path}
          </a>
        ),
      )}
    </div>
  )
}

/** An answer still streaming (or just finished, until its file loads). */
function LiveTurn({ l, projectTitle }: { l: Live; projectTitle: (s?: unknown) => string }) {
  const working = l.state === 'streaming' || l.state === 'waiting'
  return (
    <>
      <UserBubble text={l.question} project={l.project} projectTitle={projectTitle} />
      <div className="msg-row">
        <div className="ai-avatar"><Sparkles className="i sm" /></div>
        <div className="ai-msg" aria-live="polite" aria-busy={working}>
          <div className="answer-meta">
            {l.state === 'error' ? <Badge tone="bad"><TriangleAlert className="i" /> error</Badge> : <ModeBadge deep={l.model === 'deep'} />}
            {l.venue === 'actions' && <Badge tone="muted"><Cloud className="i" /> GitHub Actions</Badge>}
            {l.tools.slice(0, 4).map((t) => (
              <Badge key={t} tone="muted">{TOOL_ICON.find(([re]) => re.test(t))?.[1]} {t}</Badge>
            ))}
            {working && l.status && (
              <span className="live-status"><LoaderCircle className="i sm spin" /> {l.status}</span>
            )}
            {l.seconds !== undefined && <span className="muted small num">{l.seconds}s</span>}
          </div>
          {l.text ? <Markdown md={working ? liveMarkdown(l.text) : l.text} base={`ai/answers/${l.id}.md`} /> : working && <Typing />}
          {l.error && <div className="callout tone-bad"><TriangleAlert className="i" /> <span>{l.error}</span></div>}
          <Sources items={l.sources} />
        </div>
      </div>
    </>
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
                {a.data.status === 'error' ? <Badge tone="bad"><TriangleAlert className="i" /> error</Badge> : <ModeBadge deep={deep} />}
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
