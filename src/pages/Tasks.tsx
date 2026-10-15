// Tasks (spec §6.6): the global Next · Board / List · filter chips only when the sets differ · quick-add (`+project`,
// `@login`) · To do in Next order (decisions get Decide, to-dos a tick) · one slim Doing/Done lane until something
// lands there. Keys on a card: S = start, X = tick (single-key shortcuts follow the `keys` pref). Every change has an
// Undo toast; status moves go through setTodoStatus (ticks through the Next actions, so the matching bar fills).
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useHQ, usePrefsApi } from '../lib/hq-context'
import { HQ_EVENTS, type PageProps } from '../lib/contracts'
import { Icon } from '../lib/icons'
import { isTyping } from '../lib/focus'
import { store } from '../lib/util'
import { addTodo, displayName } from '../lib/hq'
import type { Doc } from '../lib/md'
import { projectOfTodo, projectSlugOf, todoTitle, type NextModel } from '../lib/next-core'
import { PageHeader } from '../components/shell/PageHeader'
import { Chip, Empty, Segmented } from '../components/ui'
import { NextActionsProvider, useNext } from '../components/NextActions'
import { toast } from '../components/toast'
import { AgeTip, ProjectTag, TodoControl, clip, moveTodo, same, shortTitle } from '../components/work-ui'

export const v3 = true

type View = 'board' | 'list'
type Who = 'mine' | 'others' | 'all'
const VIEW_KEY = 'hq.tasks.view'
const WEEK = 7 * 864e5
const statusOf = (t: Doc) => {
  const s = String(t.data.status || 'todo').toLowerCase()
  return s === 'doing' || s === 'done' ? s : 'todo'
}

export default function TasksPage(_: PageProps) {
  return (
    <NextActionsProvider>
      <Tasks />
    </NextActionsProvider>
  )
}

function Tasks() {
  const { model, me } = useHQ()
  const { first, queue } = useNext()
  const [view, setView] = useState<View>(() => store.get<View>(VIEW_KEY, 'board'))
  const [who, setWho] = useState<Who>('mine')

  const rank = useMemo(() => new Map(queue.map((it, i) => [it.id, i])), [queue])
  const age = (a: Doc, b: Doc) => String(a.data.created || '').localeCompare(String(b.data.created || '')) || a.path.localeCompare(b.path)
  const byQueue = (a: Doc, b: Doc) => (rank.get('todo:' + a.path) ?? 1e6) - (rank.get('todo:' + b.path) ?? 1e6) || age(a, b)

  const mineAll = model.todos.filter((t) => same(t.data.owner, me.login))
  const openMine = mineAll.filter((t) => statusOf(t) === 'todo')
  const fromOthers = openMine.filter((t) => t.data.by && !same(t.data.by, me.login))
  const openAll = model.todos.filter((t) => statusOf(t) === 'todo')
  const sets: Record<Who, Doc[]> = { mine: openMine, others: fromOthers, all: openAll }
  const chips: Who[] = [
    ...(fromOthers.length > 0 && fromOthers.length < openMine.length ? (['others'] as Who[]) : []),
    ...(openAll.length > openMine.length ? (['all'] as Who[]) : []),
  ]
  const active: Who = chips.includes(who) ? who : 'mine'
  const scope = (t: Doc) => (active === 'all' ? true : active === 'others' ? same(t.data.owner, me.login) && t.data.by && !same(t.data.by, me.login) : same(t.data.owner, me.login))
  const todo = sets[active].slice().sort((a, b) => (same(a.data.owner, me.login) ? 0 : 1) - (same(b.data.owner, me.login) ? 0 : 1) || byQueue(a, b))
  const doing = model.todos.filter((t) => statusOf(t) === 'doing' && scope(t)).sort(age)
  const now = Date.now()
  const doneRecent = model.todos
    .filter((t) => statusOf(t) === 'done' && scope(t) && now - Date.parse(String(t.data.done_at || '')) < WEEK)
    .sort((a, b) => String(b.data.done_at || '').localeCompare(String(a.data.done_at || '')))
  const doneMine = mineAll.filter((t) => statusOf(t) === 'done' && now - Date.parse(String(t.data.done_at || '')) < WEEK).length

  const pick = (v: View) => {
    setView(v)
    store.set(VIEW_KEY, v)
  }
  const chipLabel: Record<Who, string> = { mine: 'Mine', others: 'From others', all: 'Everyone' }

  return (
    <div className="work-page tasks">
      <PageHeader
        icon="tasks"
        title="Tasks"
        tiles={[openMine.length ? { value: openMine.length, label: 'to do' } : null, doneMine ? { value: doneMine, label: 'done this week' } : null]}
        next={first}
      />
      <div className="toolbar">
        <Segmented
          value={view}
          onChange={pick}
          label="View"
          options={[
            ['board', <><Icon name="cols" />Board</>],
            ['list', <><Icon name="list" />List</>],
          ]}
        />
        {chips.length > 0 && (
          <div className="chips" role="group" aria-label="Whose to-dos">
            {(['mine', ...chips] as Who[]).map((w) => (
              <Chip key={w} pressed={active === w} onClick={() => setWho(w)}>
                {chipLabel[w]} · {sets[w].length}
              </Chip>
            ))}
          </div>
        )}
      </div>
      <QuickAdd />
      {view === 'board' ? (
        <Board todo={todo} doing={doing} done={doneRecent} />
      ) : (
        <div className="w">
          {todo.length + doing.length ? (
            <div className="rows" role="list">
              {[...doing, ...todo].map((t) => (
                <TaskRow key={t.path} t={t} />
              ))}
            </div>
          ) : (
            <Empty icon="inbox" text="Nothing waiting. Add a to-do above." />
          )}
        </div>
      )}
    </div>
  )
}

// ---- quick add ----

function QuickAdd() {
  const { model, me, source, reload } = useHQ()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const onNew = (e: Event) => {
      if ((e as CustomEvent).detail?.page !== 'Tasks') return
      e.preventDefault()
      input.current?.focus()
    }
    addEventListener(HQ_EVENTS.newItem, onNew)
    return () => removeEventListener(HQ_EVENTS.newItem, onNew)
  }, [])
  const parse = (s: string) => {
    let project: string | undefined
    let owner = me.login
    const pt = s.match(/(^|\s)\+([\w-]{1,40})/)
    if (pt) {
      const q = pt[2].toLowerCase()
      const hit = model.projects.find((p) => {
        const slug = projectSlugOf(p)
        return slug.startsWith(q) || slug.split('-').some((x) => x.startsWith(q)) || shortTitle(p, slug).toLowerCase().startsWith(q)
      })
      if (hit) project = projectSlugOf(hit)
    }
    const at = s.match(/(^|\s)@([A-Za-z0-9-]{1,39})/)
    if (at) owner = model.knownLogins.find((l) => same(l, at[2])) || (same(at[2], me.login) ? me.login : owner)
    const title = s.replace(/(^|\s)[+@][\w-]+/g, ' ').replace(/\s+/g, ' ').trim()
    return { title, project, owner }
  }
  const preview = text.trim() ? parse(text) : null
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const p = parse(text)
    if (!p.title || busy) return
    setBusy(true)
    try {
      await addTodo(source, me, { title: p.title.slice(0, 200), owner: p.owner, project: p.project })
      await reload()
      setText('')
      toast('To-do added' + (p.owner !== me.login ? ' for ' + displayName(model, p.owner) : ''), 'ok')
      setTimeout(() => input.current?.focus(), 30)
    } catch (err: any) {
      toast(String(err?.message || err), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="askbar quickadd" onSubmit={submit}>
      <Icon name="plus" />
      <label className="sr" htmlFor="newtodo">
        New to-do
      </label>
      <input
        ref={input}
        id="newtodo"
        placeholder="Add a to-do…  +project"
        autoComplete="off"
        maxLength={220}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {preview && (preview.project || preview.owner !== me.login) && (
        <span className="qa-reads hide-m" aria-live="polite">
          {preview.project && <ProjectTag model={model} slug={preview.project} />}
          {preview.owner !== me.login && <span className="chip line">for {displayName(model, preview.owner)}</span>}
        </span>
      )}
      <span className="kbd hide-m">N</span>
    </form>
  )
}

// ---- board / rows ----

function useCardKeys(t: Doc) {
  const { me, source, reload } = useHQ()
  const { prefs } = usePrefsApi()
  return (e: KeyboardEvent) => {
    if (prefs.keys === 'off' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
    if (e.key.toLowerCase() === 's' && statusOf(t) === 'todo') {
      e.preventDefault()
      e.stopPropagation()
      void moveTodo(source, me, t, 'doing', reload, 'Started: ' + clip(todoTitle(t), 40))
    }
    if (e.key.toLowerCase() === 'x' && statusOf(t) !== 'done') {
      const box = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('.cbx,.dec')
      if (box && box !== e.target) {
        e.preventDefault()
        e.stopPropagation()
        box.click()
      }
    }
  }
}

function Meta({ t }: { t: Doc }) {
  const { model, me } = useHQ()
  const slug = projectOfTodo(t, model as unknown as NextModel)
  const other = !same(t.data.owner, me.login)
  return (
    <>
      {slug && <ProjectTag model={model} slug={slug} />}
      {t.data.blocker && (
        <span className="chip warn" data-tipt="Someone is blocked on this">
          <Icon name="blocked" />
          blocker
        </span>
      )}
      {other && <span className="chip line">{displayName(model, t.data.owner)}</span>}
      <span className="sp" />
      <AgeTip model={model} iso={t.data.created} by={t.data.by} />
    </>
  )
}

function Card({ t }: { t: Doc }) {
  const { model, me, source, reload } = useHQ()
  const keys = useCardKeys(t)
  const done = statusOf(t) === 'done'
  return (
    <div className={'kcard' + (done ? ' isdone' : '')} onKeyDown={keys}>
      <div className="kt">
        <TodoControl todo={t} model={model} onReopen={(x) => moveTodo(source, me, x, 'todo', reload, 'Reopened: ' + clip(todoTitle(x), 40))} />
        <span>{todoTitle(t)}</span>
      </div>
      <div className="km">
        <Meta t={t} />
      </div>
    </div>
  )
}

function Board({ todo, doing, done }: { todo: Doc[]; doing: Doc[]; done: Doc[] }) {
  const slim = !doing.length && !done.length
  return (
    <div className={'kb' + (slim ? ' slim' : '')}>
      <div className="kcol">
        <h3>
          <Icon name="tasks" size="s" />
          To do <span className="n">{todo.length}</span>
        </h3>
        {todo.length ? todo.map((t) => <Card key={t.path} t={t} />) : <div className="kempty">Nothing waiting. Add one above.</div>}
      </div>
      {slim ? (
        <div className="kcol lane">
          <h3>
            <Icon name="doing" size="s" />
            Doing <span className="n">0</span>
          </h3>
          <h3>
            <Icon name="done" size="s" />
            Done <span className="n">0</span>
          </h3>
          <p className="hint">Tick a card and it lands here.</p>
        </div>
      ) : (
        <>
          <div className="kcol">
            <h3>
              <Icon name="doing" size="s" />
              Doing <span className="n">{doing.length}</span>
            </h3>
            {doing.length ? doing.map((t) => <Card key={t.path} t={t} />) : <div className="kempty">Nothing started yet</div>}
          </div>
          <div className="kcol">
            <h3>
              <Icon name="done" size="s" />
              Done <span className="n">{done.length}</span>
            </h3>
            {done.length ? done.map((t) => <Card key={t.path} t={t} />) : <div className="kempty">Tick a card and it lands here</div>}
          </div>
        </>
      )}
    </div>
  )
}

function TaskRow({ t }: { t: Doc }) {
  const { model, me, source, reload } = useHQ()
  const keys = useCardKeys(t)
  return (
    <div className="row frow" role="listitem" onKeyDown={keys}>
      <TodoControl todo={t} model={model} onReopen={(x) => moveTodo(source, me, x, 'todo', reload, 'Reopened: ' + clip(todoTitle(x), 40))} />
      <span className="t" title={todoTitle(t)}>
        {todoTitle(t)}
      </span>
      {statusOf(t) === 'doing' && <span className="chip acc">doing</span>}
      <span className="meta">
        <Meta t={t} />
      </span>
    </div>
  )
}

