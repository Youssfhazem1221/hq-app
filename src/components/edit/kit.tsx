// The editing kit (HQ as a portfolio, phase 3), shared by the project page, the block editor and the upload panel:
//   useContextMenu: the same rows as a ⋯ menu (Popover + MenuItem), opened by a right-click, a long press on touch,
//                   or the keyboard (Shift+F10 / the Menu key) on the focused item; focus goes back to it on close
//   InlineText / InlineDate: click (or Enter) to edit in place; Enter or leaving the field saves, Esc cancels
//   useSave: one read-modify-write of a file (source.update), then a toast with Undo (only while nobody changed it since)
// Lazy: loaded with the pages that edit. No new look: Popover, .pal-it rows, .inp fields and two small classes.
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useHQ } from '../../lib/hq-context'
import { MenuItem, Popover, type MenuEntry } from '../shell/Popover'
import { toast } from '../toast'

// ---- right-click menus ---------------------------------------------------------------------------------------------

type Open = { x: number; y: number; items: MenuEntry[]; label: string; back: HTMLElement | null }
const MENU_W = 220

/** `bind(items, label)` goes on any element (spread it); `menu` renders the open menu once, anywhere in the tree. */
export function useContextMenu() {
  const [open, setOpen] = useState<Open | null>(null)
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null)
  const press = useRef<{ t: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)
  const show = (x: number, y: number, items: MenuEntry[], label: string, back: HTMLElement | null) => items.length && setOpen({ x, y, items, label, back })
  const close = () => {
    const back = open?.back
    setOpen(null)
    back?.focus({ preventScroll: true })
  }
  useEffect(
    () => () => {
      if (press.current) clearTimeout(press.current.t)
    },
    [],
  )
  const bind = (items: () => MenuEntry[], label: string) => ({
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
      show(e.clientX, e.clientY, items(), label, e.currentTarget)
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (!((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu')) return
      e.preventDefault()
      const r = e.currentTarget.getBoundingClientRect()
      show(r.left + 16, r.top + Math.min(r.height, 28), items(), label, e.currentTarget)
    },
    // a long press on touch (≈ the platform's own context menu); a move or a lift cancels it
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch') return
      const el = e.currentTarget
      const { clientX: x, clientY: y } = e
      press.current = { x, y, t: setTimeout(() => show(x, y, items(), label, el), 550) }
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const p = press.current
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) (clearTimeout(p.t), (press.current = null))
    },
    onPointerUp: () => press.current && (clearTimeout(press.current.t), (press.current = null)),
  })
  const menu = open
    ? createPortal(
        <>
          {/* a 1 px point the Popover hangs from: the menu opens to the right of the pointer, kept in the window */}
          <span ref={setAnchor} aria-hidden="true" style={{ position: 'fixed', left: Math.min(open.x + MENU_W, innerWidth - 8), top: open.y - 4, width: 1, height: 1, pointerEvents: 'none' }} />
          <Popover anchor={anchor} open onClose={close} width={MENU_W} label={open.label}>
            {open.items.map((it) => (
              <MenuItem
                key={it.label}
                icon={it.icon}
                label={it.label}
                disabled={it.disabled}
                onSelect={() => {
                  close()
                  it.run()
                }}
              />
            ))}
          </Popover>
        </>,
        document.body,
      )
    : null
  return { bind, menu, show }
}

// ---- click-to-edit fields ------------------------------------------------------------------------------------------

type InlineProps = {
  value: string
  /** Saves the new value; resolves when written (the field stays busy meanwhile). */
  onSave: (next: string) => Promise<unknown>
  /** What the field is ("goal"), for the label: "Edit the goal". */
  label: string
  multiline?: boolean
  placeholder?: string
  max?: number
  /** What shows when not editing (defaults to the value, or the placeholder in muted text). */
  children?: ReactNode
  className?: string
  /** Start in edit mode (a "Rename" menu row opens it). */
  editing?: boolean
  onEditing?: (on: boolean) => void
}

/** A value that turns into a field when clicked. Enter (Ctrl+Enter when multi-line) or leaving the field saves an
 *  actual change; Esc puts the old value back. */
export function InlineText({ value, onSave, label, multiline, placeholder, max = 300, children, className, editing, onEditing }: InlineProps) {
  const [on, setOn] = useState(!!editing)
  const [text, setText] = useState(value)
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => setOn(!!editing), [editing])
  useEffect(() => {
    if (!on) return setText(value)
    field.current?.focus()
    field.current?.select()
  }, [on, value])
  const stop = (refocus: boolean) => {
    setOn(false)
    onEditing?.(false)
    if (refocus) requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }))
  }
  const commit = async (refocus: boolean) => {
    const next = text.replace(/\s+$/, '')
    if (busy) return
    if (next === value || (!next.trim() && !value)) return stop(refocus)
    setBusy(true)
    try {
      await onSave(next)
      stop(refocus)
    } catch (e: any) {
      toast(String(e?.message || e), 'error')
    } finally {
      setBusy(false)
    }
  }
  if (!on)
    return (
      <button
        ref={trigger}
        type="button"
        className={'ie' + (className ? ' ' + className : '')}
        aria-label={`Edit the ${label}${value ? `: ${value.slice(0, 80)}` : ''}`}
        title={`Click to edit the ${label}`}
        onClick={() => (setOn(true), onEditing?.(true))}
      >
        {children ?? (value || <span className="muted">{placeholder || `Add a ${label}`}</span>)}
      </button>
    )
  const common = {
    ref: field,
    className: 'inp sm' + (className ? ' ' + className : ''),
    value: text,
    maxLength: max,
    placeholder,
    disabled: busy,
    'aria-label': label[0].toUpperCase() + label.slice(1),
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onBlur: () => void commit(false),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setText(value)
        stop(true)
      } else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        void commit(true)
      }
    },
  }
  return multiline ? <textarea {...common} rows={Math.min(8, Math.max(2, Math.ceil(text.length / 60)))} /> : <input {...common} type="text" />
}

/** A date chip that turns into a date field; an empty field removes the date. */
export function InlineDate({ value, onSave, label }: { value: string; onSave: (next: string | null) => Promise<unknown>; label: string }) {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!on)
    return (
      <button type="button" className="ie" aria-label={`${value ? 'Change' : 'Set'} the date of ${label}`} title="Click to set the date" onClick={() => setOn(true)}>
        {value ? new Date(value + 'T00:00:00Z').toLocaleDateString('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : <span className="muted">+ date</span>}
      </button>
    )
  const save = async (v: string) => {
    const next = v || null
    if ((next ?? '') === value) return setOn(false)
    setBusy(true)
    try {
      await onSave(next)
      setOn(false)
    } catch (e: any) {
      toast(String(e?.message || e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <input
      type="date"
      className="inp sm"
      defaultValue={value}
      disabled={busy}
      aria-label={`Date of ${label}`}
      autoFocus
      onBlur={(e) => void save(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), setOn(false))
        else if (e.key === 'Enter') (e.preventDefault(), void save((e.target as HTMLInputElement).value))
      }}
    />
  )
}

// ---- saving with Undo ----------------------------------------------------------------------------------------------

/** `save(path, fn, message, done)`: one read-modify-write (`fn` gets the current text, returns the new one or null for
 *  "nothing to change"; it may throw to refuse), then reload and a toast whose Undo puts the old text back, but only
 *  while the file is still exactly what this edit wrote. Resolves to true when something was written. */
export function useSave() {
  const { source, reload } = useHQ()
  return async (path: string, fn: (cur: string) => string | null, message: string, done: string): Promise<boolean> => {
    let before: string | null = null
    let after: string | null = null
    const ok = await source.update(
      path,
      (cur) => {
        before = cur
        after = null
        if (cur === null) throw new Error(`${path.split('/').pop()} is gone: reload the page`)
        const next = fn(cur)
        if (next === null || next === cur) return null
        after = next
        return next
      },
      message,
    )
    if (!ok || after === null) return false
    await reload()
    const wrote = after
    const old = before
    toast(done, 'ok', {
      undo: () => {
        source
          .update(path, (cur) => (cur !== null && cur === wrote && old !== null ? old : cur), `${message.split(':')[0]}: undo`)
          .then(() => reload())
          .catch((e) => toast(String(e?.message || e), 'error'))
      },
    })
    return true
  }
}
