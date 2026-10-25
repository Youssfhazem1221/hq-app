// The owner's "Edit details" card on a project page (phase 3): every field of project.md that people read, edited
// in place. Title, summary, goal and next are click-to-edit; status opens a menu; kind is a switch. Each change is
// one exact edit of the frontmatter (setTopKeys: other lines keep their bytes) that bumps `updated`, with Undo.
import type { CSSProperties, ReactNode } from 'react'
import type { Doc } from '../../lib/md'
import type { IconName } from '../../lib/contracts'
import { setTopKeys } from '../../lib/people-core'
import { Icon } from '../../lib/icons'
import { StatusPill, Switch, Widget } from '../ui'
import { InlineText, useContextMenu, useSave } from '../edit/kit'

const STATUSES = ['active', 'waiting', 'parked', 'done'] as const
const STATUS_ICON: Record<(typeof STATUSES)[number], IconName> = { active: 'zap', waiting: 'clock', parked: 'pause', done: 'ok' }
const today = () => new Date().toISOString().slice(0, 10)
const str = (v: unknown) => (v == null ? '' : String(v))
const row: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }

export function ProjectDetails({ p, slug, onClose }: { p: Doc; slug: string; onClose: () => void }) {
  const save = useSave()
  const ctx = useContextMenu()
  const name = str(p.data.title || slug).slice(0, 40)
  const set = (key: string, value: string, done: string) =>
    save(p.path, (cur) => setTopKeys(cur, { [key]: value, updated: today() }), `project: ${key} · ${name}`, done)
  const status = str(p.data.status || 'active').toLowerCase()
  const kind = str(p.data.kind || 'project').toLowerCase() === 'area' ? 'area' : 'project'
  const statusMenu = () =>
    STATUSES.map((s) => ({ label: s === status ? `${s} (now)` : s, icon: STATUS_ICON[s], disabled: s === status, run: () => void set('status', s, `Status: ${s}`) }))
  const rows: [string, ReactNode][] = [
    ['Title', <InlineText value={str(p.data.title)} label="title" max={80} onSave={(v) => set('title', v.trim(), 'Title saved')} />],
    ['Summary', <InlineText value={str(p.data.summary)} label="summary" multiline max={400} onSave={(v) => set('summary', v.trim(), 'Summary saved')} />],
    ['Goal', <InlineText value={str(p.data.goal)} label="goal" multiline max={200} onSave={(v) => set('goal', v.trim(), 'Goal saved')} />],
    ['Next', <InlineText value={str(p.data.next)} label="next step" max={140} onSave={(v) => set('next', v.trim(), 'Next step saved')} />],
    [
      'Status',
      <button type="button" className="ie" aria-haspopup="menu" aria-label={`Status: ${status}. Change it`} onClick={(e) => ctx.show(e.clientX || e.currentTarget.getBoundingClientRect().left, e.clientY || e.currentTarget.getBoundingClientRect().bottom, statusMenu(), 'Status', e.currentTarget)}>
        <StatusPill status={status} />
      </button>,
    ],
    [
      'Kind',
      <span style={row}>
        <Switch on={kind === 'area'} label="An ongoing area, not a project with an end" onChange={(on) => void set('kind', on ? 'area' : 'project', on ? 'Now an area (ongoing)' : 'Now a project (has an end)')} />
        <span className="sm">{kind === 'area' ? 'Area: ongoing, no end' : 'Project: it has an end'}</span>
      </span>,
    ],
  ]
  return (
    <Widget
      id="pdetails"
      title="Edit details"
      icon="edit"
      act={
        <button className="btn sm" type="button" onClick={onClose}>
          <Icon name="check" size="s" />
          Done
        </button>
      }
    >
      <dl className="props">
        {rows.map(([label, value]) => (
          <div key={label} className="prop">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="sm muted">Each change saves on its own (Enter or click away) and can be undone from its notice.</p>
      {ctx.menu}
    </Widget>
  )
}
