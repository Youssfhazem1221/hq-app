// Settings → AI keys: talks to the `keys` edge function (GitHub mode, with the person's own GitHub token) or the dev
// server's POST /__hq/keys (local mode). Keys go up once and never come back: only kind, last 4, status and usage.
import { SUPABASE_URL } from '../config'

export const KEYS_URL = `${SUPABASE_URL}/functions/v1/keys?forceFunctionRegion=eu-west-1`

export type KeySlot = {
  slot: 1 | 2 | 3
  kind: 'free' | 'paid'
  last4: string
  cap_usd: number
  status: 'ok' | 'resting' | 'bad'
  rest_until: string | null
  last_used: string | null
}
export type SlotUsage = { requests: number; in_tokens: number; out_tokens: number; cost_usd: number }
export type KeysSummary = {
  login: string
  slots: KeySlot[]
  usage: Record<'1' | '2' | '3', SlotUsage>
  month: string
  borrowed_by_others: number
  uses_owner_free_keys: boolean
}
export type KeysReply = { ok: true; data: KeysSummary } | { ok: false; error: string; code?: string }

type Caller = { kind: string; auth?: { token: string } } | null

/** One call to the keys endpoint. Never throws. */
export async function callKeys(source: Caller, body: Record<string, unknown>): Promise<KeysReply> {
  if (!source) return { ok: false, error: 'Not connected', code: 'offline' }
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  let url = '/__hq/keys'
  if (source.kind === 'github') {
    if (!source.auth?.token) return { ok: false, error: 'Not connected', code: 'offline' }
    url = KEYS_URL
    headers['x-github-token'] = source.auth.token
  } else if (source.kind !== 'local') return { ok: false, error: 'Not connected', code: 'offline' }
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
    const j = (await r.json().catch(() => null)) as Record<string, unknown> | null
    if (r.ok && j && Array.isArray(j.slots)) return { ok: true, data: j as unknown as KeysSummary }
    return { ok: false, error: typeof j?.error === 'string' ? j.error.slice(0, 160) : `AI keys ${r.status}`, code: typeof j?.code === 'string' ? j.code : undefined }
  } catch {
    return { ok: false, error: 'Could not reach the AI keys service', code: 'network' }
  }
}

export const usd = (n: number) => (n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`)
export const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n))
