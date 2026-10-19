// One renderer for every ```explainer block (spec §5.1): header = icon + title + ⋯ (Open "<source title>" · Copy as a
// block · What is this?), a bold lead from `subtitle`, then the body for its type. Text only: every string from the
// spec is rendered by React as text, never as HTML. Wrapped in a Boundary whose fallback is the block's code.
// Counting rich blocks is the caller's job (BLOCKS in components/blocks.tsx, or claimRich() from ./parse).
import { Icon } from '../../lib/icons'
import { useHQMaybe } from '../../lib/hq-context'
import { routeFor } from '../../lib/hq'
import { title as docTitle } from '../../lib/md'
import { go } from '../../lib/router'
import type { BlockCtx, IconName } from '../../lib/contracts'
import { Boundary } from '../ErrorBoundary'
import { MenuButton, type MenuEntry } from '../shell/Popover'
import { toast } from '../toast'
import { CodeBlock } from '../blocks'
import { clip, codeFallback, type ExplainerSpec, type ExType } from './parse'
import { Flow } from './Flow'
import { MapView } from './MapView'
import { Compare } from './Compare'
import { Cards } from './Cards'
import { Timeline } from './Timeline'
import { Network, StateMachine } from './Graph'

export const TYPE_ICON: Record<ExType, IconName> = { flow: 'route', map: 'map', cards: 'layers', timeline: 'cal', compare: 'table', statemachine: 'commit', network: 'hook' }
export const WHAT_IS_THIS = 'An explainer: a picture written as a small JSON block in a note'

type Props = {
  spec: ExplainerSpec
  /** `ctx.decide`: an open decision about this doc → the compare gets ONE Next bar with Decide. */
  ctx?: Pick<BlockCtx, 'decide'> | null
  /** The block's original text (for "Copy as a block" and the code fallback). Defaults to the clean spec as JSON. */
  raw?: string
  /** Header icon override (defaults by type). */
  icon?: IconName
  className?: string
}

/** The block text as it would sit in a note. */
export function asBlock(spec: ExplainerSpec, raw?: string) {
  const body = raw && raw.trim() ? raw.trim() : JSON.stringify(spec, null, 2)
  return '```explainer\n' + body + '\n```'
}

function Body({ spec, ctx }: { spec: ExplainerSpec; ctx?: Props['ctx'] }) {
  switch (spec.type) {
    case 'flow':
      return <Flow spec={spec} />
    case 'map':
      return <MapView spec={spec} />
    case 'compare':
      return <Compare spec={spec} decide={ctx?.decide} />
    case 'cards':
      return <Cards spec={spec} />
    case 'timeline':
      return <Timeline spec={spec} />
    case 'statemachine':
      return <StateMachine spec={spec} />
    case 'network':
      return <Network spec={spec} />
    default:
      return null
  }
}

function ExplainerInner({ spec, ctx, raw, icon, className }: Props) {
  const hq = useHQMaybe()
  const src = spec.source ? hq?.model.byPath.get(spec.source) : undefined
  const menu: MenuEntry[] = [
    ...(src ? [{ label: `Open “${clip(docTitle(src), 40)}”`, icon: 'file' as IconName, run: () => go(routeFor(src.path)) }] : []),
    {
      label: 'Copy as a block',
      icon: 'copy',
      run: () => {
        const text = asBlock(spec, raw)
        const done = () => toast('Copied the explainer block', 'ok')
        const fail = () => toast('Couldn’t copy. Select the block text instead.', 'error')
        try {
          if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fail)
          else fail()
        } catch {
          fail()
        }
      },
    },
    { label: 'What is this?', icon: 'info', run: () => toast(WHAT_IS_THIS, 'info') },
  ]
  return (
    <section className={'ex ex-' + spec.type + (className ? ' ' + className : '')} aria-label={spec.title}>
      <div className="ex-h">
        <h3>
          <Icon name={icon || TYPE_ICON[spec.type] || 'layers'} />
          <span>{spec.title}</span>
        </h3>
        <MenuButton label={'More: ' + spec.title} items={menu} width={240} />
      </div>
      <div className="ex-b">
        {spec.subtitle && <p className="ex-lead">{spec.subtitle}</p>}
        <Body spec={spec} ctx={ctx} />
      </div>
    </section>
  )
}

/** `<Explainer spec ctx/>`: draws a parsed spec (from parseExplainer or optionsSpec). */
export function Explainer(p: Props) {
  if (!p.spec) return null
  return (
    <Boundary fallback={<CodeBlock lang="explainer" text={codeFallback(p.raw ?? p.spec)} />} resetKey={p.spec}>
      <ExplainerInner {...p} />
    </Boundary>
  )
}
export default Explainer
