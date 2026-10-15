import { useSyncExternalStore } from 'react'
import { Icon } from '../lib/icons'
import { HQ_EVENTS, fire, type IconName, type ToastKind, type ToastOpts } from '../lib/contracts'

export type { ToastKind }
type Toast = { id: number; kind: ToastKind; text: string; undo?: () => void }

const ICON: Record<ToastKind, IconName> = { commit: 'commit', local: 'local', bot: 'bot', info: 'info', error: 'alert', ok: 'check', you: 'inbox' }
const HIDE_MS = 6000
const MAX = 2

let toasts: Toast[] = []
let nextId = 1
const subs = new Set<() => void>()
const emit = () => subs.forEach((cb) => cb())

export function dismiss(id: number) {
  const before = toasts.length
  toasts = toasts.filter((t) => t.id !== id)
  if (toasts.length !== before) emit()
}

/** One-line notice (bottom right; above the bottom bar on phones), gone after 6 s, at most 2 on screen. `undo` adds an
 *  Undo button. The same text twice in a row is shown once. */
export function toast(text: string, kind: ToastKind = 'info', opts: ToastOpts = {}) {
  const line = String(text).split('\n')[0].trim()
  if (!line || toasts.some((t) => t.text === line)) return
  const id = nextId++
  toasts = [...toasts, { id, kind, text: line, undo: opts.undo }].slice(-MAX)
  emit()
  setTimeout(() => dismiss(id), opts.ms ?? HIDE_MS)
}

const subscribe = (cb: () => void) => {
  subs.add(cb)
  return () => void subs.delete(cb)
}

/** Open the check-in sheet (event hq:checkin). The sheet mounts right after the first paint (once a workspace is open);
 *  before that, one plain toast says why nothing opened. Every Check in button uses this, so the words match. */
export function openCheckin(detail: object = {}, connected = true): boolean {
  if (fire(HQ_EVENTS.checkin, detail)) return true
  toast(connected ? 'Check-in is still loading. Try again in a second.' : 'Connect your workspace in Settings to check in', 'info')
  return false
}

export function Toasts() {
  const list = useSyncExternalStore(subscribe, () => toasts, () => toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast k-${t.kind}`}>
          <Icon name={ICON[t.kind]} size="s" />
          <span className="toast-t" title={t.text}>{t.text}</span>
          {t.undo && (
            <button
              type="button"
              onClick={() => {
                dismiss(t.id)
                t.undo?.()
              }}
            >
              Undo
            </button>
          )}
          <button type="button" className="toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <Icon name="x" size="s" />
          </button>
        </div>
      ))}
    </div>
  )
}
