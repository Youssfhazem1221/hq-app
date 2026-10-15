// My week: check-ins per day (dot size grows with the count), today ringed, future days dimmed. One picture
// (role=img) with a spoken summary; each day has a text tooltip. Order follows the person's week start.
type Props = {
  /** 7 counts in week order; null = a day still to come. */
  counts: (number | null)[]
  /** Index of today in `counts`; default = the last day that isn't null. */
  today?: number | null
  /** First day of the week (blueprint log.week_starts). */
  start?: 'sat' | 'sun' | 'mon'
  className?: string
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const OFFSET = { sun: 0, mon: 1, sat: 6 } as const
const plural = (n: number) => `${n} check-in${n === 1 ? '' : 's'}`

export function WeekDots({ counts, today, start = 'sun', className }: Props) {
  const days = Array.from({ length: 7 }, (_, i) => DAYS[(i + OFFSET[start]) % 7])
  const cs = Array.from({ length: 7 }, (_, i) => {
    const c = counts?.[i]
    return typeof c === 'number' && Number.isFinite(c) ? Math.max(0, Math.round(c)) : c === null ? null : 0
  })
  let t = typeof today === 'number' && today >= 0 && today < 7 ? today : -1
  if (today === undefined) for (let i = 6; i >= 0; i--) if (cs[i] !== null) {
    t = i
    break
  }
  const aria = 'Check-ins this week: ' + cs.map((c, i) => `${days[i]}${i === t ? ' (today)' : ''} ${c === null ? 'to come' : c}`).join(', ')
  return (
    <div className={'week' + (className ? ' ' + className : '')} role="img" aria-label={aria}>
      {cs.map((c, i) => {
        const sz = c ? 8 + 4 * Math.min(c, 4) : 0
        const tip = `${days[i]}${i === t ? ' · today' : ''}: ${c === null ? 'later this week' : c ? plural(c) : 'no check-in'}`
        return (
          <div key={i} className={'d' + (i === t ? ' today' : '')} data-tipt={tip}>
            <span>{days[i][0]}</span>
            <span className="dw">
              {c === null ? <span className="dot fut" /> : c ? <span className="dot" style={{ width: sz, height: sz }} /> : <span className="dot zero" />}
            </span>
          </div>
        )
      })}
    </div>
  )
}
export default WeekDots
