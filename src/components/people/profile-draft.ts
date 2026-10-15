// The onboarding "profile-draft" call (module D → module E2's shared handler, action 'profile-draft'). Local dev: the
// dev server's POST /__hq/ui-tweak (same origin). GitHub mode: the `ui-tweak` edge function with the person's own
// token in x-github-token (never in the URL). Nothing is saved by this call; the answer is a draft the person reviews,
// cleaned again here (cleanDraft) because model output is never trusted.
import { SUPABASE_URL } from '../../config'
import { GitHubSource, type Source } from '../../lib/source'
import { cleanDraft, type ProfileDraft } from './people-ui-core'

/** The edge function that serves Adjust look and the profile draft (E2). */
export const UI_TWEAK_URL = `${SUPABASE_URL}/functions/v1/ui-tweak`

export type DraftResult =
  | { ok: true; draft: ProfileDraft; dropped: string[] }
  | { ok: false; status: number; error: string; manual: boolean }

const MANUAL = new Set([401, 403, 404, 405, 501, 503])

/** Ask the AI for a profile draft. `manual` = the AI can't help here (not set up, not allowed): fill it in by hand. */
export async function requestProfileDraft(source: Source, intake: string, known: string[], opts: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<DraftResult> {
  const net = opts.fetch || ((...a: Parameters<typeof fetch>) => fetch(...a))
  const body = JSON.stringify({ action: 'profile-draft', intake, known_projects: known.slice(0, 40).map((k) => String(k).slice(0, 80)) })
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  let url = '/__hq/ui-tweak'
  if (source instanceof GitHubSource) {
    url = UI_TWEAK_URL
    headers['x-github-token'] = source.auth.token
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 75_000)
  try {
    const r = await net(url, { method: 'POST', headers, body, signal: ctrl.signal })
    const j: any = await r.json().catch(() => null)
    if (r.ok && j && typeof j === 'object' && j.draft) {
      const dropped = Array.isArray(j.dropped) ? j.dropped.map((x: unknown) => String(x).slice(0, 80)).slice(0, 20) : []
      return { ok: true, draft: cleanDraft(j.draft), dropped }
    }
    const error = String(j?.error || `The AI answered ${r.status}`).split('\n')[0].slice(0, 160)
    return { ok: false, status: r.status, error, manual: MANUAL.has(r.status) || j?.code === 'no-key' }
  } catch (e: any) {
    return { ok: false, status: 0, error: ctrl.signal.aborted ? 'The AI took too long' : 'Could not reach the AI', manual: false }
  } finally {
    clearTimeout(timer)
  }
}
