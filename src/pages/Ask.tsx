import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Brain, Cloud, Database, FolderOpen, Globe, History, Link2, LoaderCircle, Lock, Monitor, Plug, ReceiptText, Reply, Send, Sparkles, TriangleAlert, Zap } from 'lucide-react'
import { useHQ } from '../App'
import { Ago, Badge, Card, Empty, Markdown, Segmented } from '../components/ui'
import { askAi, displayName, projectSlug, requestId, type AskOptions, type Connector } from '../lib/hq'
import { askViaEdge, edgeAvailable } from '../lib/edge'
import type { Doc } from '../lib/md'
import { ago, makeId, store } from '../lib/util'

const CONNECTORS: [Connector, ReactNode, string, string][] = [
  ['web', <Globe className="i sm" />, 'Web search', 'Google Search with cited sources'],
  ['links', <Link2 className="i sm" />, 'Read links', 'Reads any URL you paste'],
  ['history', <History className="i sm" />, 'File history', 'What changed, when, by whom (git)'],
  ['supabase', <Database className="i sm" />, 'Supabase', 'Reads your Supabase tables (read-only)'],
]
const TOOL_ICON: [RegExp, ReactNode][] = [
  [/web/, <Globe className="i" />],
  [/link/, <Link2 className="i" />],
  [/history/, <History className="i" />],
  [/supabase/i, <Database className="i" />],
  [/read |listed files|searched workspace/, <FolderOpen className="i" />],
]
const QUICK = ['What should I do next? Top 3 only.', 'Compare the money options in one table.', 'Where does my LinkedIn stand?', 'What is waiting on me right now?']
type Mode = 'fast' | 'deep'

export default function Ask() {
  const { model, me, source, reload } = useHQ()
  const [q, setQ] = useState('')
  const [connectors, setConnectors] = useState<Connector[]>(store.get('hq.connectors', ['web', 'links']))
  const [mode, setModeState] = useState<Mode>(store.get('hq.aimode', 'fast'))
  const [project, setProject] = useState<string | undefined>()
  const [busy, setBusy] = useState<string | false>(false)
  const [venue, setVenue] = useState<'local' | 'edge' | 'actions'>(source.kind === 'local' ? 'local' : 'actions')

  useEffect(() => {
    const p = store.get<{ q: string; project?: string } | null>('hq.askPrefill', null)
    if (p) {
      setQ(p.q || '')
      setProject(p.project)
      store.del('hq.askPrefill')
    }
    edgeAvailable(source).then((ok) => ok && setVenue('edge'))
  }, [source])

  const setMode = (m: Mode) => {
    store.set('hq.aimode', m)
    setModeState(m)
  }
  const toggle = (c: Connector) => {
    const next = connectors.includes(c) ? connectors.filter((x) => x !== c) : [...connectors, c]
    store.set('hq.connectors', next)
    setConnectors(next)
  }

  // Conversations: a root question + its follow-ups (same `thread`).
  const threads = useMemo(() => {
    const groups = new Map<string, Doc[]>()
    for (const r of [...model.requests].reverse()) {
      const root = String(r.data.thread || requestId(r))
      groups.set(root, [...(groups.get(root) || []), r])
    }
    const last = (rs: Doc[]) => String(rs[rs.length - 1].data.created || '')
    return [...groups.entries()].sort((a, b) => last(b[1]).localeCompare(last(a[1])))
  }, [model])

  const pending = model.requests.filter((r) => !model.answers.has(requestId(r)))
  const pendingKey = pending.map(requestId).join(',')
  // On GitHub without the edge function, an Action writes the answer: check every 10 s.
  useEffect(() => {
    if (source.kind !== 'github' || !pending.length) return
    const t = setInterval(async () => {
      for (const r of pending) {
        if (await source.read(`ai/answers/${requestId(r)}.md`).catch(() => null)) {
          await reload()
          break
        }
      }
    }, 10000)
    return () => clearInterval(t)
  }, [source, pendingKey])

  const send = async (text: string, thread?: string) => {
    if (!text.trim()) return
    setBusy(thread || 'new')
    const opts: AskOptions = { question: text.trim(), kind: 'ask', thread, connectors, model: mode, project: thread ? undefined : project }
    try {
      if (venue === 'edge') {
        await askViaEdge(source, { ...opts, id: makeId(me.login) })
        await reload()
      } else {
        const id = await askAi(source, me, opts)
        await reload()
        if (source.runAi) {
          await source.runAi(id)
          await reload()
        }
      }
      if (!thread) {
        setQ('')
        setProject(undefined)
      }
    } catch (e: any) {
      alert(e?.message || e)
    } finally {
      setBusy(false)
    }
  }

  const projectTitle = (slug?: unknown) => String(model.projects.find((p) => projectSlug(p) === slug)?.data.title || slug || '')

  return (
    <>
      <Card className="composer">
        {project && (
          <div className="row">
            <a className="proj-chip" href={'#/projects/' + project}>{projectTitle(project)}</a>
            <button className="btn ghost sm" onClick={() => setProject(undefined)}>remove</button>
          </div>
        )}
        <textarea
          rows={2}
          placeholder="Ask anything: your workspace, the web, a link… (Ctrl+Enter)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && send(q)}
        />
        <div className="connectors" aria-label="Connectors">
          <span className="chip on locked" title="Always on: your .md files"><Lock className="i sm" /> Workspace</span>
          {CONNECTORS.map(([id, icon, label, hint]) => (
            <button key={id} className={'chip' + (connectors.includes(id) ? ' on' : ' off')} onClick={() => toggle(id)} title={hint} aria-pressed={connectors.includes(id)}>
              {icon} {label}
            </button>
          ))}
        </div>
        <div className="row between wrap">
          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            options={[['fast', <><Zap className="i sm" /> Fast</>], ['deep', <><Brain className="i sm" /> Deep</>]]}
          />
          <button className="btn primary" disabled={!!busy || !q.trim()} onClick={() => send(q)}>
            {busy === 'new' ? <><LoaderCircle className="i sm spin" /> Thinking…</> : <><Sparkles className="i sm" /> Ask</>}
          </button>
        </div>
        <div className="chips">
          {QUICK.map((x) => (
            <button key={x} className="chip" disabled={!!busy} onClick={() => send(x)}>{x}</button>
          ))}
        </div>
        <div className="muted small meta-line">
          {venue === 'actions' ? <Cloud className="i sm" /> : <Monitor className="i sm" />}
          {venue === 'local' && 'Answers right here (local mode).'}
          {venue === 'edge' && 'Instant answers via Supabase.'}
          {venue === 'actions' && 'Answered by a GitHub Action, about a minute. You can leave the page.'}
          <span className="spacer" />
          <Plug className="i sm" /> More (Notion, Gmail, Drive): need API keys
        </div>
      </Card>

      {threads.length ? (
        threads.map(([root, turns]) => (
          <article key={root} className="qa thread">
            {turns.map((r, i) => (
              <Turn key={r.path} r={r} follow={i > 0} projectTitle={projectTitle} />
            ))}
            <FollowUp busy={busy === root} onSend={(t) => send(t, root)} />
          </article>
        ))
      ) : (
        <Empty icon={<Sparkles className="i" />} text="No questions yet. Try a quick one above." />
      )}
    </>
  )
}

function Turn({ r, follow, projectTitle }: { r: Doc; follow: boolean; projectTitle: (s?: unknown) => string }) {
  const { model } = useHQ()
  const a = model.answers.get(requestId(r))
  const tools: string[] = Array.isArray(a?.data.tools) ? a!.data.tools.map(String) : []
  const deep = /argon/.test(String(a?.data.model || '')) || r.data.model === 'deep'
  return (
    <>
      <div className={'q' + (follow ? ' follow' : '')}>
        <div className="row wrap">
          {follow && <Reply className="i sm" />}
          <b>{displayName(model, r.data.author)}</b>
          <Ago iso={r.data.created} />
          {r.data.kind === 'summarize' && <Badge tone="info"><ReceiptText className="i" /> summary</Badge>}
          {r.data.project && <a className="proj-chip" href={'#/projects/' + r.data.project}>{projectTitle(r.data.project)}</a>}
          {r.data.target && <a className="small" href={'#/docs/' + r.data.target}>{String(r.data.target)}</a>}
        </div>
        <div className="q-text">{r.body.trim()}</div>
      </div>
      <div className="a">
        {a ? (
          <>
            <div className="answer-meta">
              {a.data.status === 'error' ? (
                <Badge tone="bad"><TriangleAlert className="i" /> error</Badge>
              ) : (
                <Badge tone={deep ? 'accent' : 'info'}>{deep ? <Brain className="i" /> : <Zap className="i" />} {deep ? 'Deep' : 'Fast'}</Badge>
              )}
              {tools.slice(0, 5).map((t) => (
                <Badge key={t} tone="muted">{TOOL_ICON.find(([re]) => re.test(t))?.[1]} {t}</Badge>
              ))}
              {a.data.seconds !== undefined && <span className="muted small num">{String(a.data.seconds)}s</span>}
            </div>
            <Markdown md={a.body} base={a.path} />
          </>
        ) : (
          <div className="pending"><LoaderCircle className="i spin" /> Thinking… asked {ago(r.data.created)}</div>
        )}
      </div>
    </>
  )
}

function FollowUp({ busy, onSend }: { busy: boolean; onSend: (t: string) => void }) {
  const [t, setT] = useState('')
  const go = () => {
    if (!t.trim()) return
    onSend(t)
    setT('')
  }
  return (
    <div className="followup">
      <input className="grow" placeholder="Ask a follow-up…" value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} disabled={busy} />
      <button className="btn sm" disabled={busy || !t.trim()} onClick={go}>
        {busy ? <LoaderCircle className="i sm spin" /> : <Send className="i sm" />} Reply
      </button>
    </div>
  )
}
