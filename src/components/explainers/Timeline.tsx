// Timeline: a vertical list of dated items; done ones get a filled check node.
import { Icon } from '../../lib/icons'
import type { TimelineSpec } from './parse'

export function Timeline({ spec }: { spec: TimelineSpec }) {
  return (
    <ol className="tl">
      {spec.items.map((t, i) => (
        <li key={i} className={t.done ? 'done' : ''}>
          <span className="nd" aria-hidden="true">{t.done && <Icon name="check" size="s" />}</span>
          <span className="tx">
            {t.title}
            {t.done && <span className="sr"> (done)</span>}
          </span>
          <span className="dt">{t.date}</span>
        </li>
      ))}
    </ol>
  )
}
