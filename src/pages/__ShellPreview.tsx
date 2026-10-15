// Dev-only gallery of module A's shared components (#/__preview/ShellPreview). Never bundled in production builds
// (routes.tsx loads pages/__*.tsx only when import.meta.env.DEV). Synthetic data only.
import { useState } from 'react'
import { PageHeader } from '../components/shell/PageHeader'
import { NextBar } from '../components/shell/NextBar'
import { Callout, Chip, Empty, Markdown, Segmented, StatusPill, Switch, Toggle, Widget } from '../components/ui'
import { toast } from '../components/toast'
import type { NextItem, TileSpec } from '../lib/contracts'

export const v3 = true

const todo: NextItem = { kind: 'todo', id: 'preview:todo', text: 'Review the demo map', project: 'demo' }
const decision: NextItem = { kind: 'decision', id: 'preview:decision', text: 'Pick a direction for the solo page (#1, #2, both, other)', project: 'solo' }
const milestone: NextItem = { kind: 'milestone', id: 'preview:ms', text: 'Ship the first demo screen', project: 'demo' }
const TILES: TileSpec[] = [{ value: 0, label: 'zero' }, { value: '0 h', label: 'no time' }, null, { value: 5, label: 'open to-dos' }]

const MD = `Markdown with a chart that works and one that throws (its code block shows instead):

\`\`\`chart
{"type":"bar","title":"Hours","labels":["Mon","Tue","Wed"],"series":[{"name":"demo","data":[2,3,1]}]}
\`\`\`

\`\`\`chart
{"type":"table","title":"Broken","columns":["a","b"],"rows":[null]}
\`\`\`

The page stays.`

export default function ShellPreview() {
  const [completing, setCompleting] = useState(false)
  const [seg, setSeg] = useState<'a' | 'b'>('a')
  const [on, setOn] = useState(true)
  return (
    <div className="preview">
      <PageHeader icon="layers" title="Shell preview" sub="Module A components · synthetic data" tiles={TILES} next={todo} />
      <div className="grid">
        <div className="c12">
          <NextBar
            item={decision}
            variant="hero"
            then={todo}
            completing={completing}
            onAct={() => {
              setCompleting(true)
              setTimeout(() => setCompleting(false), 1400)
            }}
          />
        </div>
        <div className="c12">
          <NextBar item={milestone} variant="journey" caret={70} onAct={() => toast('Made it a to-do', 'ok', { undo: () => toast('Undone', 'info') })} />
        </div>
        <Widget
          id="pv-a"
          className="c7"
          title="For you"
          icon="inbox"
          count={3}
          act={<a className="btn ghost sm" href="#/tasks">All</a>}
          menu={[
            { label: 'Move up', icon: 'up', run: () => toast('Moved up', 'ok') },
            { label: 'Move down', icon: 'down', run: () => toast('Moved down', 'ok') },
            { label: 'Hide on Home', icon: 'eyeOff', run: () => toast('Hid For you', 'ok', { undo: () => toast('Showing For you', 'info') }) },
          ]}
        >
          <div className="rows">
            <div className="row"><span className="t">Review the demo map</span><span className="meta"><Chip tone="acc">demo</Chip></span></div>
            <div className="row"><span className="t">Ship the solo page</span><span className="meta"><StatusPill status="waiting" /></span></div>
          </div>
        </Widget>
        <Widget id="pv-b" className="c5" title="Bits" icon="grid" secondary>
          <div style={{ display: 'grid', gap: 10 }}>
            <Segmented label="View" value={seg} options={[['a', 'Board'], ['b', 'List']]} onChange={setSeg} />
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Switch on={on} onChange={setOn} label="Example switch" /> <span className="sm">Switch</span></span>
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><StatusPill status="active" /><StatusPill status="parked" /><Chip tone="ok" icon="check">ok</Chip><Chip tone="sample">Sample</Chip><Chip pressed={on} onClick={() => setOn(!on)}>Toggle chip</Chip></span>
            <Callout>A callout with <b>bold</b> words.</Callout>
            <Toggle title="A toggle">Hidden until opened.</Toggle>
          </div>
        </Widget>
        <section className="w c12" aria-label="Markdown">
          <Markdown md={MD} />
        </section>
        <section className="w c12" aria-label="Empty state">
          <Empty icon="inbox" text="Nothing waiting on you.">
            <button className="btn sm" type="button">Add a to-do</button>
          </Empty>
        </section>
      </div>
    </div>
  )
}
