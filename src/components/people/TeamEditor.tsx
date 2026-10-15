// TeamEditor (module D, blueprint §8.13): the owner sets a project's members, their parts and "help wanted". Owner
// only: anyone else gets nothing (and people.ts refuses the write before any PUT). Save = one commit that changes only
// members, roles, help_wanted, updated and updated_by (setProjectTeam). Frozen props: <TeamEditor project />.
import { useMemo, useState } from 'react'
import { useHQ } from '../../lib/hq-context'
import { displayName } from '../../lib/hq'
import type { Doc } from '../../lib/md'
import { setProjectTeam, teamOf } from '../../lib/people'
import { LIMITS, cleanItem, isBot } from '../../lib/people-core'
import { Icon } from '../../lib/icons'
import { projectSlugOf } from '../shell/shell-core'
import { toast } from '../toast'
import { Avatar } from '../ui'

const same = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/

export type TeamEditorProps = { project: Doc; onDone?: () => void }

export default function TeamEditor({ project, onDone }: TeamEditorProps) {
  const { model, me, source, reload } = useHQ()
  const slug = projectSlugOf(project)
  const team = teamOf(project.data)
  const isOwner = same(team.owner, me.login)
  const [members, setMembers] = useState<string[]>(team.members)
  const [roles, setRoles] = useState<Record<string, string>>(() => ({ ...team.roles }))
  const [help, setHelp] = useState<string[]>(team.helpWanted)
  const [who, setWho] = useState('')
  const [part, setPart] = useState('')
  const [wish, setWish] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const known = useMemo(
    () => model.knownLogins.filter((l) => !isBot(l) && !same(l, team.owner) && !members.some((m) => same(m, l))),
    [model.knownLogins, team.owner, members],
  )
  if (!isOwner) return null

  const title = String(project.data.title || slug)
  const partOf = (l: string) => roles[l.toLowerCase()] || ''
  const setPartOf = (l: string, v: string) => setRoles((r) => ({ ...r, [l.toLowerCase()]: v.slice(0, LIMITS.part) }))
  const add = () => {
    const l = who.trim().replace(/^@/, '')
    setErr('')
    if (!l) return
    if (!LOGIN.test(l) || isBot(l)) return setErr(`"${l}" is not a GitHub login`)
    if (same(l, team.owner) || members.some((m) => same(m, l))) return setErr(`${displayName(model, l)} is already on the team`)
    if (members.length >= LIMITS.members) return setErr(`A project can have ${LIMITS.members} members at most`)
    const canon = model.knownLogins.find((x) => same(x, l)) || l
    setMembers((m) => [...m, canon])
    if (part.trim()) setPartOf(canon, part.trim())
    setWho('')
    setPart('')
  }
  const remove = (l: string) => {
    setMembers((m) => m.filter((x) => !same(x, l)))
    setRoles((r) => {
      const n = { ...r }
      delete n[l.toLowerCase()]
      return n
    })
  }
  const addHelp = () => {
    const h = cleanItem(wish, LIMITS.part)
    if (!h) return
    if (help.length >= LIMITS.helpWanted) return setErr(`At most ${LIMITS.helpWanted} "help wanted" items`)
    if (!help.includes(h)) setHelp((x) => [...x, h])
    setWish('')
  }
  const save = async () => {
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      const clean: Record<string, string> = {}
      for (const [k, v] of Object.entries(roles)) {
        const p = cleanItem(v, LIMITS.part)
        if (p) clean[k] = p
      }
      const written = await setProjectTeam(source, me, slug, { members, roles: clean, helpWanted: help }, model)
      toast(written ? `Team saved · ${title}` : 'No change to save', written ? 'ok' : 'info')
      if (written) await reload()
      onDone?.()
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="te">
      <div className="pp-h">
        <Icon name="users" />
        <h2 id="te-title">Team · {title}</h2>
        <span className="chip line" data-tipt="Only you, the owner, can change the team">
          <Icon name="lock" />
          only you
        </span>
      </div>
      <div className="te-rows" role="list">
        <div className="te-row" role="listitem">
          <Avatar name={displayName(model, team.owner)} />
          <b className="te-who">{displayName(model, team.owner)}</b>
          <label className="sr" htmlFor="te-part-owner">
            Your part
          </label>
          <input id="te-part-owner" className="inp sm" placeholder="your part (optional)" maxLength={LIMITS.part} value={partOf(team.owner)} onChange={(e) => setPartOf(team.owner, e.target.value)} />
          <span className="chip line" aria-label="owner">
            <Icon name="flag" />
            owner
          </span>
        </div>
        {members.map((m) => (
          <div className="te-row" role="listitem" key={m}>
            <Avatar name={displayName(model, m)} />
            <b className="te-who">{displayName(model, m)}</b>
            <label className="sr" htmlFor={'te-part-' + m}>
              Part for {displayName(model, m)}
            </label>
            <input id={'te-part-' + m} className="inp sm" placeholder="part, e.g. mobile app" maxLength={LIMITS.part} value={partOf(m)} onChange={(e) => setPartOf(m, e.target.value)} />
            <button className="icon-btn" type="button" aria-label={'Remove ' + displayName(model, m)} onClick={() => remove(m)}>
              <Icon name="x" />
            </button>
          </div>
        ))}
      </div>
      <div className="te-add">
        <label className="sr" htmlFor="te-who">
          GitHub login to add
        </label>
        <input id="te-who" className="inp sm" list="te-known" placeholder="Add a teammate (GitHub login)" value={who} onChange={(e) => setWho(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
        <datalist id="te-known">
          {known.map((l) => (
            <option key={l} value={l}>
              {displayName(model, l)}
            </option>
          ))}
        </datalist>
        <label className="sr" htmlFor="te-newpart">
          Their part
        </label>
        <input id="te-newpart" className="inp sm" placeholder="part (optional)" maxLength={LIMITS.part} value={part} onChange={(e) => setPart(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
        <button className="btn sm" type="button" onClick={add}>
          <Icon name="plus" size="s" />
          Add
        </button>
      </div>
      <div className="te-help">
        <span className="hint">Help wanted (max {LIMITS.helpWanted})</span>
        <div className="pp-chips">
          {help.map((h) => (
            <span key={h} className="chip line">
              {h}
              <button className="chip-x" type="button" aria-label={'Remove ' + h} onClick={() => setHelp((x) => x.filter((y) => y !== h))}>
                <Icon name="x" />
              </button>
            </span>
          ))}
          {help.length < LIMITS.helpWanted && (
            <span className="te-wish">
              <label className="sr" htmlFor="te-wish">
                Add a help wanted item
              </label>
              <input id="te-wish" className="inp sm" placeholder="e.g. Android build" maxLength={LIMITS.part} value={wish} onChange={(e) => setWish(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addHelp())} />
              <button className="btn ghost sm" type="button" onClick={addHelp}>
                Add
              </button>
            </span>
          )}
        </div>
      </div>
      {err && (
        <p className="pp-err" role="alert">
          <Icon name="alert" size="s" /> {err}
        </p>
      )}
      <div className="pp-foot">
        <span className="hint">Members see this project as theirs. Parts: no commas.</span>
        <span style={{ flex: 1 }} />
        {onDone && (
          <button className="btn ghost" type="button" onClick={onDone}>
            Cancel
          </button>
        )}
        <button className="btn primary" type="button" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
export { TeamEditor }
