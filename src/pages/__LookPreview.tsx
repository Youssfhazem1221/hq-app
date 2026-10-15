// Dev only (#/__preview/LookPreview, never bundled in production): module E's REAL look store (usePrefs: device cache +
// people/<slug>/ui.md, 8 s debounced write, re-read on refresh) driving Settings and the Adjust look drawer, before A2
// swaps it into App in place of the interim store. Use it on a fixture server only (HQ_ROOT=<fixture copy>): Apply
// writes the signed-in person's ui.md there.
import { useEffect, useState } from 'react'
import { PrefsContext, useHQ } from '../lib/hq-context'
import { usePrefs } from '../lib/prefs'
import type { FileEntry } from '../lib/source'
import type { PageProps } from '../lib/contracts'
import Settings from './Settings'

export const v3 = true

export default function LookPreview({ route }: PageProps) {
  const { source, me, model, loadedAt } = useHQ()
  const [files, setFiles] = useState<FileEntry[] | null>(null)
  // re-read the files whenever the app sees a change (local file events, focus, the 60 s check)
  useEffect(() => {
    let off = false
    source.loadAll().then((f) => !off && setFiles(f), () => {})
    return () => {
      off = true
    }
  }, [source, loadedAt])
  const slug = model.roster.find((p) => p.login.toLowerCase() === me.login.toLowerCase())?.slug || null
  const api = usePrefs(me.login, { source, files, slug })
  return (
    <PrefsContext.Provider value={api}>
      <p className="hint" data-preview="look">
        Preview · real look store for {me.login} · {api.look.path} · save: <b data-save={api.look.save}>{api.look.save}</b>
      </p>
      <Settings route={route} source={source} onConnect={() => {}} />
    </PrefsContext.Provider>
  )
}
