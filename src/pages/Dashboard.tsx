import { useEffect, useState } from 'react'
import { ArrowRight, Bot, Check, Coins, Eye, FolderKanban, History, Hourglass, Inbox, ListChecks, MessagesSquare, PartyPopper, Pin, Star, Target, Telescope, Users } from 'lucide-react'
import { ProjectCard } from './Projects'
import { useHQ } from '../App'
import { Ago, Avatar, Badge, Card, Empty, Tile, toneOf } from '../components/ui'
import { patchDoc } from '../lib/hq'
import { title } from '../lib/md'
import type { Commit } from '../lib/source'
import { firstName, same } from '../lib/util'

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : [])

export default function Dashboard() {
  const { model, me, source, reload, loadedAt } = useHQ()
  const st = model.status?.data || {}
  const mine = model.todos.filter((t) => t.data.status !== 'done' && same(t.data.owner, me.login))
  const openTodos = model.todos.filter((t) => t.data.status !== 'done')
  const forClaude = model.board.filter((b) => b.data.for_claude && b.data.status !== 'done')
  const weekAgo = Date.now() - 7 * 864e5
  const newMsgs = model.board.filter((b) => Date.parse(b.data.created) > weekAgo)
  const activeInv = model.investigations.filter((d) => d.data.status !== 'done')
  const kpis = model.linkedin?.data.kpis || {}
  const optionsDoc = model.investigations.find((d) => Array.isArray(d.data.options))
  const options: any[] = optionsDoc?.data.options || []

  const [acts, setActs] = useState<Commit[] | null>(null)
  useEffect(() => {
    source.activity().then(setActs).catch(() => setActs([]))
  }, [source, loadedAt])

  const done = async (path: string) => {
    const d = model.byPath.get(path)
    if (!d) return
    await patchDoc(source, d, { status: 'done' }, `todo: done · ${String(d.data.title).slice(0, 50)}`)
    await reload()
  }

  return (
    <>
      <div className="hello">
        <h2>Hi {firstName(me.name)}</h2>
        <span className="muted">Everything at a glance{st.updated ? ` · status updated ${st.updated}` : ''}</span>
      </div>

      <div className="grid two">
        <Card icon={<Target className="i" />} title="Now" className="hero">
          {list(st.now).length ? (
            <ul className="big-list">{list(st.now).map((x) => <li key={x}>{x}</li>)}</ul>
          ) : (
            <Empty icon={<Target className="i" />} text="Nothing urgent. Claude fills this from status.md." />
          )}
        </Card>
        <Card icon={<Hourglass className="i" />} title="Waiting on you" extra={<a href="#/todos" className="small">All to-dos</a>}>
          {mine.length ? (
            <ul className="check-list">
              {mine.slice(0, 6).map((t) => (
                <li key={t.path}>
                  <button className="tick" title="Mark done" aria-label={`Mark done: ${t.data.title}`} onClick={() => done(t.path)}>
                    <Check className="i sm" />
                  </button>
                  <span>{t.data.title}</span>
                  {t.data.link && <a className="small" href={'#/docs/' + t.data.link}>open</a>}
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={<PartyPopper className="i" />} text="Nothing waiting on you." />
          )}
        </Card>
      </div>

      {model.projects.length > 0 && (
        <Card icon={<FolderKanban className="i" />} title="Projects" extra={<a className="small" href="#/projects">All projects</a>}>
          <div className="proj-grid">
            {model.projects.slice(0, 4).map((p) => <ProjectCard key={p.path} p={p} compact />)}
          </div>
        </Card>
      )}

      <div className="tiles">
        <Tile icon={<ListChecks className="i" />} label="Open to-dos" value={openTodos.length} tone="ok" href="#/todos" />
        <Tile icon={<Bot className="i" />} label="Flagged for Claude" value={forClaude.length} tone="accent" href="#/board" />
        <Tile icon={<MessagesSquare className="i" />} label="Messages (7 days)" value={newMsgs.length} tone="info" href="#/board" />
        <Tile icon={<Telescope className="i" />} label="Active investigations" value={activeInv.length} tone="warn" href="#/docs" />
        {kpis.followers != null && <Tile icon={<Users className="i" />} label="LinkedIn followers" value={kpis.followers} tone="info" href="#/docs/linkedin/generallinkedin.md" />}
        {kpis.profile_views_7d != null && <Tile icon={<Eye className="i" />} label="Profile views (7d)" value={kpis.profile_views_7d} tone="muted" href="#/docs/linkedin/generallinkedin.md" />}
      </div>

      {options.length > 0 && (
        <Card icon={<Coins className="i" />} title="Money options, side by side" extra={optionsDoc && <a className="small" href={'#/docs/' + optionsDoc.path}>Details</a>}>
          <div className="table-wrap">
            <table className="cmp">
              <thead>
                <tr><th>#</th><th>Option</th><th>Paid in</th><th>First money</th><th>Evidence</th></tr>
              </thead>
              <tbody>
                {options.map((o, i) => (
                  <tr key={i} className={o.recommended ? 'rec' : ''}>
                    <td>{i + 1}</td>
                    <td>{o.recommended && <Badge tone="ok"><Star className="i" /> pick</Badge>} {o.name}</td>
                    <td><Badge tone={/USD/.test(o.paid_in) ? 'ok' : 'muted'}>{o.paid_in}</Badge></td>
                    <td>{o.first_money}</td>
                    <td className="small">{o.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card icon={<Telescope className="i" />} title="Investigations & hubs">
        <div className="cards">
          {[...model.investigations, ...(model.linkedin ? [model.linkedin] : [])].map((d) => (
            <a key={d.path} className="mini" href={'#/docs/' + d.path}>
              <div className="mini-h">
                <b>{title(d)}</b>
                {d.data.status && <Badge tone={toneOf(d.data.status)}>{d.data.status}</Badge>}
              </div>
              {d.data.summary && <p>{d.data.summary}</p>}
              {d.data.next && <p className="next"><ArrowRight className="i sm" /> {d.data.next}</p>}
              {d.data.updated && <span className="muted small">updated {String(d.data.updated)}</span>}
            </a>
          ))}
        </div>
      </Card>

      <div className="grid two">
        <Card icon={<Pin className="i" />} title="Next up">
          {list(st.next).length ? <ol className="num-list">{list(st.next).map((x) => <li key={x}>{x}</li>)}</ol> : <Empty icon={<Pin className="i" />} text="No next steps listed." />}
        </Card>
        <Card icon={<History className="i" />} title="Recent changes">
          {acts === null ? (
            <span className="muted">Loading…</span>
          ) : acts.length ? (
            <ul className="feed">
              {acts.slice(0, 8).map((c) => (
                <li key={c.sha}>
                  <Avatar name={c.author} src={c.avatar} size={22} />
                  <span className="feed-msg">{c.message}</span>
                  <Ago iso={c.date} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={<Inbox className="i" />} text="No history yet. It appears once the repo is on GitHub." />
          )}
        </Card>
      </div>
    </>
  )
}
