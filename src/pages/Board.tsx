import { useState, type ReactNode } from 'react'
import { Bot, Check, CircleHelp, Cloud, Inbox, Lightbulb, Megaphone, MessageCircle, NotebookPen, RotateCcw, Send } from 'lucide-react'
import { useHQ } from '../App'
import { Ago, Avatar, Badge, Card, Empty, Markdown, Segmented, toneOf } from '../components/ui'
import { displayName, patchDoc, postMessage, postReply, projectSlug } from '../lib/hq'
import type { Doc } from '../lib/md'
import { same } from '../lib/util'

const TYPE_ICON: Record<string, ReactNode> = {
  idea: <Lightbulb className="i sm" />,
  thought: <Cloud className="i sm" />,
  question: <CircleHelp className="i sm" />,
  update: <Megaphone className="i sm" />,
}
const TYPES: [string, string][] = [
  ['idea', 'Idea'],
  ['thought', 'Thought'],
  ['question', 'Question'],
  ['update', 'Update'],
]
type Filter = 'open' | 'claude' | 'mine' | 'all'

export default function Board() {
  const { model, me, source, reload } = useHQ()
  const [type, setType] = useState('idea')
  const [text, setText] = useState('')
  const [forClaude, setForClaude] = useState(false)
  const [project, setProject] = useState('')
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState<Filter>('open')

  const send = async () => {
    if (!text.trim()) return
    setSaving(true)
    try {
      await postMessage(source, me, { type, body: text.trim(), forClaude, project })
      setText('')
      setForClaude(false)
      await reload()
    } catch (e: any) {
      alert('Could not post: ' + (e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const shown = model.board.filter((m) => {
    if (filter === 'open') return m.data.status !== 'done'
    if (filter === 'claude') return m.data.for_claude && m.data.status !== 'done'
    if (filter === 'mine') return same(m.data.author, me.login)
    return true
  })

  return (
    <>
      <Card className="composer">
        <div className="chips">
          {TYPES.map(([v, label]) => (
            <button key={v} className={'chip' + (type === v ? ' on' : '')} onClick={() => setType(v)}>
              {TYPE_ICON[v]} {label}
            </button>
          ))}
        </div>
        <textarea
          rows={3}
          placeholder="Drop an idea, thought or question… (Ctrl+Enter to post)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && send()}
        />
        <div className="row between">
          <div className="row wrap">
          <select value={project} onChange={(e) => setProject(e.target.value)} title="Project">
            <option value="">No project</option>
            {model.projects.map((p) => (
              <option key={p.path} value={projectSlug(p)}>{p.data.title}</option>
            ))}
          </select>
          <label className="toggle">
            <input type="checkbox" checked={forClaude} onChange={(e) => setForClaude(e.target.checked)} /> <Bot className="i sm" /> Flag for Claude
          </label>
          </div>
          <button className="btn primary" disabled={saving || !text.trim()} onClick={send}>
            <Send className="i sm" /> {saving ? 'Posting…' : 'Post'}
          </button>
        </div>
      </Card>

      <div className="row between wrap">
        <Segmented<Filter> value={filter} onChange={setFilter} options={[['open', 'Open'], ['claude', 'For Claude'], ['mine', 'Mine'], ['all', 'All']]} />
        <span className="muted small">{shown.length} shown</span>
      </div>

      {shown.length ? shown.map((m) => <Message key={m.path} m={m} />) : <Empty icon={<Inbox className="i" />} text="Nothing here yet. Post the first idea above." />}
    </>
  )
}

function Message({ m }: { m: Doc }) {
  const { model, me, source, reload } = useHQ()
  const replies = model.replies.get(String(m.data.id)) || []
  const [open, setOpen] = useState(false)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const done = m.data.status === 'done'
  const author = displayName(model, m.data.author)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
      await reload()
    } catch (e: any) {
      alert(e?.message || e)
    } finally {
      setBusy(false)
    }
  }
  const sendReply = () => run(async () => { await postReply(source, me, String(m.data.id), reply.trim()); setReply('') })

  return (
    <article className={'msg' + (done ? ' is-done' : '')}>
      <header className="msg-h">
        <Avatar name={author} size={30} />
        <b>{author}</b>
        <Ago iso={m.data.created} />
        <span className="spacer" />
        <Badge tone={toneOf(m.data.type)}>{TYPE_ICON[m.data.type] || <NotebookPen className="i sm" />} {m.data.type}</Badge>
        {m.data.project && <a className="proj-chip" href={'#/projects/' + m.data.project}>{String(model.projects.find((p) => projectSlug(p) === m.data.project)?.data.title || m.data.project)}</a>}
        {m.data.for_claude && <Badge tone="accent"><Bot className="i" /> Claude</Badge>}
        {done && <Badge tone="ok"><Check className="i" /> done</Badge>}
      </header>
      <Markdown md={m.body} base={m.path} />
      <footer className="msg-f">
        <button className="btn ghost sm" onClick={() => setOpen(!open)}>
          <MessageCircle className="i sm" /> {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
        </button>
        <button
          className="btn ghost sm"
          disabled={busy}
          onClick={() => run(() => patchDoc(source, m, { status: done ? 'open' : 'done' }, `board: ${done ? 'reopen' : 'done'} ${m.data.id}`))}
        >
          {done ? <><RotateCcw className="i sm" /> Reopen</> : <><Check className="i sm" /> Mark done</>}
        </button>
      </footer>
      {open && (
        <div className="replies">
          {replies.map((r) => (
            <div key={r.path} className="reply">
              <Avatar name={displayName(model, r.data.author)} size={22} />
              <div>
                <div className="small">
                  <b>{displayName(model, r.data.author)}</b> <Ago iso={r.data.created} />
                </div>
                <Markdown md={r.body} base={r.path} />
              </div>
            </div>
          ))}
          <div className="row">
            <input
              className="grow"
              placeholder="Write a reply…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && reply.trim() && sendReply()}
            />
            <button className="btn primary sm" disabled={busy || !reply.trim()} onClick={sendReply}>
              Send
            </button>
          </div>
        </div>
      )}
    </article>
  )
}
