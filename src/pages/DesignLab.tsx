import { useEffect, useRef, useState } from 'react'
import { Check, Compass, Hourglass, ListChecks, Moon, Bot, MessagesSquare, Sun, Target, Telescope, Monitor, RefreshCw } from 'lucide-react'
import { useHQ, type Theme } from '../App'
import { Badge, Card } from '../components/ui'
import { DESIGNS, type DesignId, type Direction } from '../designs'
import { NAV } from '../nav'
import { same } from '../lib/util'

const HomeIcon = NAV[0][1]

type Props = { design: DesignId; setDesign: (d: DesignId) => void; theme: Theme; setTheme: (t: Theme) => void }

export default function DesignLab({ design, setDesign, theme, setTheme }: Props) {
  const current = DESIGNS.find((d) => d.id === design)!
  return (
    <>
      <div className="hello">
        <h2>Pick a look</h2>
        <span className="muted">
          Live previews with your real data. Now using <b>{current.name}</b> · {theme} mode
        </span>
      </div>

      <Card icon={<Telescope className="i" />} title="Side by side">
        <div className="table-wrap">
          <table className="cmp">
            <thead>
              <tr><th>Look</th><th>Colours</th><th>Feels</th><th>Density</th><th>Best for</th><th>Arabic</th></tr>
            </thead>
            <tbody>
              {DESIGNS.map((d) => (
                <tr key={d.id} className={d.id === design ? 'rec' : ''}>
                  <td className="nowrap"><b>{d.name}</b></td>
                  <td><div className="swatches tiny" aria-hidden>{d.palette.map((c) => <span key={c} style={{ background: c }} />)}</div></td>
                  <td>{d.energy}</td>
                  <td>{d.density}</td>
                  <td>{d.bestFor}</td>
                  <td className="nowrap">{d.arabic.startsWith('✅') ? '✅' : '⚠️ fallback'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="lab-cards">
        {DESIGNS.map((d) => (
          <LookCard key={d.id} d={d} active={d.id === design} onUse={(t) => { setDesign(d.id); setTheme(t) }} />
        ))}
      </div>

      <Card icon={<RefreshCw className="i" />} title="Next round">
        <ul className="num-list">
          <li>Pick one, or mix: <i>"Metro layout with Kraft colours"</i></li>
          <li>Then say <b>bolder</b>, <b>quieter</b>, or <b>more like X</b>, and I make 2–3 variations of that one</li>
          <li>Your choice is saved in this browser only; your friend picks his own</li>
        </ul>
      </Card>
    </>
  )
}

function LookCard({ d, active, onUse }: { d: Direction; active: boolean; onUse: (t: Theme) => void }) {
  const [t, setT] = useState<Theme>(d.scene)
  return (
    <article className={'lab-card' + (active ? ' current' : '')}>
      <MiniApp design={d.id} theme={t} />
      <div className="row between wrap">
        <h3>{d.name}</h3>
        <div className="row">
          {d.tag && <Badge tone={d.tag.startsWith('Category') ? 'muted' : 'accent'}>{d.tag}</Badge>}
          <div className="seg" role="group" aria-label="Preview mode">
            <button className={t === 'light' ? 'on' : ''} onClick={() => setT('light')} title="Light"><Sun className="i sm" /></button>
            <button className={t === 'dark' ? 'on' : ''} onClick={() => setT('dark')} title="Dark"><Moon className="i sm" /></button>
          </div>
        </div>
      </div>
      <p>{d.thesis}</p>
      <div className="swatches" aria-hidden>
        {d.palette.map((c) => <span key={c} style={{ background: c }} />)}
      </div>
      <dl className="facts">
        <dt>From</dt><dd>{d.world}</dd>
        <dt>Type</dt><dd>{d.fonts} · {d.arabic}</dd>
        <dt>Risk</dt><dd>{d.risk}</dd>
      </dl>
      <div className="row">
        {active ? (
          <span className="pill"><Check className="i sm" /> In use</span>
        ) : (
          <button className="btn primary" onClick={() => onUse(t)}>Use this look ({t})</button>
        )}
      </div>
    </article>
  )
}

/** A scaled-down render of the real dashboard, using the real components and data. */
function MiniApp({ design, theme }: { design: DesignId; theme: Theme }) {
  const { model, me } = useHQ()
  const frame = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.4)
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(el.clientWidth / 1100))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const now = (Array.isArray(model.status?.data.now) ? model.status!.data.now : [])[0] || 'Pick a money direction'
  const mine = model.todos.filter((x) => x.data.status !== 'done' && same(x.data.owner, me.login)).slice(0, 3)
  const open = model.todos.filter((x) => x.data.status !== 'done').length
  const options: any[] = model.investigations.find((x) => Array.isArray(x.data.options))?.data.options || []

  return (
    <div className="mini-frame" ref={frame} style={{ height: Math.round(690 * scale) }} aria-hidden>
      <div className="mini-app" data-design={design} data-theme={theme} style={{ transform: `scale(${scale})` }}>
        <div className="shell">
          <nav className="nav">
            <div className="brand"><Compass className="i lg" /> <b>HQ</b></div>
            {NAV.slice(0, 7).map(([r, Icon, label], i) => (
              <div key={r} className={'nav-link' + (i === 0 ? ' on' : '')}>
                <span className="ico"><Icon className="i" /></span>
                <span className="lbl">{label}</span>
                {r === '/todos' && mine.length ? <span className="count">{mine.length}</span> : null}
              </div>
            ))}
          </nav>
          <main className="main">
            <header className="top">
              <h1><HomeIcon className="i" /> Dashboard</h1>
              <div className="top-actions">
                <span className="pill"><Monitor className="i sm" /> Local folder</span>
                <span className="btn ghost"><RefreshCw className="i" /> Refresh</span>
              </div>
            </header>
            <div className="page">
              <div className="grid two">
                <section className="card hero">
                  <div className="card-h"><h3><Target className="i" />Now</h3></div>
                  <ul className="big-list"><li>{now}</li></ul>
                </section>
                <section className="card">
                  <div className="card-h"><h3><Hourglass className="i" />Waiting on you</h3></div>
                  <ul className="check-list">
                    {mine.map((x) => (
                      <li key={x.path}><span className="tick"><Check className="i sm" /></span><span>{x.data.title}</span></li>
                    ))}
                  </ul>
                </section>
              </div>
              <div className="tiles">
                <div className="tile tone-ok"><span className="tile-ico"><ListChecks className="i" /></span><span className="tile-v">{open}</span><span className="tile-l">Open to-dos</span></div>
                <div className="tile tone-accent"><span className="tile-ico"><Bot className="i" /></span><span className="tile-v">0</span><span className="tile-l">Flagged for Claude</span></div>
                <div className="tile tone-info"><span className="tile-ico"><MessagesSquare className="i" /></span><span className="tile-v">{model.board.length}</span><span className="tile-l">Messages</span></div>
                <div className="tile tone-warn"><span className="tile-ico"><Telescope className="i" /></span><span className="tile-v">{model.investigations.length}</span><span className="tile-l">Investigations</span></div>
              </div>
              <section className="card">
                <table className="cmp">
                  <thead><tr><th>Option</th><th>Paid in</th><th>First money</th></tr></thead>
                  <tbody>
                    {options.slice(0, 3).map((o, i) => (
                      <tr key={i} className={o.recommended ? 'rec' : ''}>
                        <td>{o.name}</td>
                        <td><span className={'badge ' + (/USD/.test(o.paid_in) ? 'tone-ok' : 'tone-muted')}>{o.paid_in}</span></td>
                        <td>{o.first_money}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
