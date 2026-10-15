// Beads (spec D5): a project's milestones as ONE picture for cards and tiles (role=img, one spoken label "8 of 10
// milestones done, next: …"). Never buttons: cards are links, and controls inside links are banned. The interactive
// version is the Journey strip on the project page.
import { useMemo } from 'react'
import { journeyModel, type DocLike } from '../../lib/auto-visuals'

type Props = {
  /** The project's project.md (a parsed Doc). */
  project: DocLike | null | undefined
  /** Bigger beads (project gallery). */
  lg?: boolean
  /** Also show "8/10" next to the beads (decorative; the picture already says it). */
  count?: boolean
  className?: string
}

export function Beads({ project, lg, count, className }: Props) {
  const m = useMemo(() => journeyModel(project, null), [project])
  if (!m.total) return null
  const beads = (
    <span className={'beads pc' + m.color + (lg ? ' lg' : '') + (count ? '' : className ? ' ' + className : '')} role="img" aria-label={m.beadsLabel}>
      {m.beads.map((b, i) => <i key={i} className={'bead ' + b} />)}
    </span>
  )
  if (!count) return beads
  return (
    <span className={'bd-row' + (className ? ' ' + className : '')}>
      {beads}
      <span className="hint num" aria-hidden="true">
        {m.done}/{m.total}
      </span>
    </span>
  )
}
export default Beads
