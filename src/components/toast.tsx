import { useSyncExternalStore, type ReactNode } from 'react'
import { Bot, GitCommitHorizontal, HardDrive, Info, TriangleAlert, X } from 'lucide-react'

export type ToastKind = 'commit' | 'local' | 'bot' | 'info' | 'error'
type Toast = { id: number; kind: ToastKind; text: string }

const ICON: Record<ToastKind, ReactNode> = {
  commit: <GitCommitHorizontal className="i sm" />,
  local: <HardDrive className="i sm" />,
  bot: <Bot className="i sm" />,
  info: <Info className="i sm" />,
  error: <TriangleAlert className="i sm" />,
}
const TONE: Record<ToastKind, string> = { commit: 'info', local: 'info', bot: 'accent', info: 'muted', error: 'bad' }
const HIDE_MS = 6000
const MAX = 4

let toasts: Toast[] = []
let nextId = 1
const subs = new Set<() => void>()
const emit = () => subs.forEach((cb) => cb())

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

/** One-line notice, top-right, gone after 6 s. The same text twice in a row is shown once. */
export function toast(text: string, kind: ToastKind = 'info') {
  const line = String(text).split('\n')[0].trim()
  if (!line || toasts.some((t) => t.text === line)) return
  const id = nextId++
  toasts = [...toasts, { id, kind, text: line }].slice(-MAX)
  emit()
  setTimeout(() => dismiss(id), HIDE_MS)
}

const subscribe = (cb: () => void) => {
  subs.add(cb)
  return () => void subs.delete(cb)
}

export function Toasts() {
  const list = useSyncExternalStore(subscribe, () => toasts)
  if (!list.length) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast tone-${TONE[t.kind]}`}>
          {ICON[t.kind]}
          <span className="toast-t" title={t.text}>{t.text}</span>
          <button className="toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <X className="i sm" />
          </button>
        </div>
      ))}
    </div>
  )
}
