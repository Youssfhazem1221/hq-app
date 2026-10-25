// Project page (spec §6.3): header (status, stale dot only, non-zero tiles) → the journey strip with the project's ONE
// Next inside → the project's first hand-written explainer (project file, folder notes, then its main page) or its auto
// picture (`options:` → the speed × evidence scatter) → Numbers (`metrics:` → goal meter, a line once there are two
// reads) → Team + Pages → Recent activity (this project's files only, loaded when opened). Block order and hidden
// blocks follow the look prefs (project_order / project_hidden).
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useHQ, usePrefsApi } from '../lib/hq-context'
import type { PageProps, ProjectWidget } from '../lib/contracts'
import { displayName, projectFolder } from '../lib/hq'
import type { Doc } from '../lib/md'
import { boardConfig } from '../lib/project-board'
import { setTopKeys } from '../lib/people-core'
import { addFirstMilestone } from '../lib/people'
import type { Commit } from '../lib/source'
import { appendMilestone, decisionDoc, isDecision, isOpenTodo, projectOfTodo, tickMilestone, untickMilestone, type NextModel } from '../lib/next-core'
import { parseExplainer } from '../components/explainers/parse'
import { BLOCKS, newBlockCtx, splitBlocks } from '../components/blocks'
import { PageHeader } from '../components/shell/PageHeader'
import { Avatar, Empty, StatusPill, Widget } from '../components/ui'
import { Chart } from '../components/charts'
import { Journey } from '../components/visuals/Journey'
import { Scatter } from '../components/visuals/Scatter'
import { GoalMeter } from '../components/visuals/GoalMeter'
import TeamCard from '../components/people/TeamCard'
import { ProjectBoard } from '../components/project/Board'
import { ProjectPages } from '../components/project/Pages'
import { ProjectFiles } from '../components/project/Files'
import { NextActionsProvider, useProjectNext } from '../components/NextActions'
import { Icon } from '../lib/icons'
import { toast } from '../components/toast'
import { AgeTip, ProjectGlyph, StaleDot, humanChange, plural, projectBySlug, same, slotOf, todoAsItem } from '../components/work-ui'

export const v3 = true

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = (d: string) => (/^\d{4}-\d{2}-\d{2}/.test(d) ? `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}` : d)

export default function ProjectPage({ route }: PageProps) {
  return (
    <NextActionsProvider>
      <Project slug={route?.slug || ''} />
    </NextActionsProvider>
  )
}

function Project({ slug }: { slug: string }) {
  const { model } = useHQ()
  const p = projectBySlug(model, slug)
  const next = useProjectNext(slug)
  if (!p)
    return (
      <>
        <PageHeader icon="projects" title="Project" />
        <Empty icon="projects" text={`No project called “${slug}”.`}>
          <a className="btn sm" href="#/projects">All projects</a>
        </Empty>
      </>
    )
  return <ProjectView p={p} slug={slug} next={next} />
}

function ProjectView({ p, slug, next }: { p: Doc; slug: string; next: ReturnType<typeof useProjectNext> }) {
  const { model, me, source, reload } = useHQ()
  const { prefs } = usePrefsApi()
  const m = model as unknown as NextModel
  const openTodos = model.todos.filter((t) => isOpenTodo(t) && projectOfTodo(t, m) === slug)
  const order: ProjectWidget[] = (prefs.project_order?.length ? prefs.project_order : (['journey', 'explainers', 'team', 'files', 'activity'] as ProjectWidget[])).filter(
    (w) => !(prefs.project_hidden || []).includes(w),
  )

  // owner: edit the milestones in place (tick / untick / add), each with Undo
  const editMilestones = async (fn: (cur: string) => string, message: string, done: string) => {
    let before: string | null = null
    let after: string | null = null
    try {
      const ok = await source.update(p.path, (cur) => {
        before = cur
        after = null
        if (cur === null) return null
        const next = fn(cur)
        if (next === cur) return null
        after = next
        return next
      }, message)
      if (!ok || after === null) return
      await reload()
      toast(done, 'ok', {
        undo: () => {
          source
            .update(p.path, (cur) => (cur !== null && cur === after && before !== null ? before : cur), 'project: undo milestone change')
            .then(() => reload())
            .catch((e) => toast(String(e?.message || e), 'error'))
        },
      })
    } catch (e: any) {
      toast(String(e?.message || e), 'error')
    }
  }
  const msText = (i: number) => String(((p.data.milestones as any[]) || [])[i]?.text || '').slice(0, 40)
  const toggleMilestone = (index: number, done: boolean) =>
    editMilestones(
      (cur) => (done ? tickMilestone(cur, index, new Date().toISOString().slice(0, 10)) : untickMilestone(cur, index)),
      `project: milestone ${done ? 'done' : 'reopened'} · ${msText(index)}`,
      done ? `Done: ${msText(index)} 🎉` : `Reopened: ${msText(index)}`,
    )
  // no milestones yet: the first one also clears the template's placeholder next:
  const addMilestone = async (text: string) => {
    const has = Array.isArray(p.data.milestones) && p.data.milestones.length > 0
    if (!has) {
      try {
        if (await addFirstMilestone(source, me, p.path, text)) toast('Milestone added', 'ok')
        await reload()
      } catch (e: any) {
        toast(String(e?.message || e), 'error')
      }
      return
    }
    await editMilestones((cur) => appendMilestone(cur, text), `project: milestone added · ${text.slice(0, 40)}`, 'Milestone added')
  }

  // owner: mark the whole project done (or reopen it), with Undo
  const owner = same(p.data.owner, me.login)
  const msList: any[] = Array.isArray(p.data.milestones) ? p.data.milestones : []
  const allDone = msList.length > 0 && msList.every((x) => x && x.done === true)
  const isDone = String(p.data.status || '').toLowerCase() === 'done'
  const setStatus = async (status: 'done' | 'active') => {
    let before: string | null = null
    let after: string | null = null
    try {
      const ok = await source.update(p.path, (cur) => {
        before = cur
        after = cur === null ? null : setTopKeys(cur, { status, updated: new Date().toISOString().slice(0, 10) })
        return after
      }, `project: ${status === 'done' ? 'done' : 'reopened'} · ${String(p.data.title || slug).slice(0, 40)}`)
      if (!ok) return
      await reload()
      toast(status === 'done' ? 'Project marked done 🎉' : 'Project reopened', 'ok', {
        undo: () => {
          source
            .update(p.path, (cur) => (cur !== null && cur === after && before !== null ? before : cur), 'project: undo status')
            .then(() => reload())
            .catch((e) => toast(String(e?.message || e), 'error'))
        },
      })
    } catch (e: any) {
      toast(String(e?.message || e), 'error')
    }
  }

  const blocks: Record<ProjectWidget, ReactNode> = {
    journey: (
      <Journey
        project={p}
        next={next}
        onAddMilestone={same(p.data.owner, me.login) ? addMilestone : undefined}
        onToggleMilestone={same(p.data.owner, me.login) ? toggleMilestone : undefined}
      />
    ),
    explainers: (
      <>
        <ProjectBoard p={p} slug={slug} />
        <ProjectPicture p={p} slug={slug} />
      </>
    ),
    team: null, // drawn with files (one row)
    files: null,
    activity: <Activity p={p} slug={slug} />,
  }
  // a board or many pages: team and pages each get a full row, so the grouped pages have room
  const wide = !!boardConfig(p, slug) || (model.projectFiles.get(slug)?.length || 0) > 12
  // data, tables, images, media and web pages of the project (not its notes): the file viewer opens them
  const filesRow = order.includes('files') && (
    <div className="wg pj-row">
      <div className="g12">
        <ProjectFiles slug={slug} />
      </div>
    </div>
  )
  const teamRow = wide ? (
    <>
      {order.includes('team') && (
        <div className="wg pj-row">
          <div className="g12 secondary">
            <TeamCard project={p} />
          </div>
        </div>
      )}
      {order.includes('files') && (
        <div className="wg pj-row">
          <div className="g12">
            <ProjectPages p={p} slug={slug} />
          </div>
        </div>
      )}
      {filesRow}
    </>
  ) : order.includes('team') || order.includes('files') ? (
    <>
      <div className="wg pj-row">
        {order.includes('team') && (
          <div className={(order.includes('files') ? 'g7' : 'g12') + ' secondary'}>
            <TeamCard project={p} />
          </div>
        )}
        {order.includes('files') && (
          <div className={order.includes('team') ? 'g5' : 'g12'}>
            <ProjectPages p={p} slug={slug} />
          </div>
        )}
      </div>
      {filesRow}
    </>
    ) : null
  let teamDrawn = false

  return (
    <div className="work-page pj-page">
      <PageHeader
        glyph={<ProjectGlyph project={p} lg />}
        title={String(p.data.title || slug)}
        sub={
          <>
            <StatusPill status={p.data.status} />
            <StaleDot updated={p.data.updated} />
            {owner && (
              <button className={'btn sm ' + (allDone && !isDone ? 'primary' : 'ghost')} type="button" onClick={() => void setStatus(isDone ? 'active' : 'done')}>
                <Icon name={isDone ? 'undo' : 'ok'} size="s" />
                {isDone ? 'Reopen project' : 'Mark project done'}
              </button>
            )}
          </>
        }
        tiles={[openTodos.length ? { value: openTodos.length, label: openTodos.length === 1 ? 'open to-do' : 'open to-dos' } : null]}
      />
      {order.map((w) => {
        if (w === 'team' || w === 'files') {
          if (teamDrawn) return null
          teamDrawn = true
          return <Fragment key="team">{teamRow}</Fragment>
        }
        return <Fragment key={w}>{blocks[w]}</Fragment>
      })}
    </div>
  )
}

// ---- the one picture: a hand-written explainer, else the auto one ----

/** The first ```explainer that parses in the project file, its folder notes, then its main page (`hub`). */
function firstExplainer(model: ReturnType<typeof useHQ>['model'], p: Doc, slug: string): { src: string; path: string } | null {
  const seen = new Set<string>()
  const docs: Doc[] = []
  const add = (d: Doc | undefined) => {
    if (d && !seen.has(d.path)) {
      seen.add(d.path)
      docs.push(d)
    }
  }
  add(p)
  for (const d of model.projectFiles.get(slug) || []) add(d)
  add(model.byPath.get(String(p.data.hub || '')))
  for (const d of docs) {
    for (const part of splitBlocks(d.body || '')) {
      if (part.kind !== 'explainer') continue
      if (parseExplainer(part.src, { exists: (x: string) => model.byPath.has(x) })) return { src: part.src, path: d.path }
    }
  }
  return null
}

function ProjectPicture({ p, slug }: { p: Doc; slug: string }) {
  const { model } = useHQ()
  const m = model as unknown as NextModel
  const ex = useMemo(() => firstExplainer(model, p, slug), [model, p, slug])
  // the doc with options: (main page first) and any decision about it
  const optDoc = useMemo(() => {
    const cands = [p, model.byPath.get(String(p.data.hub || '')), ...(model.projectFiles.get(slug) || [])].filter(Boolean) as Doc[]
    return cands.find((d) => Array.isArray(d.data.options) && d.data.options.length > 0)
  }, [model, p, slug])
  const decisions = optDoc ? model.todos.filter((t) => isDecision(t, m) && decisionDoc(t, m)?.path === optDoc.path) : []
  const open = decisions.find(isOpenTodo)
  const decided = decisions.filter((t) => !isOpenTodo(t) && t.data.choice).sort((a, b) => String(b.data.done_at || '').localeCompare(String(a.data.done_at || '')))[0]

  let body: ReactNode = null
  if (ex) {
    const ctx = newBlockCtx(ex.path, open ? todoAsItem(open, model) : null)
    body = BLOCKS.explainer(ex.src, ctx)
  } else if (optDoc) {
    const picked = decided ? Number(String(decided.data.choice).match(/^#(\d+)/)?.[1]) || null : null
    const n = optDoc.data.options.length
    body = (
      <section className="w" id="options">
        <Scatter
          options={optDoc.data.options}
          pick={picked}
          title={`${n} ${n === 1 ? 'option' : 'options'}: speed × how sure we are`}
          sub="Top right = fast money, verified"
          chip={decided ? <span className="chip acc"><Icon name="check" />Picked {String(decided.data.choice).slice(0, 40)}</span> : undefined}
        />
      </section>
    )
  }
  const numbers = hasMetrics(p) ? <Numbers p={p} /> : null
  if (!body && !numbers) return null
  return (
    <div className="pj-pic">
      {body}
      {numbers}
    </div>
  )
}

const hasMetrics = (p: Doc) => Array.isArray(p.data.metrics) && p.data.metrics.some((r: any) => r && typeof r === 'object' && Object.keys(r).some((k) => k !== 'date' && k !== 'source' && num(r[k]) !== null))

/** `metrics:` → one goal meter (+ up to 3 other numbers from the newest read); two reads or more → a line with the
 *  goal as a reference line. Owner: Set a goal writes `goal_<metric>:` (Undo restores the file). */
function Numbers({ p }: { p: Doc }) {
  const { model, me, source, reload } = useHQ()
  const rows = (Array.isArray(p.data.metrics) ? p.data.metrics : []).filter((r: unknown) => r && typeof r === 'object') as Record<string, unknown>[]
  if (!rows.length) return null
  const sorted = [...rows].sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')))
  const last = sorted[sorted.length - 1]
  const keys = Object.keys(last).filter((k) => k !== 'date' && k !== 'source' && num(last[k]) !== null)
  if (!keys.length) return null
  const labels = (p.data.metric_labels && typeof p.data.metric_labels === 'object' ? p.data.metric_labels : {}) as Record<string, string>
  const key = keys.find((k) => num(p.data['goal_' + k]) !== null) || keys[0]
  const label = (k: string) => String(labels[k] || k.replace(/_/g, ' ')).trim()
  const goal = num(p.data['goal_' + key])
  const owner = same(p.data.owner, me.login)
  const color = slotOf(p)
  const reads = sorted.length
  const setGoal = async (n: number) => {
    let before: string | null = null
    let after: string | null = null
    try {
      const ok = await source.update(p.path, (cur) => {
        before = cur
        after = cur === null ? null : setTopKeys(cur, { ['goal_' + key]: n })
        return after
      }, `project: goal ${key} ${n} · ${String(p.data.title || '').slice(0, 40)}`)
      if (!ok) return
      await reload()
      toast(`Goal set: ${n.toLocaleString('en')} ${label(key).toLowerCase()}`, 'ok', {
        undo: () => {
          source
            .update(p.path, (cur) => (cur !== null && cur === after && before !== null ? before : cur), `project: undo goal ${key}`)
            .then(() => reload())
            .catch((e) => toast(String(e?.message || e), 'error'))
        },
      })
    } catch (e: any) {
      toast(String(e?.message || e), 'error')
    }
  }
  const lastDate = String(last.date ?? '')
  return (
    <div id="numbers">
      <Widget id="numbers" title="Numbers" icon="chart">
        <GoalMeter
          value={num(last[key])!}
          label={label(key).toLowerCase()}
          goal={goal}
          color={color}
          onSetGoal={owner ? setGoal : undefined}
          goalLabel={label(key) + ' goal'}
          note={reads < 2 ? `${plural(reads, 'read')} so far${lastDate ? ' (' + dayLabel(lastDate) + ')' : ''}. A trend line appears after the next read.` : undefined}
          extra={keys.filter((k) => k !== key).slice(0, 3).map((k) => ({ value: num(last[k])!.toLocaleString('en'), label: label(k) }))}
        />
        {reads >= 2 && (
          <Chart
            spec={{
              type: 'line',
              title: label(key),
              labels: sorted.map((r) => dayLabel(String(r.date ?? ''))),
              series: [{ name: label(key), data: sorted.map((r) => num(r[key])), color }],
              ...(goal !== null ? { goal } : {}),
            }}
          />
        )}
      </Widget>
    </div>
  )
}

// ---- activity ----

function Activity({ p, slug }: { p: Doc; slug: string }) {
  const { model, source } = useHQ()
  const [acts, setActs] = useState<Commit[] | null>(null)
  const load = () => {
    if (acts !== null) return
    const paths = [projectFolder(p) || p.path, `projects/${slug}.md`].filter((x, i, a) => a.indexOf(x) === i)
    Promise.all(paths.map((x) => source.activity(x).catch(() => [] as Commit[]))).then((rs) => {
      const seen = new Set<string>()
      setActs(rs.flat().filter((c) => !seen.has(c.sha) && (seen.add(c.sha), true)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6))
    })
  }
  return (
    <details className="tg w pj-act secondary" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && load()}>
      <summary>
        <Icon name="chevR" size="s" className="chev" />
        <Icon name="history" size="s" />
        <span className="sm">Recent activity in this project</span>
      </summary>
      <div className="tg-body">
        {acts === null ? (
          <p className="sm muted">Loading…</p>
        ) : acts.length ? (
          <div className="rows">
            {acts.map((c) => (
              <div key={c.sha} className="row">
                <Avatar name={displayName(model, c.actor)} bot={/^(claude|hq-ai|hq-digest)$/i.test(c.actor)} size={24} />
                <span className="t sm">{humanChange(c, (l) => displayName(model, l))}</span>
                <span className="meta">
                  <AgeTip model={model} iso={c.date} />
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="sm muted">No changes in this project’s files yet.</p>
        )}
      </div>
    </details>
  )
}
