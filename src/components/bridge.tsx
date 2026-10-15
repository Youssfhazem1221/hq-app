import { useHQ } from '../App'
import { useBridge, type BridgeView } from '../lib/doorbell'

const LABEL: Record<BridgeView, string> = {
  online: 'Claude bridge online',
  working: 'Claude is working',
  offline: 'Claude bridge offline',
  checking: 'Checking Claude bridge',
}
const HINT: Record<BridgeView, string> = {
  online: 'Claude on the PC picks up posts flagged for Claude within seconds.',
  working: 'Claude is handling a flagged post right now.',
  offline: 'Flagged posts wait until Claude runs on the PC again.',
  checking: 'Listening for the bridge heartbeat (sent every minute).',
}

/** Small status chip for the local Claude bridge, from doorbell `bridge` events. */
export function BridgeChip() {
  const { bell } = useHQ()
  const { view } = useBridge(bell)
  const seen = bell?.bridge?.seen
  const title = HINT[view] + (seen ? ` Last heard ${new Date(seen).toLocaleTimeString()}.` : '')
  return (
    <span className={`bridge-chip is-${view}`} title={title} role="status">
      <span className="dot" aria-hidden="true" /> {LABEL[view]}
    </span>
  )
}
