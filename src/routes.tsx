// Route → page module. Every page is its own lazy chunk (pages/<Page>.tsx, one file per PageName), and every page renders
// inside the ONE Next actions provider (components/NextActions.tsx: act + completing + the Decide sheet + the palette's
// "Next: …"). The provider loads together with the page chunk, not with the first paint (spec §9 entry budget); pages
// that also wrap themselves get a pass-through (only the outermost provider is real).
// Dev only: #/__preview/<Name> loads src/pages/__<Name>.tsx (never bundled in production).
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react'
import type { PageName, Route } from './lib/contracts'
import { pickPage } from './lib/router'

type PageModule = { default: ComponentType<any>; v3?: boolean }

const PAGES = import.meta.glob<PageModule>(['./pages/*.tsx', '!./pages/__*.tsx'])
const PREVIEWS: Record<string, () => Promise<PageModule>> = import.meta.env.DEV ? import.meta.glob<PageModule>('./pages/__*.tsx') : {}

const nameOf = (file: string) => file.replace(/^\.\/pages\/(__)?/, '').replace(/\.tsx$/, '')
/** Page files that exist (names without .tsx). */
export const PAGE_FILES = Object.keys(PAGES).map(nameOf)

const loadNext = () => import('./components/NextActions')

const cache = new Map<string, LazyExoticComponent<ComponentType<any>>>()
function lazyPage(file: string, load: () => Promise<PageModule>) {
  let C = cache.get(file)
  if (!C) {
    C = lazy(async () => {
      const [m, next] = await Promise.all([load(), loadNext()])
      const Page = m.default
      const Provider = next.NextActionsProvider
      const Routed = (props: any) => (
        <Provider>
          <Page {...props} />
        </Provider>
      )
      return { default: Routed }
    })
    cache.set(file, C)
  }
  return C
}

/** The module a page resolves to (null when its file is missing). */
export const resolvePage = (page: PageName) => pickPage(page, PAGE_FILES)

/** Dev-only preview pages (`#/__preview/<Name>`), null in production builds. */
export function previewFor(path: string) {
  const m = path.match(/^\/__preview\/([\w-]+)$/)
  if (!m || !import.meta.env.DEV) return null
  const file = `./pages/__${m[1]}.tsx`
  return PREVIEWS[file] ? lazyPage(file, PREVIEWS[file]) : null
}

export function PageLoading() {
  return (
    <div className="page-loading" aria-busy="true" aria-live="polite">
      <span className="sk" style={{ width: '38%', height: 26 }} />
      <span className="sk" style={{ width: '100%', height: 64 }} />
      <span className="sk" style={{ width: '72%' }} />
    </div>
  )
}

/** Renders the page for a route. `extra` = Settings' props (source, onConnect, theme, toggleTheme). */
export function PageView({ route, extra }: { route: Route; extra?: Record<string, unknown> }) {
  const preview = previewFor(route.path)
  const name = resolvePage(route.page)
  const file = name ? `./pages/${name}.tsx` : null
  const Page = preview || (file && PAGES[file] ? lazyPage(file, PAGES[file]) : null)
  if (!Page) return null
  return (
    <Suspense fallback={<PageLoading />}>
      <Page route={route} {...extra} />
    </Suspense>
  )
}
