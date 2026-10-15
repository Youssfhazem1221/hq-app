// Team card on a project page (module D, blueprint §8.10 + spec §6.3): owner + members with their part and a coarse
// "lately" activity mark (14 days, no counts), Claude when it worked here, and help wanted. Owner: Edit team (opens the
// TeamEditor). Others: Ask to join · I can help (on a help item) · members: Leave. Frozen props: <TeamCard project />.
import { useState } from 'react'
import { useHQ } from '../../lib/hq-context'
import { displayName } from '../../lib/hq'
import type { Doc } from '../../lib/md'
import { requestJoin, requestLeave, teamOf } from '../../lib/people'
import { isBot, membersOf, teamMatrix } from '../../lib/people-core'
import { Icon } from '../../lib/icons'
import type { MenuEntry } from '../shell/Popover'
import { projectSlugOf } from '../shell/shell-core'
import { toast } from '../toast'
import { Avatar, Widget } from '../ui'
import { TeamEditor } from './TeamEditor'
import { Sheet } from './Sheet'

export type TeamCardProps = { project: Doc; menu?: MenuEntry[] }

const same = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
const DOTS = ['', '●', '●●', '●●●']
const DOT_WORD = ['none lately', 'some activity lately', 'steady activity lately', 'busy lately']

export default function TeamCard({ project, menu }: TeamCardProps) {
  const { model, me, source, reload } = useHQ()
  const slug = projectSlugOf(project)
  const team = teamOf(project.data)
  const members = membersOf(slug, model.all)
  const isOwner = same(team.owner, me.login)
  const isMember = !isOwner && team.members.some((m) => same(m, me.login))
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  let cells: Record<string, { dots: 0 | 1 | 2 | 3 }> = {}
  try {
    cells = teamMatrix(model.events, model.roster, model.all, 14, new Date().toISOString()).cells[slug] || {}
  } catch {
    /* a bad file never breaks the card */
  }
  const dotsOf = (login: string) => {
    const k = Object.keys(cells).find((x) => same(x, login))
    return k ? cells[k].dots : 0
  }
  const claudeDots = dotsOf('claude')
  // a join request I already sent (open, to the owner, about this project)
  const pending = model.board.some(
    (d) => same(d.data.author, me.login) && same(d.data.request, 'join') && same(d.data.project, slug) && String(d.data.status || 'open') !== 'done',
  )

  const run = async (what: string, fn: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      toast(what, 'ok')
      await reload()
    } catch (e: any) {
      toast(String(e?.message || e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const owner = String(team.owner || '')
  const ownerName = owner ? displayName(model, owner) : 'the owner'
  const join = (part?: string) =>
    run(part ? `Asked ${ownerName}: you can help with ${part}` : `Asked ${ownerName} to join`, () => requestJoin(source, me, model, { project: slug, part }))
  const leave = () => run(`Asked ${ownerName} to take you off this project`, () => requestLeave(source, me, model, { project: slug }))

  let act = null
  if (isOwner)
    act = (
      <button className="btn sm" type="button" onClick={() => setEditing(true)} disabled={busy}>
        <Icon name="users" size="s" />
        Edit team
      </button>
    )
  else if (!isMember && owner && !isBot(me.login))
    act = pending ? (
      <span className="chip line" data-tipt={`Waiting on ${ownerName}`}>
        <Icon name="clock" />
        Asked to join
      </span>
    ) : (
      <button className="btn sm" type="button" onClick={() => join()} disabled={busy}>
        <Icon name="plus" size="s" />
        Ask to join
      </button>
    )
  const items: MenuEntry[] = [...(menu || [])]
  if (isMember) items.unshift({ label: 'Leave this project', icon: 'logout', run: leave })

  return (
    <Widget id="team" title="Team" icon="users" count={members.length || null} act={act} menu={items.length ? items : undefined} className="team-card">
      <div className="rows" role="list">
        {members.map((m) => {
          const d = dotsOf(m.login)
          const name = displayName(model, m.login)
          const person = model.roster.find((p) => same(p.login, m.login))
          return (
            <div className="row tm-row" role="listitem" key={m.login}>
              <Avatar name={name} />
              <a className="t" href={'#/people/' + (person?.slug || m.login.toLowerCase())}>
                {name}
                {same(m.login, me.login) && <span className="muted"> · you</span>}
              </a>
              <span className="meta">
                <span className="chip line">
                  <Icon name={m.role === 'owner' ? 'flag' : 'users'} />
                  {m.part || (m.role === 'owner' ? 'owner' : 'member')}
                </span>
                <span className="adots" data-tipt={DOT_WORD[d]} aria-label={DOT_WORD[d]}>
                  {DOTS[d] || '·'}
                </span>
              </span>
            </div>
          )
        })}
        {claudeDots > 0 && (
          <div className="row tm-row" role="listitem">
            <Avatar name="Claude" bot />
            <span className="t">
              Claude <span className="muted">· helper</span>
            </span>
            <span className="meta">
              <span className="adots" data-tipt={DOT_WORD[claudeDots]} aria-label={DOT_WORD[claudeDots]}>
                {DOTS[claudeDots]}
              </span>
            </span>
          </div>
        )}
      </div>
      {team.helpWanted.length > 0 && (
        <div className="tm-help">
          <span className="hint">Help wanted</span>
          <div className="pp-chips">
            {team.helpWanted.map((h) =>
              !isOwner && !isMember && owner ? (
                <button key={h} className="chip line" type="button" disabled={busy || pending} onClick={() => join(h)} data-tipt={`Tell ${ownerName} you can help`}>
                  <Icon name="users" />
                  {h} · I can help
                </button>
              ) : (
                <span key={h} className="chip line">
                  {h}
                </span>
              ),
            )}
          </div>
        </div>
      )}
      {editing && <TeamEditorSheet project={project} onClose={() => setEditing(false)} />}
    </Widget>
  )
}
export { TeamCard }

/** The editor as a sheet (modal on desktop, bottom sheet on phones). */
function TeamEditorSheet({ project, onClose }: { project: Doc; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} labelledBy="te-title" wide>
      <TeamEditor project={project} onDone={onClose} />
    </Sheet>
  )
}
