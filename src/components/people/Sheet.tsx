// One modal surface for the People parts (check-in, team editor, log settings, join guide): a centred dialog on
// desktop, a bottom sheet on phones (A's .modal rules). Portaled to <body>, scrim behind, focus moves in on open and
// back to the opener on close, Esc closes it through the shared Esc stack, Tab stays inside.
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { onEscape, rememberFocus, restoreFocus } from '../../lib/focus'

const FOCUSABLE = 'input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[href],[tabindex]:not([tabindex="-1"])'

export function Sheet(p: {
  open: boolean
  onClose: () => void
  labelledBy: string
  wide?: boolean
  /** CSS selector of the element to focus first (default: the first field or button). */
  initial?: string
  /** Remember/restore focus (default true). The check-in sheet opened from the palette hands off and still restores. */
  restore?: boolean
  className?: string
  children: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(p.onClose)
  close.current = p.onClose
  useEffect(() => {
    if (!p.open) return
    if (p.restore !== false) rememberFocus()
    const t = setTimeout(() => {
      const el = (p.initial && box.current?.querySelector<HTMLElement>(p.initial)) || box.current?.querySelector<HTMLElement>(FOCUSABLE)
      el?.focus({ preventScroll: true })
    }, 20)
    const off = onEscape(() => {
      close.current()
    })
    return () => {
      clearTimeout(t)
      off()
      if (p.restore !== false) setTimeout(restoreFocus, 0)
    }
  }, [p.open])
  if (!p.open) return null
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !box.current) return
    const els = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.getClientRects().length)
    if (!els.length) return
    const first = els[0]
    const last = els[els.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
  return createPortal(
    <>
      <div className="scrim on" onClick={() => close.current()} aria-hidden="true" />
      <div
        ref={box}
        className={'modal on pp-sheet' + (p.wide ? ' wide' : '') + (p.className ? ' ' + p.className : '')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={p.labelledBy}
        onKeyDown={trap}
      >
        {p.children}
      </div>
    </>,
    document.body,
  )
}
