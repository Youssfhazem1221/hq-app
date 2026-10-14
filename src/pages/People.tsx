import { useState } from 'react'
import { Hand, Link as LinkIcon, MapPin, Pencil, Target, Users } from 'lucide-react'
import { useHQ } from '../App'
import { Avatar, Badge, Card, Empty, Markdown } from '../components/ui'
import { saveProfile } from '../lib/hq'
import type { Doc } from '../lib/md'
import { same } from '../lib/util'

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : [])

export default function People() {
  const { model, me } = useHQ()
  const mine = model.people.find((p) => same(p.data.github, me.login))
  const [editing, setEditing] = useState(false)

  if (editing) return <ProfileForm doc={mine} onDone={() => setEditing(false)} />

  return (
    <>
      {!mine && (
        <Card icon={<Hand className="i" />} title="You don't have a profile yet">
          <button className="btn primary" onClick={() => setEditing(true)}>Create my profile</button>
        </Card>
      )}
      <div className="people">
        {model.people.map((p) => {
          const links = (p.data.links && typeof p.data.links === 'object' ? p.data.links : {}) as Record<string, string>
          const isMe = same(p.data.github, me.login)
          return (
            <Card key={p.path} className="person">
              <div className="person-h">
                <Avatar name={p.data.name || p.data.github} size={56} />
                <div>
                  <h3>
                    {p.data.name || p.data.github} {isMe && <Badge tone="accent">you</Badge>}
                  </h3>
                  {p.data.role && <div className="muted">{p.data.role}</div>}
                  {p.data.location && <div className="small muted meta-line"><MapPin className="i sm" /> {p.data.location}</div>}
                </div>
                {isMe && (
                  <button className="btn ghost sm push" onClick={() => setEditing(true)}><Pencil className="i sm" /> Edit</button>
                )}
              </div>
              {p.data.focus && <div className="callout tone-info"><Target className="i" /> <span>{p.data.focus}</span></div>}
              {list(p.data.skills).length > 0 && (
                <div className="chips">{list(p.data.skills).map((s) => <span key={s} className="chip static">{s}</span>)}</div>
              )}
              {Object.keys(links).length > 0 && (
                <div className="chips">
                  {Object.entries(links).map(([k, url]) => (
                    <a key={k} className="chip link" href={url} target="_blank" rel="noopener"><LinkIcon className="i sm" /> {k}</a>
                  ))}
                </div>
              )}
              {p.body.trim() && <Markdown md={p.body} base={p.path} />}
            </Card>
          )
        })}
      </div>
      {!model.people.length && <Empty icon={<Users className="i" />} text="No profiles yet." />}
    </>
  )
}

function ProfileForm({ doc, onDone }: { doc?: Doc; onDone: () => void }) {
  const { me, source, reload } = useHQ()
  const d = doc?.data || {}
  const links = (d.links && typeof d.links === 'object' ? d.links : {}) as Record<string, string>
  const [f, setF] = useState({
    name: d.name || me.name,
    role: d.role || '',
    location: d.location || '',
    focus: d.focus || '',
    skills: list(d.skills).join(', '),
    linkedin: links.linkedin || '',
    website: links.website || links.behance || '',
    bio: doc?.body.trim() || '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })

  const save = async () => {
    setBusy(true)
    try {
      const newLinks: Record<string, string> = { ...links }
      if (f.linkedin) newLinks.linkedin = f.linkedin
      if (f.website) newLinks.website = f.website
      await saveProfile(source, me, { ...d, name: f.name, role: f.role, location: f.location, focus: f.focus, skills: list(f.skills), links: newLinks }, f.bio)
      await reload()
      onDone()
    } catch (e: any) {
      alert(e?.message || e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card icon={<Pencil className="i" />} title="My profile">
      <div className="form">
        <label>Name<input value={f.name} onChange={set('name')} /></label>
        <label>Role<input value={f.role} onChange={set('role')} placeholder="What you do" /></label>
        <label>Location<input value={f.location} onChange={set('location')} /></label>
        <label>Focus right now<input value={f.focus} onChange={set('focus')} placeholder="One line" /></label>
        <label>Skills (comma separated)<input value={f.skills} onChange={set('skills')} /></label>
        <label>LinkedIn URL<input value={f.linkedin} onChange={set('linkedin')} /></label>
        <label>Website / portfolio<input value={f.website} onChange={set('website')} /></label>
        <label className="full">Short bio (bullets work best)<textarea rows={5} value={f.bio} onChange={set('bio')} /></label>
      </div>
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn ghost" onClick={onDone}>Cancel</button>
      </div>
    </Card>
  )
}
