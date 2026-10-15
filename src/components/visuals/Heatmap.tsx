// N weeks of check-ins as a calendar grid (columns = weeks, rows = days), 5 levels on the sequential ramp
// (0 · 1 · 2 · 3 · 4+). One picture (role=img) with a spoken summary; cells have text tooltips. "Less … More" key.
// No streaks, no "you missed" (blueprint rule 18).
type Props = {
  /** Counts per day, oldest first, week by week (7 per week). null = a day still to come. */
  cells: (number | null)[]
  /** ISO date (YYYY-MM-DD) of the first cell: tooltips then say the date. */
  start?: string
  /** Spoken name, e.g. "12 weeks of check-ins". */
  label?: string
  /** Illustrative data (adds "sample" to the spoken label). */
  sample?: boolean
  className?: string
}

const DAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MAX_CELLS = 7 * 53
export const heatLevel = (c: number | null) => (c === null || !(c > 0) ? 0 : c >= 4 ? 4 : Math.floor(c))

function dateAt(start: string | undefined, i: number) {
  const m = start && /^(\d{4})-(\d{2})-(\d{2})$/.exec(start)
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + i))
  return Number.isFinite(d.getTime()) ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : null
}

export function Heatmap({ cells, start, label, sample, className }: Props) {
  const cs = (Array.isArray(cells) ? cells : []).slice(0, MAX_CELLS).map((c) => (typeof c === 'number' && Number.isFinite(c) ? Math.max(0, c) : c === null ? null : 0))
  const weeks = Math.ceil(cs.length / 7)
  const days = cs.filter((c) => (c ?? 0) > 0).length
  const total = cs.reduce<number>((a, c) => a + (c ?? 0), 0)
  const name = label || `${weeks} weeks of check-ins`
  const aria = `${name}${sample ? ', sample data' : ''}: ${days} ${days === 1 ? 'day' : 'days'} with a check-in, ${total} in all`
  return (
    <div className={'heatw' + (className ? ' ' + className : '')}>
      <div className="heat" role="img" aria-label={aria}>
        {cs.map((c, i) => {
          const when = dateAt(start, i) || `Week ${Math.floor(i / 7) + 1} · ${DAY[i % 7]}`
          const tip = `${when}: ${c === null ? 'still to come' : c ? `${c} check-in${c === 1 ? '' : 's'}` : 'no check-in'}`
          return <i key={i} data-l={c === null ? 'f' : heatLevel(c)} data-tipt={tip} />
        })}
      </div>
      <div className="heat-key" aria-hidden="true">
        Less <i data-l="0" /><i data-l="1" /><i data-l="2" /><i data-l="3" /><i data-l="4" /> More
      </div>
    </div>
  )
}
export default Heatmap
