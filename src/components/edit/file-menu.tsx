// Right-click menus for file rows (a project's Pages and Files cards): Open · Open on GitHub · Copy path, and for the
// project's owner Remove, with Undo that puts the exact text or bytes back. Removing keeps git history either way.
import { useHQ } from '../../lib/hq-context'
import type { MenuEntry } from '../shell/Popover'
import { kindOf } from '../../lib/files'
import { createBytes, createText, removeFile } from '../../lib/edit-io'
import { toast } from '../toast'
import { useContextMenu } from './kit'

const TEXT = new Set(['md', 'json', 'table', 'html', 'text'])

export function useFileMenu(owner: boolean, onChanged?: () => void) {
  const { source, reload } = useHQ()
  const ctx = useContextMenu()
  const name = (path: string) => path.split('/').pop() || path
  const remove = async (path: string) => {
    const n = name(path)
    const msg = `files: remove ${n}`
    try {
      if (TEXT.has(kindOf(path))) {
        const text = await source.read(path)
        if (text === null) return toast(`${n} is already gone`, 'info')
        await removeFile(source, path, msg, text)
        await reload()
        onChanged?.()
        toast(`Removed ${n}`, 'ok', { undo: () => void createText(source, path, text, `files: undo remove ${n}`).then(reload).then(() => onChanged?.(), (e) => toast(String(e?.message || e), 'error')) })
      } else {
        // the bytes, kept for Undo (an SVG through its text: the dev server never serves SVG bytes)
        const blob = kindOf(path) === 'svg' ? await source.read(path).then((t) => (t === null ? null : new Blob([t]))) : await source.readBytes(path)
        if (!blob) return toast(`${n} is already gone`, 'info')
        await removeFile(source, path, msg)
        onChanged?.()
        toast(`Removed ${n}`, 'ok', { undo: () => void createBytes(source, path, blob, `files: undo remove ${n}`).then(() => onChanged?.(), (e) => toast(String(e?.message || e), 'error')) })
      }
    } catch (e: any) {
      toast(String(e?.message || e), 'error')
    }
  }
  const items = (path: string): MenuEntry[] => {
    const web = source.webUrl(path)
    return [
      { label: 'Open', icon: 'file', run: () => void (location.hash = '#/docs/' + path) },
      ...(web ? [{ label: 'Open on GitHub', icon: 'ext' as const, run: () => void window.open(web, '_blank', 'noopener') }] : []),
      { label: 'Copy path', icon: 'copy', run: () => void navigator.clipboard?.writeText(path).then(() => toast('Path copied', 'ok'), () => toast(path, 'info')) },
      ...(owner && !/(^|\/)project\.md$/i.test(path) ? [{ label: 'Remove', icon: 'x' as const, run: () => void remove(path) }] : []),
    ]
  }
  return { bind: (path: string) => ctx.bind(() => items(path), `File: ${name(path)}`), menu: ctx.menu }
}
