// Focus rules shared by every overlay (spec §2.2, §8):
// - opening a surface remembers what had focus; closing it gives focus back (or to the page title);
// - the palette hands off: running an item closes it WITHOUT restoring focus, the next surface owns focus, and closing
//   that surface returns focus to whatever opened the palette;
// - Esc closes the newest surface first (popover → overlay → panel → sheet) through one LIFO stack.

let lastFocus: HTMLElement | null = null
let paletteReturn: HTMLElement | null = null

/** The palette input's id: focus that sits there is never "remembered" (we remember what opened the palette). */
export const PALETTE_INPUT_ID = 'pal-q'

const isEl = (x: unknown): x is HTMLElement => !!x && typeof (x as HTMLElement).focus === 'function'

/** Call when a surface opens. */
export function rememberFocus() {
  const a = typeof document !== 'undefined' ? document.activeElement : null
  lastFocus = isEl(a) && a.id === PALETTE_INPUT_ID ? paletteReturn : isEl(a) ? a : null
}

/** The palette calls this when it opens (before moving focus into its input). */
export function setPaletteReturn(el: Element | null) {
  paletteReturn = isEl(el) ? el : null
}

/** Call when a surface closes without handing off. Falls back to the page title. */
export function restoreFocus() {
  const el = lastFocus
  lastFocus = null
  if (el && el.isConnected && el.getClientRects().length) {
    el.focus({ preventScroll: true })
    return
  }
  if (!focusPageTitle()) document.getElementById('main')?.focus({ preventScroll: true })
}

/** Route change: focus the page <h1 tabindex=-1> (no ring: [tabindex="-1"]:focus{outline:none}). */
export function focusPageTitle() {
  if (typeof document === 'undefined') return false
  const h1 = document.querySelector<HTMLElement>('#main h1, main h1')
  if (!h1) return false
  if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1')
  h1.focus({ preventScroll: true })
  return true
}

/** True while the person types: inputs, textareas, selects, contenteditable and ARIA text roles. Single-key shortcuts
 *  never fire there. Works on plain objects too (tests). */
export function isTyping(el: unknown): boolean {
  const e = el as (HTMLElement & { closest?: (s: string) => Element | null }) | null
  if (!e || typeof e !== 'object') return false
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(String(e.tagName || ''))) return true
  if (e.isContentEditable) return true
  return !!(typeof e.closest === 'function' && e.closest('[role="textbox"],[role="combobox"],[role="listbox"],[role="searchbox"],[contenteditable="true"],[contenteditable=""]'))
}

// ---- Esc stack ----
type EscFn = () => boolean | void
const escapes: EscFn[] = []

/** Register an Esc handler for an open surface; returns the unregister function. The newest handler runs first; return
 *  `false` to let the next one (older surface) handle Esc too. */
export function onEscape(fn: EscFn): () => void {
  escapes.push(fn)
  return () => {
    const i = escapes.lastIndexOf(fn)
    if (i >= 0) escapes.splice(i, 1)
  }
}

/** Runs the newest Esc handler. Returns true when something handled it. */
export function runEscape(): boolean {
  for (let i = escapes.length - 1; i >= 0; i--) {
    if (escapes[i]() !== false) return true
  }
  return false
}
