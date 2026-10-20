import { Fragment, useMemo, type ReactNode } from 'react'
import { routeFor } from '../lib/hq'
import { resolvePath } from '../lib/md'
import { toHtml } from '../lib/md-html'
import { ago } from '../lib/util'
import { go } from '../lib/router'
import { Icon } from '../lib/icons'
import type { BlockCtx, IconName, NextItem, TileSpec } from '../lib/contracts'
import { initials, shownTiles } from './shell/shell-core'
import { MenuButton, type MenuEntry } from './shell/Popover'
import { BLOCKS, newBlockCtx, splitBlocks } from './blocks'

// ---------------------------------------------------------------------------------------------------------------
// v3 building blocks (spec §4). Class names match mock/src/styles.css; styles live in styles/components.css.
// ---------------------------------------------------------------------------------------------------------------

/** Widget card: icon · title · count · actions · ⋯ menu. `secondary` widgets hide in Focus mode. */
export function Widget(p: {
  id: string
  title: string
  icon?: IconName
  count?: number | null
  chip?: ReactNode
  act?: ReactNode
  menu?: MenuEntry[]
  secondary?: boolean
  flat?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <section
      className={'w' + (p.flat ? ' flat' : '') + (p.className ? ' ' + p.className : '')}
      data-w={p.id}
      data-secondary={p.secondary ? '' : undefined}
      aria-labelledby={'w-' + p.id}
    >
      <div className="wh">
        <h2 id={'w-' + p.id}>
          {p.icon && <Icon name={p.icon} />}
          <span>{p.title}</span>
          {p.count != null && <span className="count">{p.count}</span>}
          {p.chip}
        </h2>
        {(p.act || p.menu?.length) && (
          <div className="act">
            {p.act}
            {p.menu && <MenuButton label={'Options: ' + p.title} items={p.menu} />}
          </div>
        )}
      </div>
      <div className="wbody">{p.children}</div>
    </section>
  )
}

/** One header tile. Renders nothing for a dropped tile (null, false, empty or zero: tiles never show 0). */
export function Stat({ tile }: { tile: TileSpec }) {
  if (!shownTiles([tile]).length || !tile) return null
  return (
    <div className="stat">
      <b>
        {tile.value}
        {tile.delta && <span className={'delta' + (tile.delta.good ? '' : ' bad')}>{tile.delta.text}</span>}
      </b>
      <span>
        {tile.label}
        {tile.sample && <em className="sample-tag" data-tipt="Illustrative data: nothing logged yet"> · sample</em>}
      </span>
    </div>
  )
}

const STATUS_IC: Record<string, IconName> = { active: 'zap', waiting: 'clock', parked: 'pause', done: 'check' }
/** Project / item status: icon + word, never colour alone. */
export function StatusPill({ status }: { status?: unknown }) {
  const s = String(status || '').toLowerCase()
  if (!s) return null
  return (
    <span className={'st ' + (STATUS_IC[s] ? s : 'other')}>
      <Icon name={STATUS_IC[s] || 'info'} />
      {s}
    </span>
  )
}

/** On/off switch (role=switch). */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button className="sw" type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />
}

/** Notion-style callout. */
export function Callout({ icon = 'info', children }: { icon?: IconName; children: ReactNode }) {
  return (
    <div className="callout">
      <Icon name={icon} />
      <span>{children}</span>
    </div>
  )
}

/** Notion-style toggle (details/summary). */
export function Toggle({ title, open, children, className }: { title: ReactNode; open?: boolean; children: ReactNode; className?: string }) {
  return (
    <details className={'tg' + (className ? ' ' + className : '')} open={open}>
      <summary>
        <Icon name="chevR" size="s" className="chev" />
        {title}
      </summary>
      <div className="tg-body">{children}</div>
    </details>
  )
}

/** Small chip. With `pressed` it becomes a toggle chip (aria-pressed); with `onClick` a button. */
export function Chip(p: {
  tone?: 'ok' | 'warn' | 'bad' | 'acc' | 'line' | 'sample'
  icon?: IconName
  pressed?: boolean
  onClick?: () => void
  title?: string
  children: ReactNode
}) {
  const body = (
    <>
      {p.icon && <Icon name={p.icon} />}
      {p.children}
    </>
  )
  if (p.pressed !== undefined)
    return (
      <button className="qchip" type="button" aria-pressed={p.pressed} onClick={p.onClick} title={p.title}>
        {body}
      </button>
    )
  const cls = 'chip' + (p.tone ? ' ' + p.tone : '')
  if (p.onClick)
    return (
      <button className={cls} type="button" onClick={p.onClick} title={p.title}>
        {body}
      </button>
    )
  return (
    <span className={cls} title={p.title}>
      {body}
    </span>
  )
}

/** Empty state: one sentence + at most one button. `icon` = an icon name (or a node). */
export function Empty(p: { icon: IconName | ReactNode; text: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      {typeof p.icon === 'string' ? <Icon name={p.icon} /> : p.icon}
      <p>{p.text}</p>
      {p.children}
    </div>
  )
}

export { initials }

/** Person avatar: initials on the accent wash (fixes the old "Y(" initials), Claude = bot icon, or a picture. */
export function Avatar(p: { name: string; src?: string; size?: number; bot?: boolean }) {
  const size = p.size || 28
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) }
  if (p.src) return <img className="av" src={p.src} width={size} height={size} style={style} alt="" />
  if (p.bot)
    return (
      <span className="av bot" style={style} role="img" aria-label={p.name}>
        <Icon name="bot" />
      </span>
    )
  return (
    <span className="av" style={style} role="img" aria-label={p.name}>
      {initials(p.name)}
    </span>
  )
}

/** Segmented control (aria-pressed buttons). */
export function Segmented<T extends string>(p: { value: T; options: [T, ReactNode][]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={p.label}>
      {p.options.map(([v, label]) => (
        <button key={v} type="button" className={v === p.value ? 'on' : ''} aria-pressed={v === p.value} onClick={() => p.onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}

export const Ago = ({ iso }: { iso?: unknown }) => (
  <span className="muted small" title={String(iso || '')}>
    {ago(iso)}
  </span>
)

// ---------------------------------------------------------------------------------------------------------------
// Markdown with rich blocks (spec §5.1): ```chart and ```explainer through B's BLOCKS. One BlockCtx per render (≤4
// rich blocks per doc or answer; the 5th shows as code); every drawn block sits in a Boundary whose fallback is its code.
// ---------------------------------------------------------------------------------------------------------------

/** AI answers cite files like [projects/x/project.md] or [a.md, b.md]: turn them into links. */
const linkCitations = (md: string) =>
  md.replace(/\[((?:[\w./-]+\.md)(?:,\s*[\w./-]+\.md)*)\](?!\()/g, (_, list: string) =>
    list.split(/,\s*/).map((p) => `[${p}](/${p})`).join(', '),
  )

/** Rendered markdown; relative .md links open inside the app. Rich blocks count against `ctx` (a fresh one per render
 *  when the caller passes none, so re-renders never use up the budget). */
export function Markdown({ md, base = '', ctx, decide }: { md: string; base?: string; ctx?: BlockCtx; decide?: NextItem | null }) {
  const parts = useMemo(() => splitBlocks(md || ''), [md])
  if (!parts.some((p) => p.kind !== 'md')) return <MarkdownText md={md} base={base} />
  const c = ctx ?? newBlockCtx(base || undefined, decide)
  return (
    <div className="md-rich">
      {parts.map((p, i) => (p.kind === 'md' ? <MarkdownText key={i} md={p.text} base={base} /> : <Fragment key={i}>{BLOCKS[p.kind](p.src, c)}</Fragment>))}
    </div>
  )
}

function MarkdownText({ md, base = '' }: { md: string; base?: string }) {
  // base: the note's repo images get a placeholder (only the Docs reader draws them; elsewhere they stay links)
  const html = useMemo(() => toHtml(linkCitations(md), base), [md, base])
  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    const href = a.getAttribute('href') || ''
    if (/^(https?:|mailto:)/i.test(href)) {
      e.preventDefault()
      window.open(href, '_blank', 'noopener')
      return
    }
    if (!href || href.startsWith('#')) return
    e.preventDefault()
    const clean = decodeURIComponent(href.split('#')[0].replace(/:\d+$/, ''))
    const target = clean.startsWith('/') ? clean.slice(1) : resolvePath(base, clean)
    // projects/<slug>/project.md (or a legacy projects/<slug>.md) → project page; other paths → doc view.
    go(routeFor(target))
  }
  return <div className="md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}
