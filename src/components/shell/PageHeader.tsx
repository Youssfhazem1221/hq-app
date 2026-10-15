// Page header contract (spec D3): icon/glyph · h1 (tabindex -1) · sub · 0–3 tiles (zeros never shown, never a repeat
// of the sub line) · one Next item with one button. `hero` = Home: the h1 is visually hidden, `sub` is the greeting,
// and the Next bar is the headline with "Then …".
import type { ReactNode } from 'react'
import { Icon } from '../../lib/icons'
import type { IconName, NextItem, TileSpec } from '../../lib/contracts'
import { Stat } from '../ui'
import { NextBar } from './NextBar'
import { headerTiles } from './shell-core'

type Props = {
  icon?: IconName
  /** A drawn glyph (e.g. the project's coloured glyph) instead of the plain icon. */
  glyph?: ReactNode
  title: string
  sub?: ReactNode
  tiles?: TileSpec[]
  next?: NextItem | null
  hero?: boolean
  then?: NextItem | null
  /** Small thing right after the title (a status pill, a chip). */
  after?: ReactNode
  className?: string
}

const plain = (n: ReactNode): string =>
  n == null || typeof n === 'boolean' ? '' : typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(plain).join(' ') : ''

export function PageHeader({ icon, glyph, title, sub, tiles, next, hero, then, after, className }: Props) {
  const shown = headerTiles(tiles, plain(sub))
  return (
    <header className={'ph' + (hero ? ' home' : '') + (className ? ' ' + className : '')}>
      <div className="ph-main">
        {hero ? (
          <>
            <h1 className="sr" tabIndex={-1}>
              {title}
            </h1>
            {sub && <p className="greet">{sub}</p>}
          </>
        ) : (
          <>
            <div className="ph-title">
              {glyph || (icon && <span className="ph-ico"><Icon name={icon} /></span>)}
              <h1 tabIndex={-1}>{title}</h1>
              {after}
            </div>
            {sub && <div className="sub">{sub}</div>}
          </>
        )}
      </div>
      {shown.length > 0 && (
        <div className="ph-stats">
          {shown.map((t, i) => (
            <Stat key={i} tile={t} />
          ))}
        </div>
      )}
      {next && <NextBar item={next} variant={hero ? 'hero' : 'bar'} then={hero ? then : undefined} />}
    </header>
  )
}
