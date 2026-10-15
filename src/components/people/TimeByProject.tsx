// Time per project, last 8 weeks (module D, blueprint Y4 "time per project → weekly charts"): one stacked bar per week,
// one series per project in the project's own colour slot, Table twin from B's Chart. EnergyLine = the weekly average
// of a scale field (own page only, blueprint §8.5).
import type { Model } from '../../lib/hq'
import type { LogField } from '../../lib/people-core'
import { colorSlot, projectSlugOf } from '../shell/shell-core'
import { Chart, stacked } from '../charts'
import { Empty } from '../ui'
import { dayMonth } from './people-ui-core'

export type TimeWeeks = { week: string; byProject: Record<string, number> }[]

/** Sum of every week's minutes (the chart is empty when 0). */
export const totalMinutes = (time: TimeWeeks) => time.reduce((a, w) => a + Object.values(w.byProject).reduce((x, y) => x + y, 0), 0)

/** The stacked spec: hours per week, series = projects (most time first, ≤8), `—` = rows without a project. */
export function timeSpec(time: TimeWeeks, model: Model) {
  const totals = new Map<string, number>()
  for (const w of time) for (const [k, v] of Object.entries(w.byProject)) totals.set(k, (totals.get(k) || 0) + v)
  const keys = [...totals.keys()].sort((a, b) => totals.get(b)! - totals.get(a)! || a.localeCompare(b)).slice(0, 8)
  // each project keeps its own colour slot; two series never share one (a project without `color:` is slot 1, so a
  // second one moves to the next free slot)
  const used = new Set<number>()
  const series = keys.map((k) => {
    const p = model.projects.find((d) => projectSlugOf(d) === k)
    let color = k === '—' ? 8 : colorSlot(p?.data.color)
    for (let i = 0; used.has(color) && i < 8; i++) color = (color % 8) + 1
    used.add(color)
    return {
      name: k === '—' ? 'No project' : String(p?.data.title || k),
      color,
      data: time.map((w) => Math.round(((w.byProject[k] || 0) / 60) * 10) / 10),
    }
  })
  return stacked({ subtitle: 'Hours per week · last 8 weeks', unit: 'h', labels: time.map((w) => dayMonth(w.week)), series })
}

export function TimeByProject({ time, model, empty }: { time: TimeWeeks; model: Model; empty?: string }) {
  if (!totalMinutes(time)) return <Empty icon="chart" text={empty || 'Log time like “45m +project” and a weekly chart appears here.'} />
  return <Chart spec={timeSpec(time, model)} />
}

export function EnergyLine({ weeks, data, field }: { weeks: string[]; data: (number | null)[]; field: LogField }) {
  if (!data.some((v) => v !== null)) return <Empty icon="chart" text={`Add ${field.key}=4 to a check-in and your weekly average shows here.`} />
  return (
    <Chart
      spec={{
        type: 'line',
        subtitle: `Weekly average, 1–${field.max || 5} · only on your page`,
        labels: weeks.map(dayMonth),
        series: [{ name: field.label, data, color: 1 }],
        min: 1,
        max: field.max || 5,
      }}
    />
  )
}
