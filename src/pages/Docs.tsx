// Docs reader (spec §6.6, plan C2). Title · property rows · Explain this page (side panel; above the text on narrow
// screens) · Open .md · auto compare from `options:` (+ ONE Decide when an open decision of mine links here) · body.
// Long docs (≥6 `##` sections): sections after the first 3 start collapsed with a one-line summary. Sticky TOC with
// reading progress. ✅/⚠️ State tables become a status board (the table stays one tap away); tables with 3+ columns
// turn into cards on phones. Images that are files in the data repo show (components/repo-images.ts). `#/docs` alone
// lists every page (the sidebar Pages tree is the main way in).
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useHQ } from '../lib/hq-context'
import { Icon } from '../lib/icons'
import type { BlockCtx, IconName, NextItem, PageProps } from '../lib/contracts'
import { displayName, projectOfPath, projectSlug, type Model } from '../lib/hq'
import { stripH1, title, type Doc } from '../lib/md'
import { useIsNarrow } from '../lib/bp'
import { optionsSpec } from '../lib/auto-visuals'
import { decisionDoc, nextQueue, type NextModel } from '../lib/next-core'
import { OPEN_SECTIONS, docOutline, headingText, splitTables, statusRows, type DocSection } from '../lib/read-core'
import { PageHeader } from '../components/shell/PageHeader'
import { NextBar } from '../components/shell/NextBar'
import { colorSlot, pagesTree } from '../components/shell/shell-core'
import { newBlockCtx } from '../components/blocks'
import { claimRich } from '../components/explainers/parse'
import { StatusBoard, statusFromText } from '../components/visuals/StatusBoard'
import { ExplainPanel, RichMd } from '../components/ExplainPanel'
import { Empty, Markdown, StatusPill, Toggle } from '../components/ui'
import { toast } from '../components/toast'
import { useRepoImages } from '../components/repo-images'

export const v3 = true

const LazyExplainer = lazy(() => import('../components/explainers/Explainer').then((m) => ({ default: m.Explainer })))

const str = (v: unknown) => (v == null ? '' : String(v))
const listOf = (v: unknown) => (Array.isArray(v) ? v.map(str) : typeof v === 'string' ? v.split(',') : []).map((s) => s.trim()).filter(Boolean)

export default function Docs({ route }: PageProps) {
  const { model } = useHQ()
  const path = route.doc
  if (!path) return <PagesIndex />
  const doc = model.byPath.get(path)
  if (!doc)
    return (
      <div className="read-page">
        <PageHeader icon="file" title="Page not found" />
        <Empty icon="file" text={`There's no page at ${path}.`}>
          <a className="btn" href="#/docs">
            All pages
          </a>
        </Empty>
      </div>
    )
  return <Reader key={doc.path} doc={doc} />
}

/** The open decision of mine whose to-do links this doc: the same item (id, text) the one Next resolver (C1's
 *  next-core) gives Home, Projects and Tasks, so the Decide here is that item's one button. */
function decisionFor(model: Model, doc: Doc, me: string): NextItem | null {
  try {
    // next-core's own link rule (anchor, ./ and / ignored), so a `link: notes/x.md#options` decision shows Decide here too
    const linksHere = (path?: string) => {
      const t = path ? model.byPath.get(path) : undefined
      return !!t && decisionDoc(t, model as unknown as NextModel)?.path === doc.path
    }
    return nextQueue(model, me).find((it) => it.kind === 'decision' && linksHere(it.path)) ?? null
  } catch {
    return null
  }
}

function docIconOf(model: Model, path: string): IconName {
  const t = pagesTree(model)
  const hit = [...t.files, ...t.dirs.flatMap((d) => d.items)].find((x) => x.path === path)
  return hit?.icon || (path.startsWith('projects/') ? 'projects' : 'file')
}

function Reader({ doc }: { doc: Doc }) {
  const { model, me, source, reload } = useHQ()
  const narrow = useIsNarrow()
  const [explain, setExplain] = useState(false)
  const explainBtn = useRef<HTMLButtonElement>(null)
  const article = useRef<HTMLElement>(null)
  const outline = useMemo(() => docOutline(stripH1(doc.body)), [doc])
  const [opened, setOpened] = useState<Set<string>>(() => new Set(outline.sections.slice(0, outline.long ? OPEN_SECTIONS : 99).map((s) => s.id)))
  const spec = useMemo(() => optionsSpec(doc), [doc])
  const decide = useMemo(() => decisionFor(model, doc, me.login), [model, doc, me.login])
  // Fresh per render: rich blocks claim their slot in render order (≤4 per doc; the auto compare counts as one).
  const ctx = newBlockCtx(doc.path, decide)
  const showCompare = !!spec && claimRich(ctx)
  const web = source.webUrl(doc.path) || (source.kind === 'local' ? '/__hq/read?path=' + encodeURIComponent(doc.path) : null)
  // Edit (owner of the project this page lives in): the page's exact text in a box; Save only when nobody changed the file meanwhile.
  const home = projectOfPath(doc.path)
  const owner = home ? String(model.projects.find((x) => projectSlug(x) === home)?.data.owner || '') : ''
  const canEdit = !!owner && owner.toLowerCase() === String(me.login || '').toLowerCase()
  const [draft, setDraft] = useState<{ text: string; orig: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const startEdit = () =>
    source
      .read(doc.path)
      .then((raw) => setDraft({ text: raw ?? '', orig: raw ?? '' }))
      .catch((e) => toast(String(e?.message || e), 'error'))
  const saveEdit = async () => {
    if (!draft) return
    setSaving(true)
    const { text, orig } = draft
    try {
      const ok = await source.update(doc.path, (cur) => {
        if ((cur ?? '') !== orig) throw new Error('This page changed since you opened it. Copy your text, reload, then edit again.')
        return text === cur ? null : text
      }, `docs: edit ${title(doc).slice(0, 50)}`)
      setDraft(null)
      if (!ok) return
      await reload()
      toast('Saved', 'ok', {
        undo: () => {
          source
            .update(doc.path, (cur) => (cur === text ? orig : cur), `docs: undo edit ${title(doc).slice(0, 40)}`)
            .then(() => reload())
            .catch((e) => toast(String(e?.message || e), 'error'))
        },
      })
    } catch (e: any) {
      toast(String(e?.message || e), 'error')
    } finally {
      setSaving(false)
    }
  }

  // Images that are files in the data repo (![Props](props_flat.jpg)): read through the Source, shown from blob: URLs.
  useRepoImages(article, source)

  // Wide tables (3+ columns) → cards on phones: each cell gets its column name.
  useLayoutEffect(() => {
    const root = article.current
    if (!root) return
    for (const t of root.querySelectorAll<HTMLTableElement>('.md table')) {
      const heads = [...t.querySelectorAll('thead th')].map((th) => (th.textContent || '').trim())
      t.classList.toggle('wide', heads.length >= 3)
      for (const tr of t.querySelectorAll('tbody tr')) [...tr.children].forEach((td, i) => heads[i] && td.setAttribute('data-label', heads[i]))
    }
  })

  const toggleExplain = () => setExplain((v) => !v)
  const closeExplain = () => {
    setExplain(false)
    setTimeout(() => explainBtn.current?.focus({ preventScroll: true }), 0)
  }
  const openSection = (id: string) =>
    setOpened((s) => {
      if (s.has(id)) return s
      const n = new Set(s)
      n.add(id)
      return n
    })
  const panel = explain ? <ExplainPanel path={doc.path} onClose={closeExplain} /> : null

  return (
    <div className={'doclay' + (explain && !narrow ? ' with-x' : '') + (outline.sections.length >= 2 ? ' has-toc' : '')}>
      <article className="doc" ref={article}>
        <PageHeader icon={docIconOf(model, doc.path)} title={title(doc)} />
        <DocProps doc={doc} model={model} />
        <div className="doc-acts">
          <button ref={explainBtn} className="btn sm" type="button" aria-pressed={explain} aria-expanded={explain} onClick={toggleExplain}>
            <Icon name="spark" size="s" />
            Explain this page
          </button>
          {canEdit && !draft && (
            <button className="btn sm" type="button" onClick={() => void startEdit()}>
              <Icon name="edit" size="s" />
              Edit
            </button>
          )}
          {web && (
            <a className="btn ghost sm" href={web} target="_blank" rel="noopener noreferrer" data-tipt={doc.path}>
              <Icon name="ext" size="s" />
              Open .md
            </a>
          )}
        </div>
        {draft ? (
          <div className="doc-edit">
            <p className="hint">The page's text in Markdown. The lines between the two --- at the top are its settings.</p>
            <textarea className="inp doc-ta" aria-label="Page text" value={draft.text} spellCheck onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
            <div className="doc-acts">
              <button className="btn sm primary" type="button" disabled={saving || draft.text === draft.orig} onClick={() => void saveEdit()}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button className="btn sm ghost" type="button" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <span className="hint">{draft.text === draft.orig ? 'No changes yet' : 'Unsaved changes'}</span>
            </div>
          </div>
        ) : (
          <>
        {narrow && panel}
        {showCompare && (
          <Suspense fallback={<div className="ex ex-loading" aria-busy="true" />}>
            <LazyExplainer spec={spec!} ctx={{ decide }} />
          </Suspense>
        )}
        {!showCompare && decide && <NextBar item={decide} />}
        {outline.intro && (
          <div className="doc-intro">
            <DocMd md={outline.intro} base={doc.path} ctx={ctx} />
          </div>
        )}
        {outline.sections.map((s) => (
          <Section key={s.id} s={s} base={doc.path} ctx={ctx} collapsible={outline.long} open={opened.has(s.id)} onOpen={(o) => setOpened((cur) => {
            const n = new Set(cur)
            if (o) n.add(s.id)
            else n.delete(s.id)
            return n
          })} />
        ))}
          </>
        )}
      </article>
      {!narrow && (panel || (outline.sections.length >= 2 && <Toc sections={outline.sections} article={article} onJump={openSection} long={outline.long} opened={opened} />))}
    </div>
  )
}

/** Property rows (Notion style): status, summary, next, projects, owner, updated. Only what the doc has. */
function DocProps({ doc, model }: { doc: Doc; model: Model }) {
  const d = doc.data
  const slugs = [...new Set([projectOfPath(doc.path), ...listOf(d.projects), ...listOf(d.project)].filter(Boolean) as string[])]
  const projects = slugs.map((s) => model.projects.find((p) => projectSlug(p) === s)).filter(Boolean) as Doc[]
  const rows: [IconName, string, ReactNode][] = []
  if (d.status) rows.push(['clock', 'Status', <StatusPill status={d.status} />])
  if (d.summary) rows.push(['info', 'Summary', str(d.summary)])
  if (d.next) rows.push(['arrow', 'Next', <b>{str(d.next)}</b>])
  if (projects.length)
    rows.push([
      'projects',
      projects.length > 1 ? 'Projects' : 'Project',
      <span className="pj-list">
        {projects.map((p) => (
          <a key={p.path} className={'pj pc' + colorSlot(p.data.color)} href={'#/projects/' + projectSlug(p)}>
            <span className="pdot" aria-hidden="true" />
            {str(p.data.title || projectSlug(p))}
          </a>
        ))}
      </span>,
    ])
  if (d.owner && !doc.path.startsWith('projects/')) rows.push(['user', 'Owner', displayName(model, d.owner)])
  if (d.updated) rows.push(['cal', 'Updated', str(d.updated).slice(0, 10)])
  if (!rows.length) return null
  return (
    <dl className="props">
      {rows.slice(0, 6).map(([icon, label, value]) => (
        <div key={label} className="prop">
          <dt>
            <Icon name={icon} />
            {label}
          </dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A section: plain in short docs; a toggle with a one-line summary in long ones. */
function Section(p: { s: DocSection; base: string; ctx: BlockCtx; collapsible: boolean; open: boolean; onOpen: (open: boolean) => void }) {
  const { s } = p
  const head = headingText(s.title)
  if (!p.collapsible)
    return (
      <section className="dsec" aria-labelledby={s.id}>
        <h2 id={s.id}>{head}</h2>
        <DocMd md={s.md} base={p.base} ctx={p.ctx} />
      </section>
    )
  return (
    <details className="tg sec dsec" open={p.open} onToggle={(e) => p.onOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <Icon name="chevR" size="s" className="chev" />
        <h2 id={s.id}>{head}</h2>
        {!p.open && s.summary && <span className="hint sec-sum">{s.summary}</span>}
      </summary>
      <div className="tg-body">
        <DocMd md={s.md} base={p.base} ctx={p.ctx} />
      </div>
    </details>
  )
}

/** Section body: ✅/⚠️ State tables → status board (+ the table behind a toggle); other tables and text → markdown with
 *  charts and explainers. */
function DocMd({ md, base, ctx }: { md: string; base: string; ctx: BlockCtx }) {
  const parts = splitTables(md)
  return (
    <>
      {parts.map((part, i) => {
        if (part.kind === 'md') return <RichMd key={i} md={part.text} base={base} ctx={ctx} />
        const rows = statusRows(part.table)
        if (!rows) return <Markdown key={i} md={part.raw} base={base} />
        return (
          <div key={i} className="doc-sboard">
            <StatusBoard items={rows.map((r) => ({ name: r.name, line: r.line, status: r.worst || statusFromText(r.cell), word: r.word || undefined }))} />
            <Toggle title={<span>Show as a table</span>} className="sb-table">
              <Markdown md={part.raw} base={base} />
            </Toggle>
          </div>
        )
      })}
    </>
  )
}

/** Sticky "On this page" with reading progress; jumping opens a collapsed section first. A long doc lists only its open
 *  sections plus one "Everything else · N" entry (the page itself already folds the rest away); labels stay on one line
 *  with the full title as a tooltip. */
function Toc({ sections, article, onJump, long = false, opened }: { sections: DocSection[]; article: React.RefObject<HTMLElement | null>; onJump: (id: string) => void; long?: boolean; opened?: Set<string> }) {
  const [pct, setPct] = useState(0)
  const [all, setAll] = useState(false)
  const listed = long && !all && opened ? sections.filter((s) => opened.has(s.id)) : sections
  const rest = sections.length - listed.length
  const [cur, setCur] = useState(sections[0]?.id || '')
  useEffect(() => {
    let raf = 0
    const measure = () => {
      raf = 0
      const el = article.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const total = Math.max(1, r.height - innerHeight * 0.6)
      setPct(Math.round(Math.max(0, Math.min(1, -r.top / total)) * 100))
      let at = sections[0]?.id || ''
      for (const s of sections) {
        const h = document.getElementById(s.id)
        if (h && h.getBoundingClientRect().top <= 96) at = s.id
      }
      setCur(at)
    }
    const on = () => {
      if (!raf) raf = requestAnimationFrame(measure)
    }
    measure()
    addEventListener('scroll', on, { passive: true })
    addEventListener('resize', on)
    return () => {
      removeEventListener('scroll', on)
      removeEventListener('resize', on)
      cancelAnimationFrame(raf)
    }
  }, [sections, article])
  const jump = (id: string) => {
    onJump(id)
    setTimeout(() => {
      const h = document.getElementById(id)
      h?.scrollIntoView({ block: 'start' })
    }, 0)
  }
  return (
    <nav className="toc2" aria-label="On this page">
      <div className="rprog" role="progressbar" aria-label="Read" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <i style={{ width: pct + '%' }} />
      </div>
      {listed.map((s) => (
        <button key={s.id} type="button" className="toc-a" aria-current={cur === s.id ? 'true' : undefined} title={headingText(s.title)} onClick={() => jump(s.id)}>
          {headingText(s.title)}
        </button>
      ))}
      {rest > 0 && (
        <button
          type="button"
          className="toc-a toc-more"
          aria-current={sections.some((s) => s.id === cur && !listed.includes(s)) ? 'true' : undefined}
          onClick={() => {
            setAll(true)
            const first = sections.find((s) => !listed.includes(s))
            if (first) setTimeout(() => document.getElementById(first.id)?.scrollIntoView({ block: 'start' }), 0)
          }}
        >
          Everything else · {rest}
        </button>
      )}
    </nav>
  )
}

/** `#/docs` without a page: every page by folder (titles + icons), like the sidebar tree. */
function PagesIndex() {
  const { model } = useHQ()
  const tree = useMemo(() => pagesTree(model), [model])
  const n = tree.files.length + tree.dirs.reduce((a, d) => a + d.items.length, 0)
  const row = (it: { path: string; title: string; icon: IconName }) => (
    <a key={it.path} className="pg-row" href={'#/docs/' + it.path}>
      <Icon name={it.icon} />
      <span>{it.title}</span>
    </a>
  )
  return (
    <div className="read-page pages-index">
      <PageHeader icon="file" title="Pages" sub={`${n} ${n === 1 ? 'page' : 'pages'}`} />
      {!n && <Empty icon="file" text="No pages yet." />}
      {tree.files.length > 0 && <div className="w pg-list">{tree.files.map(row)}</div>}
      {tree.dirs.map((d) => (
        <section key={d.dir} className="w pg-list" aria-labelledby={'pg-' + d.dir}>
          <h2 id={'pg-' + d.dir} className="pg-h">
            <Icon name="folder" />
            {d.label}
            <span className="count">{d.items.length}</span>
          </h2>
          {d.items.map(row)}
        </section>
      ))}
    </div>
  )
}
