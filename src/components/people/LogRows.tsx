// A person's log rows, grouped by day, newest first (module D, blueprint §8.5 + spec §6.4). Own page: edit on rows up to
// 7 days old (fix the text or kind, or remove the row; one commit each). Everyone else sees the rows read-only.
import { useState } from 'react'
import { useHQ } from '../../lib/hq-context'
import type { Model } from '../../lib/hq'
import { editLogRow, removeLogRow } from '../../lib/people'
import { entryLogPath, entryMinutes, type Entry, type LogConfig } from '../../lib/people-core'
import { Icon } from '../../lib/icons'
import { colorSlot, projectSlugOf } from '../shell/shell-core'
import { toast } from '../toast'
import { canEditRow, dayLabel, fmtMinutes, kindIcon, kindLabel, logDays, rowTime, scaleField } from './people-ui-core'

type Props = { entries: Entry[]; cfg: LogConfig; slug: string; mine: boolean; today: string; yesterday: string }

const textOf = (e: Entry, cfg: LogConfig) => {
  const f = cfg.fields.find((x) => x.type === 'text' && typeof e.fields?.[x.key] === 'string' && String(e.fields[x.key]).trim())
  return f ? String(e.fields[f.key]) : kindLabel(e.kind)
}

export function LogRows({ entries, cfg, slug, mine, today, yesterday }: Props) {
  const { model } = useHQ()
  const [more, setMore] = useState(false)
  const days = logDays(entries, more ? 400 : 7)
  const total = logDays(entries, 400).length
  return (
    <div className="log">
      {days.map((d) => (
        <div className="logday" key={d.date}>
          <h3>{d.date === today ? `Today · ${dayLabel(d.date)}` : d.date === yesterday ? `Yesterday · ${dayLabel(d.date)}` : dayLabel(d.date)}</h3>
          {d.rows.map((r) => (
            <LogRow key={r.when + r.line} e={r} cfg={cfg} slug={slug} mine={mine} model={model} />
          ))}
        </div>
      ))}
      {total > days.length && (
        <button className="more" type="button" onClick={() => setMore(true)}>
          Show {total - days.length} older day{total - days.length === 1 ? '' : 's'}
        </button>
      )}
    </div>
  )
}

function LogRow({ e, cfg, slug, mine, model }: { e: Entry; cfg: LogConfig; slug: string; mine: boolean; model: Model }) {
  const { source, me, reload } = useHQ()
  const [edit, setEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const textField = cfg.fields.find((x) => x.type === 'text')
  const [text, setText] = useState(textOf(e, cfg))
  const [kind, setKind] = useState(e.kind)
  const p = e.project ? model.projects.find((d) => projectSlugOf(d) === e.project) : undefined
  const min = entryMinutes(e.fields, cfg)
  const sc = scaleField(cfg)
  const scv = sc ? e.fields?.[sc.key] : undefined
  const bits = [
    p ? String(p.data.title || e.project) : e.project,
    min ? fmtMinutes(min) : '',
    sc && typeof scv === 'number' ? `${sc.label.toLowerCase()} ${scv}/${sc.max || 5}` : '',
    ...(e.ref || []).filter((r) => r.startsWith('@') || /^via /i.test(r)),
  ].filter(Boolean)
  const editable = mine && canEditRow(e, new Date().toISOString())
  const path = entryLogPath(slug, e)
  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      const fields = { ...e.fields }
      if (textField) fields[textField.key] = text.trim()
      const ok = await editLogRow(source, me, path, e.when, { kind, fields }, cfg)
      toast(ok ? 'Row fixed' : 'No change', ok ? 'ok' : 'info')
      setEdit(false)
      if (ok) await reload()
    } catch (x: any) {
      toast(String(x?.message || x), 'error')
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (busy) return
    setBusy(true)
    try {
      await removeLogRow(source, me, path, e.when, cfg)
      toast('Row removed', 'ok')
      await reload()
    } catch (x: any) {
      toast(String(x?.message || x), 'error')
    } finally {
      setBusy(false)
    }
  }
  if (edit)
    return (
      <div className="lrow editing">
        <span className="tm">{rowTime(e.when)}</span>
        <label className="sr" htmlFor={'lk-' + e.when}>
          Kind
        </label>
        <select id={'lk-' + e.when} className="inp sm" value={kind} onChange={(x) => setKind(x.target.value)}>
          {[...new Set([e.kind, ...cfg.kinds])].map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
        <label className="sr" htmlFor={'lt-' + e.when}>
          Text
        </label>
        <input id={'lt-' + e.when} className="inp sm" value={text} maxLength={280} onChange={(x) => setText(x.target.value)} onKeyDown={(x) => x.key === 'Enter' && save()} autoFocus />
        <span className="lr-acts">
          <button className="btn primary sm" type="button" onClick={save} disabled={busy || !text.trim()}>
            Save
          </button>
          <button className="btn ghost sm" type="button" onClick={remove} disabled={busy}>
            Remove
          </button>
          <button className="btn ghost sm" type="button" onClick={() => setEdit(false)}>
            Cancel
          </button>
        </span>
      </div>
    )
  return (
    <div className="lrow">
      <span className="tm">{rowTime(e.when)}</span>
      <span className={'kind k-' + e.kind} role="img" aria-label={kindLabel(e.kind)}>
        <Icon name={kindIcon(e.kind)} />
      </span>
      <span className="lr-t">
        <b>{textOf(e, cfg)}</b>
        {bits.length > 0 && (
          <span className="hint">
            {' · '}
            {p && <i className={'pdot pc' + colorSlot(p.data.color)} aria-hidden="true" />}
            {bits.join(' · ')}
          </span>
        )}
      </span>
      {editable ? (
        <button className="icon-btn" type="button" aria-label={'Fix this row: ' + textOf(e, cfg)} onClick={() => setEdit(true)}>
          <Icon name="type" size="s" />
        </button>
      ) : (
        <span className="hint lr-k">{kindLabel(e.kind)}</span>
      )}
    </div>
  )
}
