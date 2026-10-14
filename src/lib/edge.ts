// Instant Ask AI through the Supabase Edge Function (when deployed).
import { AI_FUNCTION_URL } from '../config'
import type { AskOptions } from './hq'
import { GitHubSource, type Source } from './source'

let available: boolean | null = null

/** One cheap preflight per page load; a missing function fails CORS → false. */
export async function edgeAvailable(source: Source) {
  if (!(source instanceof GitHubSource) || !AI_FUNCTION_URL) return false
  if (available !== null) return available
  try {
    const r = await fetch(AI_FUNCTION_URL, { method: 'OPTIONS' })
    available = r.ok
  } catch {
    available = false
  }
  return available
}

export async function askViaEdge(source: Source, opts: AskOptions & { id: string }) {
  if (!(source instanceof GitHubSource)) throw new Error('Edge needs GitHub mode')
  const { token, repo, branch } = source.auth
  const r = await fetch(AI_FUNCTION_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-github-token': token },
    body: JSON.stringify({ repo, branch, request: opts }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `AI function ${r.status}`)
  return j as { ok: boolean; answer: string }
}
