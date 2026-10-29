// The Next bar: kind icon · "Next · <project>" · one sentence · ONE button (contracts NEXT_BUTTON). Variants: 'bar'
// (page headers), 'hero' (Home headline, with "Then …"), 'journey' (the NOW card inside B's Journey). `completing`
// runs the 520 ms fill (CSS; reduced motion = instant). Every variant carries data-next="<id>".
import type { CSSProperties } from 'react'
import { Icon } from '../../lib/icons'
import { useHQMaybe, useNextActions } from '../../lib/hq-context'
import { NEXT_BUTTON, type IconName, type NextItem, type NextKind } from '../../lib/contracts'
import { projectSlugOf } from './shell-core'
import { PinwheelMark } from './PinwheelMark'

const KIND_ICON: Record<NextKind, IconName> = {
  help: 'question', join: 'users', decision: 'route', todo: 'tasks', milestone: 'flag', status: 'flag', checkin: 'plus',
}

/** The one button a Next item gets. */
export function NextButton({ item, onAct, className }: { item: NextItem; onAct: (item: NextItem) => void; className?: string }) {
  const b = NEXT_BUTTON[item.kind] || NEXT_BUTTON.todo
  return (
    <button className={'btn primary' + (className ? ' ' + className : '')} type="button" data-kind={item.kind} onClick={() => onAct(item)}>
      {item.kind === 'todo' && <Icon name={b.icon} size="s" />}
      {b.label}
      {item.kind !== 'todo' && <Icon name={b.icon} size="s" />}
    </button>
  )
}

type Props = {
  item: NextItem | null | undefined
  variant?: 'bar' | 'hero' | 'journey'
  /** Hero only: the item after this one ("Then …"). */
  then?: NextItem | null
  /** Defaults to the NextActions context (C1's provider). */
  onAct?: (item: NextItem) => void
  /** Defaults to `context.completing === item.id`. */
  completing?: boolean
  /** Journey only: where the NOW card's caret points (0–100, % of the strip). */
  caret?: number
}

export function NextBar({ item, variant = 'bar', then, onAct, completing, caret }: Props) {
  const ctx = useNextActions()
  const hq = useHQMaybe()
  if (!item) return null
  const act = onAct || ctx.act
  const busy = completing ?? (!!ctx.completing && ctx.completing === item.id)
  const btn = <NextButton item={item} onAct={act} />

  if (variant === 'journey') {
    const style = caret != null ? ({ '--x': Math.max(8, Math.min(92, Math.round(caret))) + '%' } as CSSProperties) : undefined
    return (
      <div className={'jnow' + (busy ? ' completing' : '')} data-next={item.id} role="group" aria-label="Next step" style={style}>
        <div className="nb-t">
          <span className="k">
            <Icon name="arrow" size="s" />
            Now
          </span>
          <p>{item.text}</p>
        </div>
        {btn}
      </div>
    )
  }

  const hero = variant === 'hero'
  const project = item.project ? hq?.model.projects.find((d) => projectSlugOf(d) === item.project) : undefined
  return (
    <div className={'nextbar' + (hero ? ' hero' : '') + (busy ? ' completing' : '')} role="group" aria-label="Next step" data-next={item.id}>
      {!hero && <Icon name={KIND_ICON[item.kind] || 'arrow'} />}
      {hero && <PinwheelMark className="nb-pw" />}
      <div className="nb-t">
        <span className="k">
          {hero && <Icon name={KIND_ICON[item.kind] || 'arrow'} size="s" />}
          Next{hero && project ? ' · ' + String(project.data.title || item.project) : ''}
        </span>
        <p>{item.text}</p>
        {hero && then && (
          <div className="then">
            <Icon name="chevR" size="s" />
            <span>Then</span> <em>{then.text}</em>
          </div>
        )}
      </div>
      {btn}
    </div>
  )
}
