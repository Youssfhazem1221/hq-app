// The Claude bridge chip (module C2). Neutral "Claude bridge" until the first heartbeat (no "Checking…" phase), then
// online / working / offline from the doorbell's `bridge` events (read-core bridgeChipView). Icon + word, never colour
// alone; the detail sits in the tooltip.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useHQMaybe } from '../lib/hq-context'
import { Icon } from '../lib/icons'
import { bridgeChipView, type BridgeChipView } from '../lib/read-core'
import type { Doorbell } from '../lib/doorbell'

const WORD: Record<BridgeChipView, string> = {
  neutral: 'Claude bridge',
  online: 'Claude bridge · online',
  working: 'Claude is working',
  offline: 'Claude bridge · offline',
}
const TIP: Record<BridgeChipView, string> = {
  neutral: 'Claude on the PC picks up posts flagged for Claude when the bridge runs. Not heard from it yet.',
  online: 'Claude on the PC picks up posts flagged for Claude within seconds.',
  working: 'Claude is handling a flagged post right now.',
  offline: 'Flagged posts wait until Claude runs on the PC again.',
}
const TONE: Record<BridgeChipView, string> = { neutral: 'line', online: 'ok', working: 'acc', offline: '' }

const noop = () => () => {}

/** Re-renders on doorbell changes and every 20 s (so "heard < 3 min ago" can expire). */
export function useBridgeView(bell: Doorbell | null | undefined): BridgeChipView {
  useSyncExternalStore(bell ? bell.subscribe : noop, () => bell?.version ?? 0, () => 0)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000)
    return () => clearInterval(t)
  }, [])
  return bridgeChipView(bell, Math.max(now, Date.now()))
}

/** `<BridgeChip/>`: the bridge's state as a chip (spec C2). */
export function BridgeChip({ className }: { className?: string }) {
  const bell = useHQMaybe()?.bell ?? null
  const view = useBridgeView(bell)
  const seen = bell?.bridge?.seen
  const tip = TIP[view] + (seen && view !== 'neutral' ? ` Last heard ${new Date(seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : '')
  return (
    <span className={'chip bridge-chip is-' + view + (TONE[view] ? ' ' + TONE[view] : '') + (className ? ' ' + className : '')} data-tipt={tip} role="status">
      <Icon name={view === 'working' ? 'loader' : 'bot'} className={view === 'working' ? 'spin' : undefined} />
      {WORD[view]}
    </span>
  )
}
