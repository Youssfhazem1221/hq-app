// Dev-only gallery of module B's visuals (#/__preview/VisualsPreview). Never bundled in production (routes.tsx loads
// pages/__*.tsx only when import.meta.env.DEV). Synthetic data only (alice, bob, carol, projects demo + solo).
import { Fragment, useState } from 'react'
import { PageHeader } from '../components/shell/PageHeader'
import { Markdown, Widget } from '../components/ui'
import { toast } from '../components/toast'
import { Chart, stacked, type ChartSpec } from '../components/charts'
import { BLOCKS, newBlockCtx, splitBlocks } from '../components/blocks'
import { Explainer } from '../components/explainers/Explainer'
import { parseExplainer, type ExplainerSpec } from '../components/explainers/parse'
import { Journey } from '../components/visuals/Journey'
import { Scatter } from '../components/visuals/Scatter'
import { GoalMeter } from '../components/visuals/GoalMeter'
import { WeekDots } from '../components/visuals/WeekDots'
import { Heatmap } from '../components/visuals/Heatmap'
import { StatusBoard, type StatusItem } from '../components/visuals/StatusBoard'
import { Beads } from '../components/visuals/Beads'
import { optionsSpec } from '../lib/auto-visuals'
import type { NextItem } from '../lib/contracts'

export const v3 = true

const ok = (p: string) => p.endsWith('.md')
const ex = (o: object) => parseExplainer(o, { exists: ok }) as ExplainerSpec

const SM = ex({
  type: 'statemachine', title: 'Order lifecycle', subtitle: 'Where an order can go next. Tap a state.', source: 'projects/demo/project.md', initial: 'new',
  states: [
    { id: 'new', label: 'New', sub: 'cart saved', icon: 'file' },
    { id: 'paid', label: 'Paid', icon: 'coins' },
    { id: 'failed', label: 'Payment failed' },
    { id: 'shipped', label: 'Shipped', sub: 'with the courier' },
    { id: 'done', label: 'Delivered', terminal: true, icon: 'check' },
    { id: 'refunded', label: 'Refunded', terminal: true },
  ],
  transitions: [
    { from: 'new', to: 'paid', label: 'payment ok' },
    { from: 'new', to: 'failed', label: 'card declined' },
    { from: 'failed', to: 'new', label: 'try again' },
    { from: 'failed', to: 'failed', label: 'retry', style: 'dashed' },
    { from: 'paid', to: 'shipped', label: 'warehouse' },
    { from: 'shipped', to: 'done', label: 'courier confirms' },
    { from: 'paid', to: 'refunded', label: 'cancelled', style: 'dashed' },
    { from: 'new', to: 'shipped', label: 'free sample', style: 'dashed' },
  ],
})
const SM_LONG = ex({
  type: 'statemachine', title: 'Short video pipeline', initial: 'idea',
  states: ['idea', 'script', 'voice', 'animate', 'edit', 'review', 'posted'].map((id, i) => ({ id, label: id[0].toUpperCase() + id.slice(1), terminal: i === 6 })),
  transitions: [
    { from: 'idea', to: 'script' }, { from: 'script', to: 'voice', label: 'hook <= 12 words' }, { from: 'voice', to: 'animate' },
    { from: 'animate', to: 'edit' }, { from: 'edit', to: 'review' }, { from: 'review', to: 'posted', label: 'approved' },
    { from: 'review', to: 'script', label: 'rewrite' },
  ],
})
const NET = ex({
  type: 'network', title: 'HQ services', subtitle: 'What talks to what. Tap a node.', source: 'projects/demo/project.md',
  nodes: [
    { id: 'app', label: 'hq-app', group: 'Frontend', icon: 'layout', size: 'lg' },
    { id: 'pages', label: 'GitHub Pages', group: 'Frontend', icon: 'globe' },
    { id: 'ask', label: 'ask function', group: 'Supabase', icon: 'zap' },
    { id: 'notify', label: 'notify function', group: 'Supabase', icon: 'bell' },
    { id: 'db', label: 'pgvector index', group: 'Supabase', icon: 'db', size: 'lg' },
    { id: 'repo', label: 'hq repo', group: 'GitHub', icon: 'repo', size: 'lg' },
    { id: 'actions', label: 'Actions', group: 'GitHub', icon: 'zap', size: 'sm' },
    { id: 'bridge', label: 'Claude bridge', icon: 'bot' },
    { id: 'gemini', label: 'Gemini', icon: 'spark', size: 'sm' },
  ],
  edges: [
    { from: 'pages', to: 'app', label: 'serves' }, { from: 'app', to: 'ask', label: 'Ask AI', weight: 3 },
    { from: 'app', to: 'repo', label: 'read · write', bidirectional: true, weight: 4 }, { from: 'ask', to: 'db', label: 'search', weight: 2 },
    { from: 'ask', to: 'gemini', label: 'prompt' }, { from: 'repo', to: 'actions', label: 'on push' },
    { from: 'actions', to: 'db', label: 'index' }, { from: 'repo', to: 'notify', label: 'webhook' },
    { from: 'notify', to: 'bridge', label: 'wake' }, { from: 'bridge', to: 'repo', label: 'pull · push', both: true },
  ],
})

const MAP = ex({
  type: 'map', title: 'How the demo app works', subtitle: 'Everything goes through the API. Tap a box.', source: 'projects/demo/project.md',
  nodes: [
    { id: 'phone', label: 'Phone app', sub: 'alice builds it', col: 0, row: 0, what: 'The app people install.', bullets: ['Talks to the API only', 'Works offline for reading'] },
    { id: 'web', label: 'Web page', sub: 'static site', col: 1, row: 0, status: 'next', what: 'The public page.' },
    { id: 'api', label: 'API', sub: 'one server', col: 2, row: 0, what: 'Every read and write goes through here.' },
    { id: 'auth', label: 'Sign-in', sub: 'tokens', col: 3, row: 0, status: 'wait', what: 'Waiting on the provider.' },
    { id: 'queue', label: 'Queue', sub: 'jobs', col: 0, row: 1, what: 'Slow work waits here.' },
    { id: 'db', label: 'Database', sub: 'one file per thing', col: 1, row: 1, what: 'The single source of truth.' },
    { id: 'search', label: 'Search', sub: 'index', col: 2, row: 1, status: 'later', what: 'Comes after the first release.' },
    { id: 'worker', label: 'Worker', sub: 'bob runs it', col: 0, row: 2, status: 'blocked', what: 'Blocked on the queue format.' },
    { id: 'mail', label: 'Mail', sub: 'weekly digest', col: 1, row: 2, what: 'Sends the weekly digest.' },
    { id: 'admin', label: 'Admin', sub: 'carol', col: 2, row: 2, what: 'A small page for support.' },
  ],
  edges: [
    { from: 'phone', to: 'web' }, { from: 'web', to: 'api', label: 'reads' }, { from: 'api', to: 'auth', label: 'checks' },
    { from: 'api', to: 'db', label: 'read · write', both: true }, { from: 'api', to: 'search', label: 'search' },
    { from: 'db', to: 'queue', label: 'new job' }, { from: 'queue', to: 'worker', label: 'wake', style: 'dashed' },
    { from: 'worker', to: 'mail', label: 'sends' }, { from: 'admin', to: 'db', label: 'fixes' }, { from: 'phone', to: 'queue' },
  ],
})
const FLOW = ex({
  type: 'flow', title: 'The 2-week page test', subtitle: 'Prove demand before building anything.',
  steps: [
    { title: 'Open the page', text: 'Two social pages, local language first.', icon: 'flag', status: 'next' },
    { title: 'Add 10 spots', text: 'Real prices and photos, so it looks alive from day one.', icon: 'pin' },
    { title: 'Count submissions', text: 'The signal: people send in spots on their own.', icon: 'chart', bullets: ['Similar maps earn nothing directly', 'Money would come from sponsors'] },
    { title: 'Build or drop', text: 'Submissions keep coming → build it. Silence → drop it, no regrets.', icon: 'check' },
  ],
})
const OPTIONS = [
  { name: 'Support audits for online stores', short: 'Support audits', paid_in: 'USD', first_money: '2–4 weeks', speed: 4, recommended: true, evidence: '✅ own case study · ✅ public pricing' },
  { name: 'Template packs for a holiday season', short: 'Template packs', paid_in: 'USD', first_money: 'Jan–Feb 2027', evidence: '✅ market signal · ⚠️ supply & payouts' },
  { name: 'Websites for small businesses', short: 'Small-biz sites', paid_in: 'local', first_money: '2–4 weeks', evidence: '💭 not researched yet' },
  { name: 'Order confirmation for sellers', short: 'Order checks', paid_in: 'local', first_money: '1–2 months', evidence: '✅ competitors exist · ⚠️ problem size' },
  { name: 'A cheap-food map site', short: 'Food map site', paid_in: 'local (slow)', first_money: 'months', speed: 1, evidence: '✅ similar maps earn $0' },
  { name: 'Mystery option with no data' },
]
const CMP = optionsSpec({ path: 'notes/options.md', data: { options: OPTIONS, next: 'Pick a direction: #1, #2, both, or other' } })!
const CARDS = ex({
  type: 'cards', title: 'Three ways to start', subtitle: 'Pick the one that fits this week.',
  cards: [
    { title: 'Ask a teammate', text: 'Post on the board and tag them.', icon: 'users', more: ['Add a clear question', 'Say when you need it'] },
    { title: 'Write it down', text: 'One note per idea.', icon: 'file' },
    { title: 'Try it small', text: 'One afternoon, then decide.', icon: 'zap', more: ['Time-box it to 2 hours'] },
    { title: 'Drop it', text: 'Not every idea needs doing.', icon: 'blocked' },
  ],
})
const TIMELINE = ex({
  type: 'timeline', title: 'Launch plan', items: [
    { date: '1 Oct', title: 'Kick-off with alice and bob', done: true }, { date: '8 Oct', title: 'First screen', done: true },
    { date: '20 Oct', title: 'Private beta' }, { date: '3 Nov', title: 'Public page' }, { date: 'later', title: 'Search' },
  ],
})

const doc = (path: string, data: object) => ({ path, data })
const DEMO = doc('projects/demo/project.md', {
  title: 'Demo app', color: 2, owner: 'alice', members: ['bob'], started: '2026-10-01', goal: 'A small app ten people use every week',
  milestones: [
    { text: 'Pick a name', done: true, date: '2026-10-01' }, { text: 'Sketch the first screen', done: true, date: '2026-10-02' },
    { text: 'Set up the repo', done: true, date: '2026-10-03' }, { text: 'Sign-in works', done: true, date: '2026-10-05' },
    { text: 'Data model', done: true, date: '2026-10-06' }, { text: 'First screen live', done: true, date: '2026-10-08' },
    { text: 'Invite two testers', done: true, date: '2026-10-10' }, { text: 'Fix the top 3 bugs', done: true, date: '2026-10-12' },
    { text: 'Ask one tester a question and write down the answer' }, { text: 'Public page' },
  ],
  metrics: [{ date: '2026-10-14', followers: 881, profile_views_7d: 27 }],
})
const SOLO = doc('projects/solo/project.md', {
  title: 'Solo page', color: 3, owner: 'carol', goal: 'One page that explains the solo project',
  milestones: [{ text: 'Write it', done: true }, { text: 'Ship it', done: true }],
})
const EMPTY = doc('projects/empty/project.md', { title: 'Empty', color: 9, owner: 'bob' })
const WAIT = doc('projects/wait/project.md', {
  title: 'Waiting', color: 4, owner: 'bob', milestones: [{ text: 'Pick a direction', done: true }, { text: 'Decide' }, { text: 'Build' }, { text: 'Test' }, { text: 'Launch' }, { text: 'Grow' }],
})

const NEXT_MS: NextItem = { kind: 'milestone', id: 'ms:demo', text: 'Ask one tester a question and write down the answer', project: 'demo' }
const DECIDE: NextItem = { kind: 'decision', id: 'preview:decide', text: 'Pick a direction (#1, #2, both, other)', project: 'demo' }

const WEEKS = ['23 Aug', '30 Aug', '6 Sep', '13 Sep', '20 Sep', '27 Sep', '4 Oct', '11 Oct']
const TIME = stacked({
  title: 'Time per project', subtitle: 'Hours per week · last 8 weeks', unit: 'h', labels: WEEKS,
  series: [
    { name: 'Demo app', color: 2, data: [3, 3.5, 4, 5, 3.5, 6, 6.5, 6.5] },
    { name: 'Solo page', color: 3, data: [1.5, 0.5, 2, 1.5, 2, 0.5, 1, 2] },
    { name: 'Waiting', color: 4, data: [0, 0.5, 0.5, 1, 0.3, 1.5, 1.5, 1] },
    { name: 'Other', color: 1, data: [1, 1.5, 0, 0, 0.5, 0, 0, 0.5] },
  ],
})
const CHARTS: ChartSpec[] = [
  { type: 'bar', title: 'Posts per person', labels: ['alice', 'bob', 'carol'], series: [{ name: 'Posts', data: [4, 7, 2] }, { name: 'Replies', data: [6, 3, 5] }] },
  { type: 'bar', title: 'Open to-dos by project', horizontal: true, labels: ['Demo app', 'Solo page', 'Waiting'], series: [{ name: 'Open', data: [5, 2, 3] }] },
  { type: 'line', title: 'Followers', subtitle: 'with a goal line', labels: ['1 Oct', '8 Oct', '15 Oct', '22 Oct'], series: [{ name: 'Followers', data: [820, 846, 881, 905] }], goal: 1000 },
  { type: 'line', title: 'Energy', subtitle: 'Weekly average, 1–5', labels: ['23', '30', '6', '13', '20', '27', '4', '11'], series: [{ name: 'Energy', color: 1, data: [3.2, 3.5, 3, 3.8, 3.4, 3.9, 3.6, 3.8] }], min: 1, max: 5 },
  { type: 'line', title: 'Replies per week', labels: ['W1', 'W2', 'W3', 'W4', 'W5'], series: [{ name: 'alice', data: [2, 4, 3, 5, 6] }, { name: 'bob', data: [1, 1, 2, null, 3] }] },
  { type: 'stat', title: 'This week', stats: [{ label: 'check-ins', value: 4, delta: '+1' }, { label: 'hours', value: 10.5, delta: '-2', good: false }, { label: 'wins', value: 2 }] },
  { type: 'progress', title: 'Milestones done', items: [{ label: 'Demo app', value: 8, max: 10, color: 2 }, { label: 'Solo page', value: 2, max: 2, color: 3 }, { label: 'Waiting', value: 1, max: 6, color: 4 }] },
  { type: 'table', title: 'Who is on what', columns: ['Project', 'Owner', 'Members'], rows: [['Demo app', 'alice', 'bob'], ['Solo page', 'carol', null]] },
]

const HEAT = Array.from({ length: 84 }, (_, i) => (i > 80 ? null : [0, 1, 0, 2, 3, 0, 1, 4, 0, 2][(i * 7) % 10]))
const STATUS: StatusItem[] = [
  { name: 'Search index', line: 'Notes → chunks → search', icon: 'db', status: 'ok' },
  { name: 'Streaming answers', line: 'First words in ~5 s', icon: 'zap', status: 'ok' },
  { name: 'Doorbell', line: 'App hears a push in ~1 s', icon: 'bell', status: 'ok' },
  { name: 'Live sync', line: 'Push, focus, every 60 s', icon: 'history', status: 'ok' },
  { name: 'Project folders', line: 'projects/<slug>/', icon: 'folder', status: 'ok' },
  { name: 'Helper bot', line: 'No real post handled yet', icon: 'bot', status: 'warn' },
]

const big = JSON.stringify({ type: 'flow', title: 'Too big', steps: [{ title: 'x', text: 'y'.repeat(13000) }] })
const MD = `Seven fenced blocks in one doc. Bad JSON and the 13 KB block show as code. Five parse; the first four draw and the fifth shows as code.

\`\`\`chart
{"type":"bar","title":"Hours","labels":["Mon","Tue","Wed"],"series":[{"name":"demo","data":[2,3,1]}]}
\`\`\`

\`\`\`explainer
{"type":"steps","title":"Three steps","steps":[{"title":"Write a post","icon":"file"},{"title":"Flag it","icon":"flag"},{"title":"Get a reply","icon":"bot","text":"In about a minute."}]}
\`\`\`

\`\`\`explainer
{"type":"flow","steps":"abc"}
\`\`\`

\`\`\`explainer
${big}
\`\`\`

\`\`\`explainer
{"type":"timeline","title":"Two dates","items":[{"date":"1 Oct","title":"Start","done":true},{"date":"1 Nov","title":"Ship"}]}
\`\`\`

\`\`\`chart
{"type":"stat","stats":[{"label":"posts","value":12}]}
\`\`\`

\`\`\`explainer
{"type":"cards","title":"Fifth rich block","cards":[{"title":"Shows as code"}]}
\`\`\`

The page stays.`

function BlocksDemo() {
  const ctx = newBlockCtx('notes/preview.md')
  return (
    <div className="md-rich">
      {splitBlocks(MD).map((p, i) => (p.kind === 'md' ? <Markdown key={i} md={p.text} /> : <Fragment key={i}>{BLOCKS[p.kind](p.src, ctx)}</Fragment>))}
    </div>
  )
}

export default function VisualsPreview() {
  const [goal, setGoal] = useState<number | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  return (
    <div className="preview">
      <PageHeader icon="chart" title="Visuals preview" sub="Module B · synthetic data (alice, bob, carol · demo, solo)" />
      <div className="grid">
        <div className="c12" id="pv-journey">
          <Journey project={DEMO} next={NEXT_MS} onAct={(it) => toast('Would act on: ' + it.text, 'ok')} numbersId="pv-numbers" />
        </div>
        <div className="c6">
          <Journey project={WAIT} next={DECIDE} onAct={() => toast('Decide sheet opens', 'info')} />
        </div>
        <div className="c6">
          <Journey project={SOLO} next={null} />
        </div>
        <div className="c12">
          <Journey project={EMPTY} next={{ kind: 'checkin', id: 'pv:ci', text: 'Log one thing you did today' }} onAct={() => toast('Check in', 'info')} />
        </div>

        <div className="c12" id="pv-sm"><Explainer spec={SM} /></div>
        <div className="c12" id="pv-sm-long"><Explainer spec={SM_LONG} /></div>
        <div className="c12" id="pv-net"><Explainer spec={NET} /></div>
        <div className="c12" id="pv-map"><Explainer spec={MAP} /></div>
        <div className="c12" id="pv-flow"><Explainer spec={FLOW} /></div>
        <div className="c12" id="pv-compare"><Explainer spec={CMP} ctx={{ decide: DECIDE }} /></div>
        <div className="c6" id="pv-cards"><Explainer spec={CARDS} /></div>
        <div className="c6" id="pv-timeline"><Explainer spec={TIMELINE} /></div>

        <section className="w c12" id="pv-scatter">
          <Scatter
            options={OPTIONS}
            title="6 ways to earn: speed × how sure we are"
            pick={picked}
            onPick={(r) => {
              setPicked(r)
              toast('Picked #' + r, 'ok', { undo: () => setPicked(null) })
            }}
          />
        </section>
        <section className="w c12" id="pv-narrow" aria-label="Narrow column (Explain panel width)">
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ width: 300, maxWidth: '100%' }} id="pv-scatter-300"><Scatter options={OPTIONS} sub="300 px wide" /></div>
            <div style={{ width: 340, maxWidth: '100%', display: 'grid', gap: 12 }}>
              <Explainer spec={MAP} />
              <Explainer spec={CMP} />
            </div>
          </div>
        </section>

        <Widget id="pv-numbers" className="c7" title="Numbers" icon="chart">
          <GoalMeter
            value={881}
            label="followers"
            goal={goal}
            color={2}
            goalLabel="Follower goal"
            onSetGoal={(g) => {
              setGoal(g)
              toast('Goal set: ' + g.toLocaleString('en'), 'ok', { undo: () => setGoal(null) })
            }}
            note="1 read so far (14 Oct). A trend line appears after the next read."
            extra={[{ value: 27, label: 'profile views · 7 d' }, { value: 16, label: 'post impressions · 7 d' }, { value: 11, label: 'search appearances · 7 d' }]}
          />
        </Widget>
        <Widget id="pv-goal2" className="c5" title="Goal met" icon="target">
          <GoalMeter value={1240} label="followers" goal={1000} />
        </Widget>

        <Widget id="pv-week" className="c5" title="My week" icon="cal">
          <WeekDots counts={[0, 1, 0, 2, 3, null, null]} />
        </Widget>
        <Widget id="pv-heat" className="c7" title="Check-ins · 12 weeks" icon="cal">
          <Heatmap cells={HEAT} start="2026-07-26" sample />
        </Widget>

        <Widget id="pv-beads" className="c12" title="Beads" icon="projects">
          <div style={{ display: 'grid', gap: 10 }}>
            <Beads project={DEMO} count />
            <Beads project={WAIT} count />
            <Beads project={SOLO} lg count />
          </div>
        </Widget>

        <section className="w c12" id="pv-status" aria-label="Status board">
          <StatusBoard items={STATUS} />
          <div style={{ maxWidth: 340, marginTop: 12 }}>
            <StatusBoard items={STATUS} compact />
          </div>
        </section>

        <section className="w c12" id="pv-time"><Chart spec={TIME} /></section>
        {CHARTS.map((c, i) => (
          <section key={i} className="w c6" id={'pv-chart-' + i}><Chart spec={c} /></section>
        ))}

        <section className="w c12" id="pv-blocks" aria-label="Markdown blocks">
          <BlocksDemo />
        </section>
      </div>
    </div>
  )
}
