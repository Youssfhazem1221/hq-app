// The doorbell: a raw Supabase Realtime websocket on one public topic (no supabase-js).
// Messages are hints only ("something was pushed", "the Claude bridge is online"):
// anyone with the publishable key could send one, so the app always re-checks GitHub itself.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_REF } from '../config'

export type PushHint = { sha?: string; by?: string; board?: boolean; todos?: boolean; ai?: boolean; md?: boolean }
export type BridgeState = 'online' | 'working' | 'done' | 'offline'
export type BridgeHint = { state: BridgeState; id?: string; at?: string | number }
export type BellStatus = 'off' | 'connecting' | 'live' | 'down'

const HEARTBEAT_MS = 25_000
const BACKOFF_S = [1, 2, 5, 10, 30]
const BRIDGE_STATES: BridgeState[] = ['online', 'working', 'done', 'offline']

export class Doorbell {
  status: BellStatus = 'off'
  /** Bumped on every status or bridge change (for useSyncExternalStore). */
  version = 0
  startedAt = 0
  liveSince = 0
  /** Last bridge message and when it arrived (local clock: the sender's clock is not trusted). */
  bridge: (BridgeHint & { seen: number }) | null = null
  /** Set while the bridge is running a job, cleared by done/offline. */
  working: { id?: string; since: number } | null = null

  private topic = ''
  private ws: WebSocket | null = null
  private ref = 0
  private joinRef = ''
  private beatRef = ''
  private beat: ReturnType<typeof setInterval> | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private retry = 0
  private stopped = true
  private subs = new Set<() => void>()
  private pushSubs = new Set<(p: PushHint) => void>()
  private bridgeSubs = new Set<(b: BridgeHint) => void>()

  constructor(private getTopic: () => Promise<string | null>) {}

  subscribe = (cb: () => void) => {
    this.subs.add(cb)
    return () => void this.subs.delete(cb)
  }
  onPush(cb: (p: PushHint) => void) {
    this.pushSubs.add(cb)
    return () => void this.pushSubs.delete(cb)
  }
  onBridge(cb: (b: BridgeHint) => void) {
    this.bridgeSubs.add(cb)
    return () => void this.bridgeSubs.delete(cb)
  }

  async start() {
    if (!this.stopped) return
    this.stopped = false
    this.startedAt = Date.now()
    document.addEventListener('visibilitychange', this.wake)
    addEventListener('online', this.wake)
    try {
      this.topic = (await this.getTopic()) || ''
    } catch {
      this.topic = ''
    }
    if (this.stopped) return
    if (!this.topic) return this.set('off')
    this.connect()
  }

  stop() {
    this.stopped = true
    document.removeEventListener('visibilitychange', this.wake)
    removeEventListener('online', this.wake)
    this.close()
    this.set('off')
  }

  private set(s: BellStatus) {
    if (s === 'live') this.liveSince = Date.now()
    this.status = s
    this.changed()
  }
  private changed() {
    this.version++
    this.subs.forEach((cb) => cb())
  }
  private nextRef() {
    return String(++this.ref)
  }
  private send(m: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m))
  }

  private connect() {
    if (this.stopped || !this.topic) return
    this.close()
    this.set('connecting')
    const url = `wss://${SUPABASE_REF}.supabase.co/realtime/v1/websocket?apikey=${encodeURIComponent(SUPABASE_PUBLISHABLE_KEY)}&vsn=1.0.0`
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      return this.down()
    }
    this.ws = ws
    ws.onopen = () => {
      this.joinRef = this.nextRef()
      this.send({
        topic: `realtime:${this.topic}`,
        event: 'phx_join',
        payload: { config: { broadcast: { self: false, ack: false }, presence: { enabled: false }, postgres_changes: [], private: false } },
        ref: this.joinRef,
        join_ref: this.joinRef,
      })
      this.beat = setInterval(() => this.heartbeat(), HEARTBEAT_MS)
    }
    ws.onmessage = (e) => this.message(e.data)
    ws.onclose = () => this.ws === ws && this.down()
  }

  /** Phoenix heartbeat; if the previous one never came back, the socket is dead. */
  private heartbeat() {
    if (this.beatRef) return this.down()
    this.beatRef = this.nextRef()
    this.send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: this.beatRef })
  }

  private message(raw: unknown) {
    let m: any
    try {
      m = JSON.parse(String(raw))
    } catch {
      return
    }
    if (m.topic === 'phoenix') {
      if (m.event === 'phx_reply' && m.ref === this.beatRef) this.beatRef = ''
      return
    }
    if (m.topic !== `realtime:${this.topic}`) return
    if (m.event === 'phx_reply' && m.ref === this.joinRef) {
      if (m.payload?.status === 'ok') {
        this.retry = 0
        this.set('live')
      } else this.down()
      return
    }
    if (m.event === 'phx_error' || m.event === 'phx_close') return this.down()
    if (m.event !== 'broadcast') return
    const b = m.payload || {}
    const p = b.payload && typeof b.payload === 'object' ? b.payload : {}
    if (b.event === 'push') {
      const hint: PushHint = {
        sha: typeof p.sha === 'string' && /^[0-9a-f]{40}$/.test(p.sha) ? p.sha : undefined,
        by: typeof p.by === 'string' ? p.by.slice(0, 60) : undefined,
        board: !!p.board, todos: !!p.todos, ai: !!p.ai, md: !!p.md,
      }
      this.pushSubs.forEach((cb) => cb(hint))
    } else if (b.event === 'bridge' && BRIDGE_STATES.includes(p.state)) {
      const hint: BridgeHint = { state: p.state, id: typeof p.id === 'string' ? p.id.slice(0, 80) : undefined, at: p.at }
      const now = Date.now()
      this.bridge = { ...hint, seen: now }
      if (hint.state === 'working') this.working = { id: hint.id, since: now }
      if (hint.state === 'done' || hint.state === 'offline') this.working = null
      this.bridgeSubs.forEach((cb) => cb(hint))
      this.changed()
    }
  }

  private down() {
    this.close()
    if (this.stopped) return
    this.set('down')
    const s = BACKOFF_S[Math.min(this.retry++, BACKOFF_S.length - 1)]
    this.timer = setTimeout(() => this.connect(), s * 1000)
  }

  private close() {
    clearInterval(this.beat)
    clearTimeout(this.timer)
    this.beatRef = ''
    const ws = this.ws
    this.ws = null
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = null
      try {
        ws.close()
      } catch { /* already closed */ }
    }
  }

  /** Back in view or back online: reconnect now, or probe a live socket (a heartbeat must return in 5 s). */
  private wake = () => {
    if (this.stopped || !this.topic || document.visibilityState !== 'visible') return
    if (this.status !== 'live') {
      this.retry = 0
      return this.connect()
    }
    if (this.beatRef) return this.down()
    this.heartbeat()
    const ref = this.beatRef
    setTimeout(() => this.beatRef === ref && ref && this.down(), 5000)
  }
}

export type BridgeView = 'online' | 'working' | 'offline' | 'checking'
const SEEN_MS = 3 * 60_000
const WORKING_MAX_MS = 20 * 60_000

/** What the "Claude bridge" chip should say right now. */
export function bridgeView(bell: Doorbell | null, now = Date.now()): BridgeView {
  const b = bell?.bridge
  if (b && b.state !== 'offline' && now - b.seen < SEEN_MS) {
    return bell!.working && now - bell!.working.since < WORKING_MAX_MS ? 'working' : 'online'
  }
  // The bridge says "online" every 60 s; give a fresh connection a moment before saying offline.
  if (!b && bell && bell.status !== 'off' && now - Math.max(bell.startedAt, bell.liveSince) < 70_000) return 'checking'
  return 'offline'
}

/** Re-renders on doorbell changes and every 20 s (so "last seen < 3 min" can expire). */
export function useBridge(bell: Doorbell | null) {
  useSyncExternalStore(bell ? bell.subscribe : noop, () => bell?.version ?? 0)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 20_000)
    return () => clearInterval(t)
  }, [])
  return { view: bridgeView(bell), bell }
}
const noop = () => () => {}
