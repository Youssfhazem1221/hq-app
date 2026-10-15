// Look prefs store (spec §7, plan module E2): the device cache (`hq.ui.<login>`, read by the pre-paint script), the
// person's file `people/<slug>/ui.md` (frontmatter only, flat keys), preview / apply / undo / reset, and the client side
// of the `ui-tweak` endpoint (Adjust look + the onboarding profile draft).
//
// - Every value goes through ui-prefs-core's normalizer (cache, file, model answer, presets, palette).
// - <html> only ever gets enum data-* attributes (applyRoot → toDataAttrs).
// - The file is written 8 s after the last change, with ONLY the keys this device changed since it last read the file
//   (diff vs that file), through Source.update + setTopKeys. Two devices never overwrite each other's other keys. An Undo
//   inside the 8 s window cancels the write. A newer file (doorbell / refresh → new `files`) is re-read and re-applied,
//   keeping this device's unsaved changes on top.
// - Signed out (no login or no source): cache only. First sign-in with a device look and no file: asks once
//   "Keep this look on all your devices?".
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { parse as parseYaml } from 'yaml'
import {
  DEFAULT_PREFS, clausesOf, diffPrefs, fromFrontmatter, isPin, normalizePrefs, normalizeTweak, parseTweakLocal, resolvePrefs,
  toDataAttrs, toFrontmatterPatch, withPatch, type TweakResult, type UiPrefs,
} from './ui-prefs-core'
import { PREFS_LAST_KEY, PREFS_LOCAL_LOGIN, prefsCacheKey, type PrefsApi, type ToastKind, type ToastOpts } from './contracts'
import { setTopKeys, slugOf } from './people-core'
import type { FileEntry, Source, UpdateFn } from './source'
import { SUPABASE_URL } from '../config'
import { toast } from '../components/toast'

export const SAVE_DELAY_MS = 8000
export const HISTORY_MAX = 10
/** Logins (lowercased) already asked "Keep this look on all your devices?" ('@' can't start a login, so no clash). */
export const ASKED_KEY = 'hq.ui.@asked'
export const UI_TWEAK_URL = `${SUPABASE_URL}/functions/v1/ui-tweak`
const LOCAL_TWEAK_URL = '/__hq/ui-tweak'
/** The edge function refuses bodies over 4 KB (Adjust look). */
const TWEAK_BODY_MAX = 4000

export type SaveState = 'device' | 'idle' | 'pending' | 'saving' | 'saved' | 'error'
export type LookHistory = { label: string; at: number }
export type LookState = {
  /** What the page shows: the committed look with the preview on top. */
  prefs: UiPrefs
  committed: UiPrefs
  previewing: boolean
  history: LookHistory[]
  /** device = cache only (signed out) · pending = waiting the 8 s · saved / error = the last file write. */
  save: SaveState
  /** Show "Keep this look on all your devices?" */
  offer: boolean
  /** people/<slug>/ui.md, or null when signed out. */
  path: string | null
}
/** Extra things the real store gives the drawer and Settings (the interim store in A's hq-context has none). */
export type LookExtras = {
  history: LookHistory[]
  save: SaveState
  offer: boolean
  path: string | null
  keepEverywhere(): Promise<boolean>
  dismissOffer(): void
  flush(): Promise<boolean>
}
export type LookApi = PrefsApi & { look: LookExtras }
/** The extras when the provided PrefsApi is the real store (usePrefs), else null. */
export const lookExtras = (api: PrefsApi): LookExtras | null => ((api as Partial<LookApi>).look as LookExtras | undefined) || null

// ---------------------------------------------------------------------------------------------------------------------
// cache · file · root
// ---------------------------------------------------------------------------------------------------------------------

type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void }

function safeStorage(): KV | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
function readJson(kv: KV | null, key: string): unknown {
  try {
    const v = kv ? kv.getItem(key) : null
    return v == null ? null : JSON.parse(v)
  } catch {
    return null
  }
}
function writeJson(kv: KV | null, key: string, v: unknown) {
  try {
    if (kv) kv.setItem(key, JSON.stringify(v))
  } catch {
    /* private mode, quota */
  }
}

/** The file of a login: `people/<slug>/ui.md` (slug = the profile's slug, else slugOf(login)). null when signed out. */
export function prefsPath(login: string | null | undefined, slug?: string | null): string | null {
  if (!login) return null
  const s = typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(slug) ? slug : slugOf(login)
  return `people/${s}/ui.md`
}

/** What the cache keeps: non-default keys only (the pre-paint reads the enum keys; lists ride along for the next start). */
export const cacheShape = (p: unknown): Partial<UiPrefs> => diffPrefs(DEFAULT_PREFS, p)

/** The cached look of a login. First sign-in on this device: the signed-out look (`hq.ui.@local`) is adopted. */
export function readCache(kv: KV | null, login: string | null): { prefs: UiPrefs; adopted: boolean } {
  let raw = readJson(kv, prefsCacheKey(login))
  let adopted = false
  if (raw === null && login) {
    const loc = readJson(kv, prefsCacheKey(null))
    if (loc && Object.keys(normalizePrefs(loc).prefs).length) {
      raw = loc
      adopted = true
    }
  }
  return { prefs: resolvePrefs(raw), adopted }
}

/** Save the cache and point the pre-paint script at it (`hq.ui.@last`). */
export function writeCache(kv: KV | null, login: string | null, p: unknown) {
  writeJson(kv, prefsCacheKey(login), cacheShape(p))
  writeJson(kv, PREFS_LAST_KEY, login ? login.toLowerCase() : PREFS_LOCAL_LOGIN)
}

/** ui.md text → the look it describes (missing keys = defaults). Never throws. */
export function readUiFile(text: string): UiPrefs {
  let t = String(text || '')
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1)
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(t)
  if (!m) return resolvePrefs({})
  try {
    return resolvePrefs(fromFrontmatter(parseYaml(m[1])).prefs)
  } catch {
    return resolvePrefs({})
  }
}

const safeLogin = (login: string) => login.replace(/[^\w.-]/g, '').slice(0, 40) || 'someone'
/** A new ui.md: frontmatter only (spec §7.2). */
export function uiTemplate(login: string, iso: string): string {
  return setTopKeys('---\n---\n', { type: 'ui-prefs', person: safeLogin(login), v: 1, updated: iso })
}

/** The file edit for a patch of changed keys: only those keys (+ `updated`); a key back at its default is removed.
 *  Pure (Source.update may run it again on a newer text). Same text → null (nothing to write). */
export function uiFileEdit(login: string, changed: Partial<UiPrefs>, iso: string): UpdateFn {
  const fm = toFrontmatterPatch(changed)
  return (cur) => {
    if (cur == null) return Object.keys(fm).length ? setTopKeys(uiTemplate(login, iso), fm) : null
    const next = setTopKeys(cur, fm)
    return next === cur ? null : setTopKeys(next, { updated: iso })
  }
}

const FONT_URL: Record<string, string> = { lexend: 'Lexend:wght@400..700', atkinson: 'Atkinson+Hyperlegible:wght@400;700' }
function loadFont(font: string) {
  if (!FONT_URL[font] || document.getElementById('font-' + font)) return
  const l = document.createElement('link')
  l.id = 'font-' + font
  l.rel = 'stylesheet'
  l.href = `https://fonts.googleapis.com/css2?family=${FONT_URL[font]}&display=swap`
  document.head.appendChild(l)
}

/** Put a look on <html>: enum data-* attributes only (data-theme resolved light|dark, data-theme-pref, and every
 *  non-default enum key), and the chosen reading font. Nothing else from prefs ever reaches the DOM. */
export function applyRoot(prefs: unknown, root?: Pick<HTMLElement, 'getAttribute' | 'setAttribute' | 'removeAttribute'>, systemDark?: boolean) {
  const hasDoc = typeof document !== 'undefined'
  const r = root || (hasDoc ? document.documentElement : null)
  if (!r) return
  const dark = systemDark ?? (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches)
  const attrs = toDataAttrs(prefs, dark)
  for (const k of Object.keys(attrs)) {
    const v = attrs[k]
    if (v === null) r.removeAttribute(k)
    else if (r.getAttribute(k) !== v) r.setAttribute(k, v)
  }
  if (hasDoc) loadFont(resolvePrefs(prefs).font)
}

// ---------------------------------------------------------------------------------------------------------------------
// the store (no React: tested in node with a stub source and manual timers)
// ---------------------------------------------------------------------------------------------------------------------

type Writer = { update(path: string, fn: UpdateFn, message: string): Promise<boolean> }
type Timers = { set(fn: () => void, ms: number): unknown; clear(t: unknown): void }

export type PrefsStoreOpts = {
  login: string | null
  /** The profile slug (people/<slug>.md); default slugOf(login). */
  slug?: string | null
  source?: Writer | null
  storage?: KV | null
  delayMs?: number
  now?: () => number
  timers?: Timers
  notify?: (text: string, kind: ToastKind, opts?: ToastOpts) => void
}

export type PrefsStore = {
  readonly path: string | null
  get(): LookState
  subscribe(cb: () => void): () => void
  preview(p: Partial<UiPrefs> | null | undefined): void
  /** true = something changed. */
  apply(p: Partial<UiPrefs>, label: string): boolean
  undo(): void
  reset(): void
  /** The person's ui.md as just read (null = there is no file). */
  syncFrom(text: string | null | undefined): void
  /** Write now (the 8 s wait skipped). true = a file write happened. */
  flush(): Promise<boolean>
  keepEverywhere(): Promise<boolean>
  dismissOffer(): void
  /** Stop (a pending change is still written). */
  dispose(): void
}

export function createPrefsStore(o: PrefsStoreOpts): PrefsStore {
  const kv = o.storage === undefined ? safeStorage() : o.storage
  const login = o.login ? String(o.login) : null
  const path = prefsPath(login, o.slug)
  const delay = o.delayMs ?? SAVE_DELAY_MS
  const now = o.now || Date.now
  const timers: Timers = o.timers || { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>) }
  const notify = o.notify || (() => {})
  const source = o.source && typeof o.source.update === 'function' ? o.source : null
  const canSave = !!(login && path && source)

  const init = readCache(kv, login)
  let committed = init.prefs
  // The last-read file. Before the first read: the look this device started with (so only real changes get written).
  let base = committed
  let fileRead = false
  let draft: Partial<UiPrefs> | null = null
  let history: { before: UiPrefs; label: string; at: number }[] = []
  let save: SaveState = canSave ? 'idle' : 'device'
  let offer = false
  let timer: unknown = null
  let inflight: Promise<boolean> | null = null
  const subs = new Set<() => void>()
  if (init.adopted) writeCache(kv, login, committed)

  const build = (): LookState => ({
    prefs: draft ? withPatch(committed, draft) : committed,
    committed,
    previewing: !!draft,
    history: history.map((h) => ({ label: h.label, at: h.at })),
    save,
    offer,
    path,
  })
  let snap = build()
  const emit = () => {
    snap = build()
    for (const f of [...subs]) f()
  }
  const pending = () => diffPrefs(base, committed)
  const askedList = (): string[] => {
    const v = readJson(kv, ASKED_KEY)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 50) : []
  }
  const asked = () => !!login && askedList().includes(login.toLowerCase())
  const markAsked = () => {
    if (login && !asked()) writeJson(kv, ASKED_KEY, [...askedList(), login.toLowerCase()].slice(-50))
  }

  function stopTimer() {
    if (timer !== null) timers.clear(timer)
    timer = null
  }
  function schedule() {
    if (!canSave) return
    stopTimer()
    if (!Object.keys(pending()).length) {
      // e.g. Undo inside the window: nothing left to write, no commit
      if (save === 'pending') save = 'idle'
      return
    }
    save = 'pending'
    timer = timers.set(() => {
      timer = null
      void flush()
    }, delay)
  }
  function commit(next: UiPrefs, label: string, undoable: boolean) {
    if (undoable) history = [{ before: committed, label, at: now() }, ...history].slice(0, HISTORY_MAX)
    committed = next
    draft = null
    writeCache(kv, login, committed)
    if (offer) {
      // the next write carries the whole look anyway
      offer = false
      markAsked()
    }
    schedule()
    emit()
  }

  async function flush(): Promise<boolean> {
    stopTimer()
    if (inflight) await inflight.catch(() => false)
    if (!canSave) return false
    const changed = pending()
    if (!Object.keys(changed).length) {
      if (save === 'pending') {
        save = 'idle'
        emit()
      }
      return false
    }
    const iso = new Date(now()).toISOString().replace(/\.\d{3}Z$/, 'Z')
    save = 'saving'
    emit()
    const run = (async () => {
      try {
        const wrote = await source!.update(path!, uiFileEdit(login!, changed, iso), `people: ui ${login}`)
        base = withPatch(base, changed)
        save = 'saved'
        return wrote
      } catch {
        save = 'error'
        notify('Your look is not saved to your profile yet. It stays on this device.', 'error')
        return false
      }
    })()
    inflight = run
    try {
      return await run
    } finally {
      inflight = null
      if ((save as SaveState) === 'saved' && Object.keys(pending()).length) schedule()
      emit()
    }
  }

  const store: PrefsStore = {
    path,
    get: () => snap,
    subscribe(cb) {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
    preview(p) {
      const n = p && typeof p === 'object' ? normalizePrefs(p).prefs : {}
      const next = Object.keys(n).length ? n : null
      if (!next && !draft) return
      draft = next
      emit()
    },
    apply(p, label) {
      const next = withPatch(committed, p)
      if (!Object.keys(diffPrefs(committed, next)).length) {
        if (draft) {
          draft = null
          emit()
        }
        return false
      }
      const text = String(label || 'Look').slice(0, 80)
      commit(next, text, true)
      notify(`${text} · saved`, 'ok', { undo: store.undo })
      return true
    },
    undo() {
      const h = history.shift()
      if (!h) return
      commit(h.before, h.label, false)
      notify('Undone: ' + h.label, 'info')
    },
    reset() {
      const next = resolvePrefs({})
      if (!Object.keys(diffPrefs(committed, next)).length) {
        if (draft) {
          draft = null
          emit()
        }
        return notify('This is already the default look', 'info')
      }
      commit(next, 'Reset to default', true)
      notify('Look reset', 'ok', { undo: store.undo })
    },
    syncFrom(text) {
      if (text === undefined) return
      const first = !fileRead
      fileRead = true
      if (text === null) {
        // No file. Keep this device's look; offer once to save it to the profile.
        base = resolvePrefs({})
        if (first && canSave && timer === null && Object.keys(pending()).length && !asked()) {
          offer = true
          emit()
        }
        return
      }
      const file = readUiFile(text)
      const keep = pending() // this device's unsaved changes stay on top
      base = file
      const next = withPatch(file, keep)
      const changed = Object.keys(diffPrefs(committed, next)).length > 0
      if (changed) {
        committed = next
        writeCache(kv, login, committed)
      }
      if (changed || offer) {
        offer = false
        emit()
      }
    },
    flush,
    async keepEverywhere() {
      offer = false
      markAsked()
      emit()
      return flush()
    },
    dismissOffer() {
      offer = false
      markAsked()
      emit()
    },
    dispose() {
      subs.clear()
      if (timer !== null) void flush()
    },
  }
  return store
}

// ---------------------------------------------------------------------------------------------------------------------
// React: the hook A2 wires into App in place of useInterimPrefs
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The look of the signed-in person (or of this device when signed out), as a PrefsApi (+ `look` extras).
 * App: `const prefsApi = usePrefs(me?.login || null, { source, files, slug })` and provide it through PrefsContext.
 * `files` = the loaded workspace files (re-read on every refresh, so a push from another device re-applies here);
 * without `files` the hook reads the file once through `source.read`.
 */
export function usePrefs(
  login: string | null,
  opts: { source?: Source | null; files?: FileEntry[] | null; slug?: string | null } = {},
): LookApi {
  const { source = null, files, slug = null } = opts
  const store = useMemo(() => createPrefsStore({ login, slug, source, notify: toast }), [login, slug, source])
  useEffect(() => () => store.dispose(), [store])
  const s = useSyncExternalStore(store.subscribe, store.get, store.get)

  useEffect(() => {
    if (!files || !store.path) return
    const f = files.find((x) => x.path === store.path)
    store.syncFrom(f ? f.text : null)
  }, [store, files])
  useEffect(() => {
    if (files !== undefined || !source || !store.path) return
    let off = false
    source.read(store.path).then(
      (t) => !off && store.syncFrom(t),
      () => {},
    )
    return () => {
      off = true
    }
  }, [store, source, files])

  useEffect(() => {
    applyRoot(s.prefs)
    if (s.prefs.theme !== 'system' || typeof matchMedia !== 'function') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const f = () => applyRoot(s.prefs)
    mq.addEventListener?.('change', f)
    return () => mq.removeEventListener?.('change', f)
  }, [s.prefs])

  // leaving the page inside the 8 s window: write now (best effort). Only a write that Apply/Undo/Reset already
  // scheduled: a device look that was never applied here (cache only, no file yet) is never written on its own.
  useEffect(() => {
    const f = () => {
      if (store.get().save === 'pending') void store.flush()
    }
    addEventListener('pagehide', f)
    return () => removeEventListener('pagehide', f)
  }, [store])

  return useMemo(
    () => ({
      prefs: s.prefs,
      preview: store.preview,
      apply: (p: Partial<UiPrefs>, label: string) => void store.apply(p, label),
      undo: store.undo,
      reset: store.reset,
      look: {
        history: s.history,
        save: s.save,
        offer: s.offer,
        path: s.path,
        keepEverywhere: store.keepEverywhere,
        dismissOffer: store.dismissOffer,
        flush: store.flush,
      },
    }),
    [s, store],
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// the ui-tweak endpoint (edge function in GitHub mode, /__hq/ui-tweak locally)
// ---------------------------------------------------------------------------------------------------------------------

export type AiReply =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; error: string; code?: string }

type Caller = { kind: string; auth?: { token: string } }

/** POST one request to the ui-tweak endpoint. Never throws. The answer is untrusted: callers normalize it. */
export async function callLookAi(
  source: Caller | null,
  body: Record<string, unknown>,
  o: { timeoutMs?: number; fetch?: typeof fetch } = {},
): Promise<AiReply> {
  if (!source) return { ok: false, status: 0, error: 'Not connected', code: 'offline' }
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  let url = LOCAL_TWEAK_URL
  if (source.kind === 'github') {
    const token = source.auth?.token
    if (!token) return { ok: false, status: 0, error: 'Not connected', code: 'offline' }
    url = UI_TWEAK_URL
    headers['x-github-token'] = token
  } else if (source.kind !== 'local') return { ok: false, status: 0, error: 'Not connected', code: 'offline' }
  const net = o.fetch || ((...a: Parameters<typeof fetch>) => fetch(...a))
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 25_000)
  try {
    const r = await net(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal })
    const j: unknown = await r.json().catch(() => null)
    const obj = j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null
    if (r.ok && obj) return { ok: true, status: r.status, body: obj }
    const error = typeof obj?.error === 'string' ? obj.error.split('\n')[0].slice(0, 160) : `Adjust look ${r.status}`
    return { ok: false, status: r.status, error, code: typeof obj?.code === 'string' ? obj.code : undefined }
  } catch {
    return { ok: false, status: 0, error: ctrl.signal.aborted ? 'Gemini took too long' : 'Gemini did not answer', code: 'network' }
  } finally {
    clearTimeout(t)
  }
}

export type LookContext = { page: string; widgets?: string[]; nav?: string[]; pinnable?: { id: string; title: string }[] }
export type Suggestion = { clauses: string[]; result: TweakResult; via: 'ai' | 'rules'; note?: string }

/** The no-AI answer (instant; offline, signed out, AI down). Only changes against `current`. */
export function localSuggestion(wish: string, current: unknown): Suggestion {
  return { clauses: clausesOf(wish), result: parseTweakLocal(wish, current), via: 'rules' }
}

/** Set for the session once the endpoint says Gemini is not set up here (501/503): the rules answer from then on. */
let aiOff = ''
/** For tests. */
export const resetLookAi = () => void (aiOff = '')

/**
 * A wish → a previewable patch. Asks Gemini through the ui-tweak endpoint; the answer is normalized AGAIN here
 * (enum-only patch, int clause indexes, pins only from what was offered or is already pinned) and reduced to real
 * changes against `current`. Any failure → the local rules, with a short note. Never throws.
 */
export async function suggestLook(
  source: Caller | null,
  wish: string,
  current: unknown,
  ctx: LookContext,
  o: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<Suggestion> {
  const local = localSuggestion(wish, current)
  if (!local.clauses.length) return local
  if (!source) return local
  if (aiOff) return { ...local, note: aiOff }
  const cur = resolvePrefs(current)
  const pinnable: { id: string; title: string }[] = []
  for (const p of ctx.pinnable || []) {
    if (pinnable.length >= 30) break
    const title = String(p?.title || '').replace(/\s+/g, ' ').trim().slice(0, 60)
    if (isPin(p?.id) && title && !pinnable.some((x) => x.id === p.id)) pinnable.push({ id: p.id, title })
  }
  const body = { action: 'ui-tweak', clauses: local.clauses, current: cur, context: { page: ctx.page, widgets: ctx.widgets || [], nav: ctx.nav || [], pinnable } }
  while (pinnable.length && new TextEncoder().encode(JSON.stringify(body)).length > TWEAK_BODY_MAX) pinnable.pop()
  const r = await callLookAi(source, body, o)
  if (!r.ok) {
    if (r.status === 501 || r.status === 503) aiOff = 'Gemini is not set up here: used the built-in rules'
    const note = aiOff || (r.status === 429 ? 'Gemini is busy: used the built-in rules' : 'Gemini did not answer: used the built-in rules')
    return { ...local, note }
  }
  const t = normalizeTweak(r.body, local.clauses.length)
  if (t.patch.pinned) {
    const ok = new Set([...pinnable.map((p) => p.id), ...cur.pinned])
    t.patch.pinned = t.patch.pinned.filter((id) => ok.has(id))
  }
  return { clauses: local.clauses, result: { patch: diffPrefs(cur, withPatch(cur, t.patch)), unsupported: t.unsupported }, via: 'ai' }
}

/**
 * Onboarding (module D): an intake markdown (≤ ~20 kB, untrusted) → a validated profile draft, through the same
 * endpoint (action "profile-draft"). 200 body = {draft, dropped}: render it as TEXT only and let the person edit it;
 * nothing is saved by this call.
 */
export function draftProfile(source: Caller | null, intake: string, knownProjects: string[] = [], o: { fetch?: typeof fetch } = {}) {
  const known = knownProjects.filter((x) => typeof x === 'string' && x.trim()).slice(0, 40).map((x) => x.slice(0, 80))
  return callLookAi(source, { action: 'profile-draft', intake: String(intake || ''), known_projects: known }, { timeoutMs: 75_000, fetch: o.fetch })
}
