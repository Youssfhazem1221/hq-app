// One card on a project board: its title opens the note; stage chip, go-live day, next gate; linked notes as chips.
// The owner's pencil swaps the card for a small form (stage + date). Saving is the board's job (Board.tsx).
import { useState } from 'react'
import { Icon } from '../../lib/icons'
import { dayName, type BoardCard, type BoardConfig } from '../../lib/project-board'

const clean = (t: string) => t.replace(/^(Script|Video)\s+/i, '')

type Props = { c: BoardCard; cfg: BoardConfig; canEdit: boolean; onSave: (c: BoardCard, stage: string, date: string) => void }

export function BoardCardView({ c, cfg, canEdit, onSave }: Props) {
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState(c.stage)
  const [date, setDate] = useState(c.date || '')
  const last = cfg.stages[cfg.stages.length - 1]

  if (open)
    return (
      <form
        className="pb-card pb-form"
        onSubmit={(e) => {
          e.preventDefault()
          setOpen(false)
          onSave(c, stage, date)
        }}
      >
        <b className="pb-t">{clean(c.title)}</b>
        <label>
          <span>Stage</span>
          <select className="inp" value={stage} onChange={(e) => setStage(e.target.value)}>
            {cfg.stages.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Goes live</span>
          <input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div className="pb-btns">
          <button className="btn sm primary" type="submit">Save</button>
          <button className="btn sm ghost" type="button" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </form>
    )

  return (
    <article className={c.late ? 'pb-card late' : 'pb-card'}>
      <a className="pb-t" href={'#/docs/' + c.path} title={c.title}>{clean(c.title)}</a>
      <div className="pb-meta">
        <span className={c.stage === last ? 'chip ok' : 'chip'}>{c.stage || 'no stage'}</span>
        {c.date && <span className="pb-day"><Icon name="cal" size="s" />{dayName(c.date)}</span>}
      </div>
      {c.next && <p className={c.late ? 'pb-next late' : 'pb-next'}>{c.late ? 'Late' : 'Next'}: {c.next.stage} by {dayName(c.next.due)}</p>}
      <div className="pb-links">
        {c.links.map((l) => (
          <a key={l.path} className="chip line" href={'#/docs/' + l.path} title={l.title}>
            <Icon name="file" size="s" />
            {/\/script\.md$/i.test(l.path) ? 'Script' : clean(l.title).slice(0, 18)}
          </a>
        ))}
        {canEdit && (
          <button className="icon-btn pb-edit" type="button" aria-label={'Change stage or date: ' + clean(c.title)} onClick={() => setOpen(true)}>
            <Icon name="edit" size="s" />
          </button>
        )}
      </div>
    </article>
  )
}
