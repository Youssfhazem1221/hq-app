// Small floating surfaces: Popover (widget ⋯, explainer ⋯, Sources, goal input), MenuButton (⋯ + menu) and the
// tooltip layer for [data-tipt] (plain text only). Esc closes the newest popover first (focus.ts onEscape).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../lib/icons'
import { onEscape } from '../../lib/focus'
import type { IconName } from '../../lib/contracts'

type PopoverProps = {
  anchor: HTMLElement | null
  open: boolean
  onClose: () => void
  width?: number
  /** Accessible name of the surface. */
  label?: string
  role?: 'menu' | 'dialog'
  className?: string
  children: ReactNode
}

const FOCUSABLE = 'input,select,textarea,button:not([disabled]),[href],[tabindex]:not([tabindex="-1"]),[role="menuitem"]'

/** Floating panel under its anchor (right-aligned, kept inside the viewport). Focus moves in on open and back to the
 *  anchor on close. Arrow keys move between menu items; Enter runs one; Esc and an outside click close it. */
export function Popover({ anchor, open, onClose, width = 220, label, role = 'menu', className, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const close = useRef(onClose)
  close.current = onClose

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const h = ref.current?.offsetHeight || 0
      const W = Math.min(width, innerWidth - 16)
      setPos({ left: Math.max(8, Math.min(r.right - W, innerWidth - W - 8)), top: Math.max(8, Math.min(r.bottom + 4, innerHeight - h - 8)) })
    }
    place()
    addEventListener('resize', place)
    addEventListener('scroll', place, true)
    return () => {
      removeEventListener('resize', place)
      removeEventListener('scroll', place, true)
    }
  }, [open, anchor, width])

  useEffect(() => {
    if (!open) return
    const first = ref.current?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus({ preventScroll: true })
    const off = onEscape(() => {
      close.current()
      anchor?.focus({ preventScroll: true })
    })
    const outside = (e: PointerEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchor?.contains(t)) return
      close.current()
    }
    document.addEventListener('pointerdown', outside, true)
    return () => {
      off()
      document.removeEventListener('pointerdown', outside, true)
    }
  }, [open, anchor])

  if (!open || !anchor) return null
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || [])]
    if (!items.length) return
    e.preventDefault()
    const i = items.indexOf(document.activeElement as HTMLElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus()
  }
  return createPortal(
    <div
      ref={ref}
      className={'pop' + (className ? ' ' + className : '')}
      role={role}
      aria-label={label}
      style={{ width: Math.min(width, innerWidth - 16), left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      onKeyDown={onKey}
    >
      {children}
    </div>,
    document.body,
  )
}

export type MenuEntry = { label: string; icon?: IconName; run: () => void; disabled?: boolean }

/** One menu row. */
export function MenuItem({ icon, label, onSelect, disabled }: { icon?: IconName; label: ReactNode; onSelect: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="menuitem" className="pal-it" tabIndex={-1} disabled={disabled} onClick={onSelect}>
      {icon && <Icon name={icon} />}
      <span>{label}</span>
    </button>
  )
}

/** The ⋯ button with its menu (widget menus, explainer menus). */
export function MenuButton({ label, items, icon = 'dots', width = 200 }: { label: string; items: MenuEntry[]; icon?: IconName; width?: number }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  if (!items.length) return null
  return (
    <>
      <button
        ref={btn}
        className="icon-btn"
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={icon} />
      </button>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} width={width} label={label}>
        {items.map((it) => (
          <MenuItem
            key={it.label}
            icon={it.icon}
            label={it.label}
            disabled={it.disabled}
            onSelect={() => {
              setOpen(false)
              btn.current?.focus({ preventScroll: true })
              it.run()
            }}
          />
        ))}
      </Popover>
    </>
  )
}

/** Tooltip for any element with `data-tipt="text"` (text only, never HTML). Sidebar nav tips show only in rail mode. */
export function TipLayer() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const tip = ref.current
    if (!tip) return
    const show = (el: HTMLElement) => {
      const text = el.getAttribute('data-tipt')
      if (!text) return
      // Sidebar items have visible labels: tips only in rail mode (icon buttons and avatars always), never in the phone sheet.
      const inSb = !!el.closest('.sb')
      if (inSb && (innerWidth <= 760 || (document.documentElement.getAttribute('data-sb') !== 'rail' && !el.matches('.icon-btn, .people-row a')))) return
      tip.textContent = text
      tip.classList.add('on')
      const r = el.getBoundingClientRect()
      const w = tip.offsetWidth
      const h = tip.offsetHeight
      let left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8)
      let top = r.top - h - 8
      if (el.closest('.sb')) {
        left = r.right + 8
        top = r.top + r.height / 2 - h / 2
      }
      if (top < 8) top = r.bottom + 8
      tip.style.left = left + 'px'
      tip.style.top = top + 'px'
    }
    const hide = () => tip.classList.remove('on')
    const find = (t: EventTarget | null) => (t instanceof Element ? (t.closest('[data-tipt]') as HTMLElement | null) : null)
    const over = (e: Event) => {
      const el = find(e.target)
      if (el) show(el)
    }
    const out = (e: Event) => {
      if (find(e.target)) hide()
    }
    document.addEventListener('pointerover', over)
    document.addEventListener('pointerout', out)
    document.addEventListener('focusin', over)
    document.addEventListener('focusout', hide)
    addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('pointerover', over)
      document.removeEventListener('pointerout', out)
      document.removeEventListener('focusin', over)
      document.removeEventListener('focusout', hide)
      removeEventListener('scroll', hide, true)
    }
  }, [])
  return <div id="tip" ref={ref} role="tooltip" aria-hidden="true" />
}
