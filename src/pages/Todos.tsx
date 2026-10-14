import { useState, type ReactNode } from 'react'
import { Check, ChevronLeft, CircleDashed, FileText, FolderOpen, Flame, PartyPopper, Play, Square } from 'lucide-react'
import { useHQ } from '../App'
import { Ago, Avatar, Card, Empty, Segmented } from '../components/ui'
import { addTodo, displayName, patchDoc, projectSlug } from '../lib/hq'
import type { Doc } from '../lib/md'
import { same } from '../lib/util'

const COLS: [string, ReactNode, string][] = [
  ['todo', <CircleDashed className="i" />, 'To do'],
  ['doing', <Flame className="i" />, 'Doing'],
  ['done', <Check className="i" />, 'Done'],
]
const ORDER = ['todo', 'doing', 'done']
const statusOf = (t: Doc) => (ORDER.includes(t.data.status) ? t.data.status : 'todo')

export default function Todos() {
  const { model, me, source, reload } = useHQ()
  const [title, setTitle] = useState('')
  const owners = [...new Set([me.login, ...model.people.map((p) => String(p.data.github || '')).filter(Boolean)])]
  const [owner, setOwner] = useState(me.login)
  const [project, setProject] = useState('')
  const [who, setWho] = useState<'mine' | 'all'>('all')
  const [busy, setBusy] = useState(false)

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
  const add = () => title.trim() && run(async () => { await addTodo(source, me, { title: title.trim(), owner, project }); setTitle('') })
  const move = (t: Doc, dir: 1 | -1) => {
    const next = ORDER[ORDER.indexOf(statusOf(t)) + dir]
    if (next) run(() => patchDoc(source, t, { status: next }, `todo: ${next} · ${String(t.data.title).slice(0, 50)}`))
  }

  const todos = model.todos.filter((t) => who === 'all' || same(t.data.owner, me.login))
  const byDoc = new Map<string, typeof model.tasks>()
  for (const t of model.tasks) byDoc.set(t.path, [...(byDoc.get(t.path) || []), t])

  return (
    <>
      <Card className="composer">
        <div className="row wrap">
          <input
            className="grow"
            placeholder="Add a to-do… (Enter to add)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <select value={owner} onChange={(e) => setOwner(e.target.value)} title="Owner">
            {owners.map((o) => (
              <option key={o} value={o}>{displayName(model, o)}</option>
            ))}
          </select>
          <select value={project} onChange={(e) => setProject(e.target.value)} title="Project">
            <option value="">No project</option>
            {model.projects.map((p) => (
              <option key={p.path} value={projectSlug(p)}>{p.data.title}</option>
            ))}
          </select>
          <button className="btn primary" disabled={busy || !title.trim()} onClick={add}>
            Add
          </button>
        </div>
      </Card>

      <div className="row between wrap">
        <Segmented value={who} onChange={setWho} options={[['all', 'Everyone'], ['mine', 'Only mine']]} />
        <span className="muted small">{todos.filter((t) => statusOf(t) !== 'done').length} open</span>
      </div>

      <div className="kanban">
        {COLS.map(([status, icon, label]) => {
          const items = todos.filter((t) => statusOf(t) === status)
          const visible = status === 'done' ? items.slice(0, 12) : items
          return (
            <section key={status} className={'col col-' + status}>
              <h3>
                {icon} {label} <span className="muted">{items.length}</span>
              </h3>
              {visible.length ? (
                visible.map((t) => (
                  <div key={t.path} className="todo">
                    <div className="todo-t">{t.data.title}</div>
                    <div className="todo-m">
                      <Avatar name={displayName(model, t.data.owner)} size={20} />
                      <span className="small">{displayName(model, t.data.owner)}</span>
                      <Ago iso={t.data.created} />
                      {t.data.project && <a className="proj-chip" href={'#/projects/' + t.data.project}>{String(model.projects.find((p) => projectSlug(p) === t.data.project)?.data.title || t.data.project)}</a>}
                      {t.data.link && <a className="small meta-line" href={'#/docs/' + t.data.link}><FileText className="i sm" /> doc</a>}
                    </div>
                    <div className="todo-a">
                      {status !== 'todo' && <button className="btn ghost sm" disabled={busy} onClick={() => move(t, -1)} aria-label="Move back"><ChevronLeft className="i sm" /></button>}
                      {status !== 'done' && (
                        <button className="btn ghost sm" disabled={busy} onClick={() => move(t, 1)}>
                          {status === 'todo' ? <><Play className="i sm" /> Start</> : <><Check className="i sm" /> Done</>}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="muted small pad">Empty</div>
              )}
            </section>
          )
        })}
      </div>

      <Card icon={<FolderOpen className="i" />} title="Open checkboxes inside docs" extra={<span className="muted small">{model.tasks.length} items · read-only</span>}>
        {byDoc.size ? (
          [...byDoc.entries()].map(([path, tasks]) => (
            <details key={path} className="fold">
              <summary>
                <b>{tasks[0].doc}</b> <span className="muted small">· {tasks.length}</span>
              </summary>
              <ul className="check-list">
                {tasks.map((t, i) => (
                  <li key={i}>
                    <span className="box"><Square className="i sm" /></span>
                    <span>{t.text}</span>
                    <a className="small" href={'#/docs/' + path}>open</a>
                  </li>
                ))}
              </ul>
            </details>
          ))
        ) : (
          <Empty icon={<PartyPopper className="i" />} text="No open checkboxes in the docs." />
        )}
      </Card>
    </>
  )
}
