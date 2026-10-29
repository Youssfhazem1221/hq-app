// Settings → AI keys (BYOK): 3 slots per person. Free 1 ⇄ Free 2 take turns, then Paid (under a monthly cap).
// People without keys use the owner's free keys. Keys are sent once to the keys endpoint and never shown again.
import { useEffect, useState } from 'react'
import { Icon } from '../lib/icons'
import type { IconName } from '../lib/contracts'
import { callKeys, tokens, usd, type KeySlot, type KeysSummary } from '../lib/keys'

type Caller = { kind: string; auth?: { token: string } } | null
const SLOTS: { slot: 1 | 2 | 3; name: string; icon: IconName; hint: string }[] = [
  { slot: 1, name: 'Free key 1', icon: 'zap', hint: 'Used first, taking turns with free key 2' },
  { slot: 2, name: 'Free key 2', icon: 'zap', hint: 'From a different Google project than key 1' },
  { slot: 3, name: 'Paid key', icon: 'coins', hint: 'Only when both free keys are used up, and for Deep mode' },
]

const timeLeft = (iso: string | null) => {
  if (!iso) return ''
  const m = Math.max(1, Math.round((Date.parse(iso) - Date.now()) / 60_000))
  return m >= 90 ? `${Math.round(m / 60)} h` : `${m} min`
}

function StatusChip({ s }: { s?: KeySlot }) {
  if (!s) return <span className="chip">Empty</span>
  if (s.status === 'bad') return <span className="chip bad"><Icon name="alert" /> Rejected by Google</span>
  if (s.status === 'resting') return <span className="chip warn"><Icon name="history" /> Used up · back in {timeLeft(s.rest_until)}</span>
  return <span className="chip ok"><Icon name="ok" /> Working</span>
}

export function AiKeys({ source }: { source: Caller }) {
  const [data, setData] = useState<KeysSummary | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<number | 'cap' | null>(null)
  const [draft, setDraft] = useState<Record<number, string>>({})
  const [cap, setCap] = useState('')

  const run = async (body: Record<string, unknown>, which: number | 'cap' | null = null) => {
    setBusy(which)
    const r = await callKeys(source, body)
    setBusy(null)
    if (r.ok) {
      setData(r.data)
      setErr('')
      const paid = r.data.slots.find((s) => s.slot === 3)
      setCap(paid ? String(paid.cap_usd) : '')
      return true
    }
    setErr(r.error)
    return false
  }
  useEffect(() => {
    void run({ action: 'list' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.kind, source?.auth?.token])

  const save = async (slot: number) => {
    const key = (draft[slot] || '').trim()
    if (!key) return
    if (await run({ action: 'set', slot, key }, slot)) setDraft((d) => ({ ...d, [slot]: '' }))
  }
  const paid = data?.slots.find((s) => s.slot === 3)
  const spent = data?.usage['3']?.cost_usd || 0
  const capUsd = paid?.cap_usd ?? 5
  const pct = capUsd > 0 ? Math.min(100, Math.round((spent / capUsd) * 100)) : 0

  return (
    <div className="keys">
      {err && <div className="callout bad" role="alert"><Icon name="alert" /> {err}</div>}
      {data?.uses_owner_free_keys && (
        <div className="callout"><Icon name="info" /> No keys yet: your AI uses the Pinwheel owner's <b>free</b> keys. Add your own below.</div>
      )}

      {/* paid spend vs cap: the one number that costs money */}
      <div className="keys-spend" aria-label={`Paid key this month: ${usd(spent)} of ${usd(capUsd)}`}>
        <div className="keys-spend-h">
          <Icon name="coins" />
          <b>{usd(spent)}</b>
          <span>of {usd(capUsd)} cap · {data?.month || 'this month'}</span>
        </div>
        <progress className={'keys-meter' + (pct >= 90 ? ' hot' : '')} max={100} value={pct} aria-hidden="true" />
      </div>

      <div className="keys-grid">
        {SLOTS.map(({ slot, name, icon, hint }) => {
          const s = data?.slots.find((x) => x.slot === slot)
          const u = data?.usage[String(slot) as '1' | '2' | '3']
          return (
            <div className="keys-card" key={slot}>
              <div className="keys-card-h">
                <Icon name={icon} />
                <b>{name}</b>
                <StatusChip s={s} />
              </div>
              <span className="keys-hint">{hint}</span>
              {s && (
                <div className="keys-stats">
                  <span title="Last 4 characters">•••• {s.last4}</span>
                  <span>{u?.requests || 0} calls</span>
                  <span>{tokens((u?.in_tokens || 0) + (u?.out_tokens || 0))} tokens</span>
                  {slot === 3 && <span>{usd(u?.cost_usd || 0)}</span>}
                </div>
              )}
              <form className="keys-form" onSubmit={(e) => { e.preventDefault(); void save(slot) }}>
                <label className="sr-only" htmlFor={`key-${slot}`}>{name}</label>
                <input
                  id={`key-${slot}`}
                  className="inp"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={s ? 'Replace key…' : 'Paste a Gemini API key'}
                  value={draft[slot] || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [slot]: e.target.value }))}
                />
                <button className="btn primary sm" type="submit" disabled={busy !== null || !(draft[slot] || '').trim()}>
                  {busy === slot ? 'Checking…' : 'Save'}
                </button>
                {s && (
                  <button className="btn ghost sm" type="button" disabled={busy !== null} onClick={() => void run({ action: 'remove', slot }, slot)}>
                    Remove
                  </button>
                )}
              </form>
            </div>
          )
        })}
      </div>

      {paid && (
        <form className="keys-cap" onSubmit={(e) => { e.preventDefault(); void run({ action: 'cap', cap_usd: Number(cap) }, 'cap') }}>
          <label htmlFor="key-cap"><b>Monthly cap for the paid key</b><span>The paid key stops at this amount until next month</span></label>
          <span className="keys-cap-in">$<input id="key-cap" className="inp" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ''))} /></span>
          <button className="btn sm" type="submit" disabled={busy !== null}>{busy === 'cap' ? 'Saving…' : 'Set cap'}</button>
        </form>
      )}

      <ul className="keys-notes">
        <li><Icon name="lock" /> Keys are encrypted on the server and never shown again; only the last 4 characters.</li>
        <li><Icon name="info" /> Free limits are per Google <b>project</b>: make the 2 free keys in 2 different projects.</li>
        <li><Icon name="eye" /> On free keys Google may read your questions to improve its products. Avoid sending private details.</li>
        {data && data.borrowed_by_others > 0 && <li><Icon name="users" /> Teammates without keys used your free keys {data.borrowed_by_others}× this month.</li>}
      </ul>
    </div>
  )
}
