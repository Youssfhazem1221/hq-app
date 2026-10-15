// Command palette (Ctrl/⌘ K), spec §2.2. Groups: Suggested (empty query) · Go to · Create · Look · Ask AI (last).
// Other modules add items with registerPaletteSource(): C1 the "Next: …" suggestion, E the presets and the
// "Adjust look: …" item (top: true when its local parser finds a change), D people extras.
// Hand-off: running an item closes the palette WITHOUT restoring focus; the next surface owns focus and gives it back to
// whatever opened the palette when it closes (lib/focus.ts).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../lib/icons'
import { useHQMaybe, useIsDark, usePrefsApi } from '../../lib/hq-context'
import { HQ_EVENTS, fire, type PageName, type PaletteItem, type Route } from '../../lib/contracts'
import { PALETTE_INPUT_ID, onEscape, restoreFocus } from '../../lib/focus'
import { askAnywhere, go } from '../../lib/router'
import { NAV, colorSlot, navList, pagesTree, projectSlugOf, rankPalette, registerPaletteSource, sourcedItems } from './shell-core'

export { registerPaletteSource }

/** Fire an event the target page handles once it has mounted (lazy pages take a moment). */
function fireWhenReady(name: (typeof HQ_EVENTS)[keyof typeof HQ_EVENTS], detail: object, tries = 25) {
  if (fire(name, detail) || tries <= 0) return
  setTimeout(() => fireWhenReady(name, detail, tries - 1), 60)
}
const create = (path: string, page: PageName) => () => {
  go(path)
  setTimeout(() => fireWhenReady(HQ_EVENTS.newItem, { page }), 30)
}

type Props = { open: boolean; route: Route; onClose: () => void; onCheckin: () => void; onAdjust: (query?: string) => void }

export function Palette({ open, route, onClose, onCheckin, onAdjust }: Props) {
  const hq = useHQMaybe()
  const { prefs, apply, reset } = usePrefsApi()
  const dark = useIsDark()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQ('')
    setSel(0)
    input.current?.focus()
    return onEscape(() => {
      onClose()
      restoreFocus()
    })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const model = hq?.model || null
  const me = hq?.me || null
  const items = useMemo(() => {
    if (!open) return []
    const base: PaletteItem[] = [
      { id: 'suggest:checkin', group: 'Suggested', icon: 'plus', label: 'Check in', hint: 'L', run: onCheckin },
      { id: 'suggest:ask-waiting', group: 'Suggested', icon: 'spark', label: 'Ask AI: “What’s waiting on me?”', run: () => askAnywhere('What’s waiting on me?') },
      ...navList(prefs).map((k): PaletteItem => ({
        id: 'go:' + k, group: 'Go to', icon: NAV[k].icon, label: NAV[k].label, hint: 'G ' + NAV[k].key, run: () => go(NAV[k].path),
      })),
      ...(model?.projects || []).map((p): PaletteItem => {
        const s = projectSlugOf(p)
        return { id: 'project:' + s, group: 'Go to', label: String(p.data.title || s), color: colorSlot(p.data.color), hint: 'project', keywords: s, run: () => go('/projects/' + s) }
      }),
      ...(() => {
        const t = pagesTree(model)
        return [...t.dirs.flatMap((d) => d.items), ...t.files].map((d): PaletteItem => ({
          id: 'doc:' + d.path, group: 'Go to', icon: d.icon, label: d.title, hint: 'page', keywords: d.path, run: () => go('/docs/' + d.path),
        }))
      })(),
      ...(model?.roster || []).map((p): PaletteItem => ({
        id: 'person:' + p.slug, group: 'Go to', icon: 'user', label: p.name || p.login, hint: 'person', keywords: p.login, run: () => go('/people/' + p.slug),
      })),
      { id: 'go:settings', group: 'Go to', icon: 'settings', label: 'Settings', hint: 'G S', run: () => go('/settings') },
      { id: 'new:checkin', group: 'Create', icon: 'plus', label: 'Check in (log one line)', hint: 'L', run: onCheckin },
      { id: 'new:todo', group: 'Create', icon: 'tasks', label: 'New to-do', hint: 'N', run: create('/tasks', 'Tasks') },
      { id: 'new:post', group: 'Create', icon: 'board', label: 'New board post', run: create('/board', 'Board') },
      { id: 'new:project', group: 'Create', icon: 'projects', label: 'New project', run: create('/projects', 'Projects') },
      { id: 'look:adjust', group: 'Look', icon: 'wand', label: 'Adjust look…', keywords: 'theme size font colours', run: () => onAdjust() },
      { id: 'look:theme', group: 'Look', icon: dark ? 'sun' : 'moon', label: 'Switch to ' + (dark ? 'light' : 'dark'), keywords: 'theme mode', run: () => apply({ theme: dark ? 'light' : 'dark' }, dark ? 'Light theme' : 'Dark theme') },
      { id: 'look:reset', group: 'Look', icon: 'undo', label: 'Reset the look', run: reset },
    ]
    const query = q.trim()
    if (query) base.push({ id: 'ask:q', group: 'Ask AI', icon: 'spark', label: `Ask AI: “${query}”`, hint: '↵', run: () => askAnywhere(query) })
    return rankPalette([...base, ...sourcedItems(q, { model, me, route })], q)
  }, [open, q, model, me, route, prefs, dark, apply, reset, onCheckin, onAdjust])

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`#po-${sel}`)?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  if (!open) return null

  const run = (i: number) => {
    const it = items[i]
    const before = location.hash
    onClose() // hand-off: no focus restore here
    if (!it) return restoreFocus()
    it.run()
    // Nothing took focus and we stayed on the same page (e.g. "Switch to dark"): give focus back to the opener.
    setTimeout(() => {
      const a = document.activeElement
      if (location.hash === before && (!a || a === document.body)) restoreFocus()
    }, 80)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!items.length) return
      setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(sel)
    }
  }

  let group = ''
  return (
    <>
      <div
        className="scrim on"
        onClick={() => {
          onClose()
          restoreFocus()
        }}
      />
      <div className="pal on" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="pal-in">
          <Icon name="search" />
          <input
            ref={input}
            id={PALETTE_INPUT_ID}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-list"
            aria-autocomplete="list"
            aria-activedescendant={items.length ? `po-${sel}` : undefined}
            placeholder="Jump to, create, ask AI, or tweak the look…"
            autoComplete="off"
            spellCheck={false}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setSel(0)
            }}
            onKeyDown={onKey}
          />
        </div>
        <div className="pal-list" id="pal-list" role="listbox" aria-label="Results" ref={list}>
          {items.length ? (
            items.map((it, i) => {
              const head = it.group !== group ? (group = it.group) : null
              return (
                <div key={it.id} role="presentation">
                  {head && (
                    <div className="pal-g" role="presentation">
                      {head}
                    </div>
                  )}
                  <div
                    className="pal-it"
                    role="option"
                    id={`po-${i}`}
                    aria-selected={i === sel}
                    onMouseMove={() => i !== sel && setSel(i)}
                    onClick={() => run(i)}
                  >
                    {it.color ? <i className={'pdot pc' + it.color} aria-hidden="true" /> : <Icon name={it.icon || 'arrow'} />}
                    <span className="pal-t">{it.label}</span>
                    {it.hint && <span className="h">{it.hint}</span>}
                  </div>
                </div>
              )
            })
          ) : (
            <div className="empty">
              <Icon name="search" />
              No match
            </div>
          )}
        </div>
        <div className="pal-foot" aria-hidden="true">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span className="pal-try">Try “bigger text”</span>
        </div>
      </div>
    </>
  )
}
