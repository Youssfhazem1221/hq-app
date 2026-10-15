// Rich blocks inside markdown (notes, docs, AI answers): ```chart and ```explainer. One renderer per language
// (contracts BlockRenderer). Rules (spec §5.1, E6): parse is total; a block that can't be drawn shows as its code;
// at most MAX_RICH_BLOCKS rich blocks per BlockCtx (the next one shows as code); every drawn block sits in a
// Boundary whose fallback is its code. Explainer renderers load on demand (their own chunk).
//
// How a caller uses it (A2 wires this into components/ui.tsx Markdown):
//   const ctx = newBlockCtx(docPath, decide)   // FRESH in every render (not in useMemo/useRef): renderers count
//   splitBlocks(md).map((p, i) => p.kind === 'md' ? <Md key={i} …/> : <Fragment key={i}>{BLOCKS[p.kind](p.src, ctx)}</Fragment>)
// Renderers claim their slot synchronously, in call order, so a fresh ctx per render gives the same result on every
// render (StrictMode included).
import { lazy, Suspense } from 'react'
import { MAX_RICH_BLOCKS, type BlockCtx, type BlockRenderer, type NextItem } from '../lib/contracts'
import { Boundary } from './ErrorBoundary'
import { Chart, parseChart } from './charts'
import { claimRich, codeFallback, parseExplainer } from './explainers/parse'

const LazyExplainer = lazy(() => import('./explainers/Explainer').then((m) => ({ default: m.Explainer })))

export const RICH_LANGS = ['chart', 'explainer'] as const
export type RichLang = (typeof RICH_LANGS)[number]
export { MAX_RICH_BLOCKS }

/** A rich block's text shown as a plain code block (bad JSON, over budget, a renderer threw). Text only. */
export function CodeBlock({ lang, text }: { lang?: string; text: string }) {
  return (
    <div className="md code-fb">
      <pre>
        <code className={lang ? 'language-' + lang : undefined}>{text}</code>
      </pre>
    </div>
  )
}

/** Placeholder while the explainer chunk loads (same rough footprint, no layout jump to speak of). */
function BlockLoading() {
  return (
    <div className="ex ex-loading" aria-busy="true">
      <span className="sk" style={{ width: '40%', height: 16 }} />
      <span className="sk" style={{ width: '100%', height: 120 }} />
    </div>
  )
}

/** A per-document (or per-answer) render context: ≤MAX_RICH_BLOCKS rich blocks. Make a fresh one per render. */
export function newBlockCtx(docPath?: string, decide?: NextItem | null): BlockCtx {
  return { rich: { n: 0 }, docPath, decide: decide ?? null }
}

/** ```chart → Chart. Unparseable or over budget → code. */
function chartBlock(src: string, ctx: BlockCtx) {
  const code = <CodeBlock lang="chart" text={codeFallback(src)} />
  const spec = parseChart(src)
  if (!spec || !claimRich(ctx)) return code
  return (
    <Boundary fallback={code}>
      <Chart spec={spec} />
    </Boundary>
  )
}

/** ```explainer → Explainer (lazy chunk). `source` is checked against the model when it renders. */
function explainerBlock(src: string, ctx: BlockCtx) {
  const code = <CodeBlock lang="explainer" text={codeFallback(src)} />
  const spec = parseExplainer(src, { exists: () => true })
  if (!spec || !claimRich(ctx)) return code
  return (
    <Boundary fallback={code}>
      <Suspense fallback={<BlockLoading />}>
        <LazyExplainer spec={spec} ctx={ctx} raw={src} />
      </Suspense>
    </Boundary>
  )
}

export const BLOCKS: Record<RichLang, BlockRenderer> = { chart: chartBlock, explainer: explainerBlock }

export type BlockPart = { kind: 'md'; text: string } | { kind: RichLang; src: string; raw: string }

const FENCE = /^```[ \t]*(chart|explainer)\b[^\n]*\n([\s\S]*?)^```[ \t]*\r?$/gm

/** Markdown → plain parts and rich-block parts, in order. A fence that isn't closed stays plain markdown. */
export function splitBlocks(md: string): BlockPart[] {
  const text = String(md || '')
  const out: BlockPart[] = []
  let last = 0
  for (const m of text.matchAll(FENCE)) {
    const at = m.index || 0
    if (at > last) out.push({ kind: 'md', text: text.slice(last, at) })
    out.push({ kind: m[1] as RichLang, src: m[2], raw: m[0] })
    last = at + m[0].length
  }
  if (last < text.length) out.push({ kind: 'md', text: text.slice(last) })
  return out.filter((p) => p.kind !== 'md' || p.text.trim())
}
