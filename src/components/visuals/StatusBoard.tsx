// Status board (spec §4): a grid of pieces, each = icon · name · one line · a state chip (icon + word, never colour
// alone). Docs turn ✅/⚠️ status tables into this; the Explain panel uses the compact form (no line).
import { Icon } from '../../lib/icons'
import type { IconName } from '../../lib/contracts'

export type PieceStatus = 'ok' | 'warn' | 'bad' | 'idea'
export type StatusItem = {
  name: string
  /** One line under the name (hidden in compact). */
  line?: string
  icon?: IconName
  status?: PieceStatus | null
  /** The chip word; default: ok "live", warn "to check", bad "broken", idea "idea". */
  word?: string
}

const CHIP: Record<PieceStatus, { tone: string; icon: IconName; word: string }> = {
  ok: { tone: 'ok', icon: 'check', word: 'live' },
  warn: { tone: 'warn', icon: 'info', word: 'to check' },
  bad: { tone: 'bad', icon: 'alert', word: 'broken' },
  idea: { tone: '', icon: 'thought', word: 'idea' },
}

/** A status word or mark from a doc table cell → a piece status (✅ live/done/ok, ⚠️ check/todo, ❌ broken, 💭 idea). */
export function statusFromText(v: unknown): PieceStatus | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (!s) return null
  if (s.includes('\u{2705}') || /^(live|done|ok|yes|working|shipped|on)\b/.test(s)) return 'ok'
  if (s.includes('\u{274c}') || s.includes('\u{1f534}') || /^(broken|down|failing|no|off|blocked)\b/.test(s)) return 'bad'
  if (s.includes('\u{26a0}') || /^(to check|check|todo|pending|wip|partly|partial|soon)\b/.test(s)) return 'warn'
  if (s.includes('\u{1f4ad}') || /^(idea|maybe|later)\b/.test(s)) return 'idea'
  return null
}

export function StatusBoard({ items, compact, className }: { items: StatusItem[]; compact?: boolean; className?: string }) {
  const list = (Array.isArray(items) ? items : []).filter((x) => x && x.name).slice(0, 24)
  if (!list.length) return null
  return (
    <ul className={'sboard' + (compact ? ' compact' : '') + (className ? ' ' + className : '')}>
      {list.map((it, i) => {
        const c = it.status ? CHIP[it.status] : null
        return (
          <li key={i} className="sb-i">
            <Icon name={it.icon || 'layers'} />
            <b>{it.name}</b>
            {!compact && it.line && <span className="sb-l">{it.line}</span>}
            {c && (
              <span className={'chip' + (c.tone ? ' ' + c.tone : '')}>
                <Icon name={c.icon} />
                {it.word || c.word}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
export default StatusBoard
