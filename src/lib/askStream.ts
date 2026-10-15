// Ask AI, streamed over Server-Sent Events: the Supabase function (GitHub mode) or the dev
// server (local mode). Same events either way: status, delta, sources, done, error.
// Live answers sit in a small store outside React, so switching pages does not lose them.
import { useSyncExternalStore } from 'react'
import { AI_FUNCTION_URL } from '../config'
import { askAi, displayName, projectSlug, type AskOptions, type Model } from './hq'
import { serialize } from './md'
import { explainerPath, firstLine } from './read-core'
import { GitHubSource, type Me, type Source } from './source'
import { nowIso, same } from './util'

export type HistoryTurn = { q: string; a: string }
export type SourceRef = { title?: string; url?: string; path?: string }
export type Venue = 'edge' | 'local' | 'actions' | 'worker'
export type Live = {
  id: string
  thread: string
  question: string
  project?: string
  model: 'fast' | 'deep'
  venue: Venue
  state: 'streaming' | 'done' | 'error' | 'waiting'
  status: string
  text: string
  sources: SourceRef[]
  tools: string[]
  seconds?: number
  error?: string
  started: number
}

/** Abort and fall back when the stream has not started by then (cold starts take 1-2 s, the first status ~0.5 s). */
const FIRST_EVENT_MS = 15_000
/** A non-streaming reply (the old function: JSON once the whole answer is done) may take this long. */
const JSON_REPLY_MS = 150_000
export const MAX_HISTORY = 6
const HISTORY_ANSWER_CHARS = 1500

// ---- store ----

let lives: Live[] = []
const subs = new Set<() => void>()
let flush: ReturnType<typeof setTimeout> | undefined
const emit = (now = false) => {
  // Deltas arrive many times a second; repaint at most every 50 ms.
  clearTimeout(flush)
  if (now) subs.forEach((cb) => cb())
  else flush = setTimeout(() => subs.forEach((cb) => cb()), 50)
}
const patch = (id: string, p: Partial<Live> | ((l: Live) => Partial<Live>), now = false) => {
  lives = lives.map((l) => (l.id === id ? { ...l, ...(typeof p === 'function' ? p(l) : p) } : l))
  emit(now)
}
export const dropLive = (id: string) => {
  if (!lives.some((l) => l.id === id)) return
  lives = lives.filter((l) => l.id !== id)
  emit(true)
}
const subscribe = (cb: () => void) => {
  subs.add(cb)
  return () => void subs.delete(cb)
}
export const useLive = () => useSyncExternalStore(subscribe, () => lives, () => lives)
export const liveList = () => lives
export const liveBusy = () => lives.some((l) => l.state === 'streaming')

// ---- SSE ----

/** Minimal SSE reader: named events, multi-line data, comments ignored. */
export async function readSSE(body: ReadableStream<Uint8Array>, on: (event: string, data: any) => void) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const block = (raw: string) => {
    let event = 'message'
    const data: string[] = []
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue
      const i = line.indexOf(':')
      const field = i === -1 ? line : line.slice(0, i)
      const value = i === -1 ? '' : line.slice(i + 1).replace(/^ /, '')
      if (field === 'event') event = value
      else if (field === 'data') data.push(value)
    }
    if (!data.length) return
    const text = data.join('\n')
    let parsed: any = text
    try {
      parsed = JSON.parse(text)
    } catch { /* plain text data */ }
    on(event, parsed)
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    for (let m = buf.match(/\r?\n\r?\n/); m; m = buf.match(/\r?\n\r?\n/)) {
      block(buf.slice(0, m.index))
      buf = buf.slice(m.index! + m[0].length)
    }
  }
  if (buf.trim()) block(buf)
}

class BeforeFirstEvent extends Error {}
/** The function refused for good (e.g. 409: already asked): no fallback, it would hit the same wall. */
class Refused extends Error {}

const errorText = (j: any, status: number) => String(j?.error || j?.message || `AI function ${status}`).split('\n')[0].slice(0, 200)

/** One streamed request. Throws BeforeFirstEvent when the caller should use the slow path instead. */
async function stream(source: Source, req: AskOptions & { id: string }, history: HistoryTurn[], id: string) {
  let url = '/__hq/ask'
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  let body: Record<string, unknown> = { request: req, history }
  if (source instanceof GitHubSource) {
    const a = source.auth
    url = AI_FUNCTION_URL
    headers['x-github-token'] = a.token
    body = { repo: a.repo, branch: a.branch, ...body }
  }
  const ctrl = new AbortController()
  let first = setTimeout(() => ctrl.abort(), FIRST_EVENT_MS)
  let got = false
  let finished = false
  try {
    let res: Response
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal })
    } catch (e: any) {
      throw new BeforeFirstEvent(ctrl.signal.aborted ? 'The AI did not respond in time' : String(e?.message || e))
    }
    if (!res.ok || !res.body || !/event-stream/i.test(res.headers.get('content-type') || '')) {
      // Headers are in, so the function is alive: give a JSON body (old non-streaming function) its full time.
      clearTimeout(first)
      first = setTimeout(() => ctrl.abort(), JSON_REPLY_MS)
      const j = await res.json().catch(() => null)
      // The older non-streaming function answers with JSON {ok, answer} and has already saved both files.
      if (res.ok && typeof j?.answer === 'string') {
        patch(id, { state: j.ok === false ? 'error' : 'done', status: '', text: j.answer, error: j.ok === false ? 'The AI could not answer' : undefined }, true)
        return
      }
      if (res.status === 409) throw new Refused(errorText(j, res.status))
      throw new BeforeFirstEvent(errorText(j, res.status))
    }
    try {
      await readSSE(res.body, (event, data) => {
        if (!got) {
          got = true
          clearTimeout(first)
        }
        if (event === 'status') patch(id, { status: String(data?.text || '') })
        else if (event === 'delta') patch(id, (l) => ({ text: l.text + String(data?.text ?? '') }))
        else if (event === 'sources') patch(id, { sources: Array.isArray(data?.items) ? data.items : [] })
        else if (event === 'done') {
          finished = true
          patch(id, (l) => ({
            state: 'done',
            status: '',
            text: typeof data?.text === 'string' && data.text.trim() ? data.text : l.text,
            sources: Array.isArray(data?.sources) && data.sources.length ? data.sources : l.sources,
            tools: Array.isArray(data?.tools) ? data.tools.map(String) : [],
            seconds: typeof data?.seconds === 'number' ? data.seconds : Math.round((Date.now() - l.started) / 1000),
            // The function answered but its commit failed: the answer lives only in this tab.
            error: data?.saved === false && !data?.dry_run ? `Not saved to GitHub${data?.saveError ? `: ${String(data.saveError).slice(0, 160)}` : ''}. Copy it if you need it.` : undefined,
          }), true)
        } else if (event === 'error') {
          finished = true
          patch(id, { state: 'error', status: '', error: String(data?.message || data || 'Something went wrong') }, true)
        }
      })
    } catch (e: any) {
      if (!got) throw new BeforeFirstEvent(String(e?.message || e))
      throw e
    }
    if (!got) throw new BeforeFirstEvent('The AI closed the connection without answering')
    if (!finished) throw new Error('Connection lost before the answer finished. It will appear here once it is saved.')
  } finally {
    clearTimeout(first)
  }
}

/**
 * Ask a question and stream the answer into the live store.
 * Failure before the first event → the old path: commit the request for GitHub Actions
 * (GitHub mode) or run the local worker (local mode). `refresh` reloads the files afterwards.
 */
export async function ask(source: Source, me: Me, req: AskOptions & { id: string; thread: string }, history: HistoryTurn[], refresh: () => Promise<void>) {
  const { id } = req
  const venue: Venue = source.kind === 'local' ? 'local' : 'edge'
  lives = [
    ...lives.filter((l) => l.id !== id),
    {
      id, thread: req.thread, question: req.question, project: req.project, model: req.model === 'deep' ? 'deep' : 'fast',
      venue, state: 'streaming', status: 'Connecting', text: '', sources: [], tools: [], started: Date.now(),
    },
  ]
  emit(true)
  const request: AskOptions & { id: string } = { ...req, thread: req.thread === id ? undefined : req.thread }
  try {
    // done/error arrive after the files are saved: reload so the saved answer replaces the live one.
    await stream(source, request, history.slice(-MAX_HISTORY), id)
    await refresh()
  } catch (e: any) {
    if (e instanceof Refused || !(e instanceof BeforeFirstEvent)) {
      patch(id, { state: 'error', status: '', error: String(e?.message || e) }, true)
      await refresh().catch(() => {})
      return
    }
    // The fast path never started: fall back to the slow path.
    try {
      if (source.runAi) {
        patch(id, { venue: 'worker', status: 'Answering on this PC (no streaming)' }, true)
        await askAi(source, me, request)
        await source.runAi(id)
      } else {
        patch(id, { venue: 'actions', state: 'waiting', status: 'Fast path unavailable. GitHub Actions is answering (about a minute)' }, true)
        await askAi(source, me, request)
      }
      await refresh()
    } catch (e2: any) {
      patch(id, { state: 'error', status: '', error: `Could not ask: ${e2?.message || e2} (fast path: ${e.message})` }, true)
    }
  }
}

/** Earlier turns of a conversation as {q, a} (answer text only, trimmed), at most 6. */
export function historyOf(turns: { question: string; answer?: string }[]): HistoryTurn[] {
  return turns
    .filter((t) => t.answer && t.answer.trim())
    .slice(-MAX_HISTORY)
    .map((t) => ({ q: t.question.trim(), a: t.answer!.split('\n---\n**Sources**')[0].trim().slice(0, HISTORY_ANSWER_CHARS) }))
}

/** While streaming, hide a chart or explainer block that has not closed yet (it renders once complete). */
export function liveMarkdown(text: string) {
  const fences = [...text.matchAll(/^\s*```(.*)$/gm)]
  if (fences.length % 2 === 0) return text
  const open = fences[fences.length - 1]
  const lang = open[1].trim().toLowerCase()
  if (!/^(chart|explainer)\b/.test(lang)) return text
  return text.slice(0, open.index).trimEnd() + `\n\n*Drawing ${lang.startsWith('chart') ? 'a chart' : 'a picture'}…*`
}

// ---- Save to project (spec §5.2, critique E13): owner-only, create-only ----

/** The projects I own (the only ones "Save to project" offers), by title. */
export function ownedProjects(model: Model, me: Me) {
  return model.projects
    .filter((p) => same(p.data.owner, me.login))
    .map((p) => ({ slug: projectSlug(p), title: String(p.data.title || projectSlug(p)) }))
    .sort((a, b) => a.title.localeCompare(b.title))
}

/** Why I can't save into this project ('' = I can): only its owner may add pages to its folder. */
export function saveRefusal(model: Model, me: Me, slug: string) {
  const p = model.projects.find((d) => projectSlug(d) === slug)
  if (!p) return `No such project: ${slug}`
  return same(p.data.owner, me.login) ? '' : `Only ${p.data.owner ? displayName(model, p.data.owner) : 'its owner'} can add pages to ${String(p.data.title || slug)}`
}

/**
 * Save an AI answer as a new page `projects/<slug>/explainer-<topic>.md`. Owner-only (checked here, and again by the
 * local dev server / the repo's own rules) and create-only: an existing file is never overwritten (`written: false`).
 * The page keeps the answer's markdown (its explainer/chart blocks render in the project) and points at the answer file.
 */
export async function saveToProject(
  source: Source,
  me: Me,
  model: Model,
  o: { slug: string; question: string; answer: string; answerPath?: string },
  now: string = nowIso(),
): Promise<{ path: string; written: boolean }> {
  const why = saveRefusal(model, me, o.slug)
  if (why) throw new Error(why)
  const path = explainerPath(o.slug, o.question)
  if (!path) throw new Error(`Not a project folder: ${o.slug}`)
  const title = firstLine(o.question, 80).replace(/^About “(.+)”$/, '$1') || 'Answer'
  const data = { title, type: 'explainer', project: o.slug, source: o.answerPath || undefined, created: now, by: me.login }
  const body = `# ${title}\n\n${String(o.answer || '').trim()}\n`
  const written = await source.update(path, (cur) => (cur === null ? serialize(data, body) : null), `project: save answer to ${o.slug} by ${me.login}`)
  return { path, written }
}

/** Plain words for a failed answer (the provider's raw text stays behind "Details"): never an HTTP code or API jargon
 *  in the main line. */
export function aiErrorWords(raw: unknown): string {
  const s = String(raw || '').toLowerCase()
  if (/api[ _-]?key|gemini (400|403)|no gemini/.test(s)) return "The AI key isn't working · the workspace owner needs to check it"
  if (/\b401\b|github token|sign[ -]?in/.test(s)) return 'Your sign-in has expired · reconnect in Settings'
  if (/\b403\b|not allowed/.test(s)) return "Your account can't use HQ AI yet · ask the workspace owner"
  if (/\b429\b|too many|rate limit|quota|busy/.test(s)) return 'Too many questions right now · try again in a minute'
  if (/network|failed to fetch|offline|timed? ?out|took too long|did not answer|unreachable/.test(s)) return "Can't reach the AI right now · try again"
  return "The AI couldn't answer this time · try again"
}
