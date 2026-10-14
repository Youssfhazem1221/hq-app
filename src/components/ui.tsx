import { useMemo, type ReactNode } from 'react'
import { resolvePath, toHtml } from '../lib/md'
import { ago } from '../lib/util'
import { go } from '../lib/router'

export function Card(p: { icon?: ReactNode; title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={'card ' + (p.className || '')}>
      {(p.title || p.extra) && (
        <div className="card-h">
          <h3>
            {p.icon}
            {p.title}
          </h3>
          {p.extra}
        </div>
      )}
      {p.children}
    </section>
  )
}

export function Tile(p: { icon: ReactNode; label: string; value: ReactNode; tone?: string; href?: string }) {
  return (
    <a className={`tile tone-${p.tone || 'accent'}`} href={p.href || '#/'}>
      <span className="tile-ico">{p.icon}</span>
      <span className="tile-v">{p.value}</span>
      <span className="tile-l">{p.label}</span>
    </a>
  )
}

const TONES: Record<string, string> = {
  active: 'info', open: 'info', waiting: 'warn', doing: 'warn', todo: 'muted', done: 'ok', parked: 'muted', error: 'bad',
  idea: 'accent', thought: 'info', question: 'warn', update: 'ok',
}
export const toneOf = (s?: unknown) => TONES[String(s || '').toLowerCase()] || 'muted'

export function Badge(p: { tone?: string; children: ReactNode; title?: string }) {
  return (
    <span className={`badge tone-${p.tone || 'muted'}`} title={p.title}>
      {p.children}
    </span>
  )
}

export function Empty(p: { icon: ReactNode; text: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      {p.icon}
      <div>{p.text}</div>
      {p.children}
    </div>
  )
}

const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
export function Avatar(p: { name: string; src?: string; size?: number }) {
  const size = p.size || 32
  const initials = String(p.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  if (p.src) return <img className="avatar" src={p.src} width={size} height={size} alt="" />
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hue(p.name || '?')} 55% 42%)` }}>
      {initials}
    </span>
  )
}

export const Ago = ({ iso }: { iso?: unknown }) => (
  <span className="muted small" title={String(iso || '')}>
    {ago(iso)}
  </span>
)

/** Rendered markdown; relative .md links open inside the app. */
/** AI answers cite files like [projects/linkedin.md] or [a.md, b.md]: turn them into links. */
const linkCitations = (md: string) =>
  md.replace(/\[((?:[\w./-]+\.md)(?:,\s*[\w./-]+\.md)*)\](?!\()/g, (_, list: string) =>
    list.split(/,\s*/).map((p) => `[${p}](/${p})`).join(', '),
  )

export function Markdown({ md, base = '' }: { md: string; base?: string }) {
  const html = useMemo(() => toHtml(linkCitations(md)), [md])
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
    const project = target.match(/^projects\/([\w-]+)\.md$/)
    go(project ? '/projects/' + project[1] : target.toLowerCase().endsWith('.md') ? '/docs/' + target : '/docs')
  }
  return <div className="md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}

export function Segmented<T extends string>(p: { value: T; options: [T, ReactNode][]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {p.options.map(([v, label]) => (
        <button key={v} className={v === p.value ? 'on' : ''} onClick={() => p.onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}
