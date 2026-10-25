// Saving files the editing tools add or remove (phase 3): text files go through the Source's policy-checked apply()
// (create-only, one commit each, works locally and on GitHub); media files go up as bytes: on GitHub through the
// contents API with the signed-in token, locally through the dev server's POST /__hq/upload (owner only, create-only,
// media types only). Lazy: only the editing UI imports it.
import type { Source } from './source'
import { UPLOAD_BYTES, UPLOAD_TEXT } from './fm-edit'

const extOf = (p: string) => /\.([a-z0-9]+)$/i.exec(p)?.[1].toLowerCase() || ''
const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/')
type Auth = { token: string; repo: string; branch: string }
const authOf = (source: Source): Auth => {
  const a = (source as { auth?: Auth }).auth
  if (!a?.token) throw new Error('Sign in with a GitHub token first (Settings)')
  return a
}
const gh = (a: Auth, path: string, init: RequestInit = {}) =>
  fetch(`https://api.github.com/repos/${a.repo}/contents/${encPath(path)}${init.method ? '' : `?ref=${encodeURIComponent(a.branch)}`}`, {
    ...init,
    cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${a.token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
  })
const exists = (path: string) => new Error(`${path.split('/').pop()} already exists there: pick another name`)

/** A Blob as base64, in chunks (large files would overflow String.fromCharCode's argument list). */
export async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Whether a file is saved as text (apply) or as bytes. null = HQ does not take this kind. */
export const saveKind = (path: string): 'text' | 'bytes' | null => (UPLOAD_TEXT.has(extOf(path)) ? 'text' : UPLOAD_BYTES.has(extOf(path)) ? 'bytes' : null)

/** A new text file (create-only: an existing file is never overwritten). */
export async function createText(source: Source, path: string, text: string, message: string) {
  try {
    await source.apply(path, null, text, message)
  } catch (e: any) {
    if (e?.name === 'StaleWriteError') throw exists(path)
    throw e
  }
}

/** A new media file (create-only). */
export async function createBytes(source: Source, path: string, blob: Blob, message: string) {
  const base64 = await toBase64(blob)
  if (source.kind === 'local') {
    const r = await fetch('/__hq/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, base64 }) })
    if (r.status === 409) throw exists(path)
    if (!r.ok) throw new Error(`Not saved: ${String((await r.json().catch(() => null))?.error || r.status)}`)
    return
  }
  const a = authOf(source)
  const r = await gh(a, path, { method: 'PUT', body: JSON.stringify({ message, content: base64, branch: a.branch }) })
  // without a sha GitHub refuses to replace an existing file (422): exactly the create-only rule
  if (r.status === 422) throw exists(path)
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${path.split('/').pop()} was not saved`)
}

/** Remove a file. A text file goes through apply (refused when it is no longer exactly `text`); a media file by its
 *  current blob (GitHub) or the dev server (local). */
export async function removeFile(source: Source, path: string, message: string, text?: string) {
  if (text !== undefined) return source.apply(path, text, null, message)
  if (source.kind === 'local') {
    const r = await fetch('/__hq/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, delete: true }) })
    if (!r.ok) throw new Error(`Not removed: ${String((await r.json().catch(() => null))?.error || r.status)}`)
    return
  }
  const a = authOf(source)
  const meta = await gh(a, path)
  if (meta.status === 404) return
  if (!meta.ok) throw new Error(`GitHub ${meta.status}: could not find ${path}`)
  const { sha } = await meta.json()
  const r = await gh(a, path, { method: 'DELETE', body: JSON.stringify({ message, sha, branch: a.branch }) })
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${path.split('/').pop()} was not removed`)
}
