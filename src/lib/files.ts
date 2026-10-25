// The file viewer's data layer: what kind a repo file is, the list of every file (not just notes) and reading one.
// Lazy: only the viewer (components/files) and the project page's Files card import it. The list comes from the same
// place as the notes: the local dev server (GET /__hq/tree) or the GitHub tree API with the signed-in token (one call,
// then a free 304 while nothing changed). Nothing is stored in the browser.
// - Media bytes come through the Source and are re-typed from the extension (MEDIA_TYPE), never from the response.
// - SVG is read as text and only ever drawn inside an <img> (no blob: link to open it as a page, where it could run).
// - HTML is never turned into a blob: URL either: it is previewed in a sandboxed frame (lib/html-preview.ts).
import type { Source } from './source'
import { excluded } from './sync'

export type FileInfo = { path: string; size: number }
export type FileKind = 'md' | 'json' | 'table' | 'image' | 'svg' | 'video' | 'audio' | 'html' | 'text' | 'other'

const KINDS: Record<string, FileKind> = {
  md: 'md', markdown: 'md', json: 'json', jsonc: 'json', geojson: 'json', tsv: 'table', csv: 'table',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', avif: 'image', svg: 'svg',
  mp4: 'video', m4v: 'video', webm: 'video', mov: 'video', mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio',
  oga: 'audio', aac: 'audio', flac: 'audio', html: 'html', htm: 'html',
  txt: 'text', mjs: 'text', cjs: 'text', js: 'text', jsx: 'text', ts: 'text', tsx: 'text', css: 'text', yml: 'text',
  yaml: 'text', toml: 'text', sql: 'text', py: 'text', sh: 'text', cmd: 'text', bat: 'text', ps1: 'text', xml: 'text',
  ini: 'text', cfg: 'text', conf: 'text', gitignore: 'text',
}

/** The media types the viewer gives the bytes it reads (by extension, never from the response). */
export const MEDIA_TYPE: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', oga: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac',
}

export const KIND_LABEL: Record<FileKind, string> = {
  md: 'Note', json: 'JSON data', table: 'Table', image: 'Image', svg: 'Vector image', video: 'Video', audio: 'Audio',
  html: 'Web page', text: 'Text', other: 'File',
}

/** Largest text file the viewer reads (JSON, TSV, HTML, code); bigger ones get a link to GitHub. */
export const TEXT_MAX = 5_000_000
/** Largest media file the viewer reads into memory. */
export const MEDIA_MAX: Record<string, number> = { image: 25_000_000, svg: 2_000_000, video: 100_000_000, audio: 100_000_000 }

export const extOf = (p: string) => /\.([a-z0-9]+)$/i.exec(String(p || ''))?.[1].toLowerCase() || ''
export const kindOf = (p: string): FileKind => (Object.prototype.hasOwnProperty.call(KINDS, extOf(p)) ? KINDS[extOf(p)] : 'other')
export const baseName = (p: string) => String(p || '').split('/').pop() || ''
export const folderOf = (p: string) => String(p || '').split('/').slice(0, -1).join('/')

/** "13 KB", "2.8 MB": the size a person reads (1 KB = 1000 bytes, like the OS file list). */
export function humanSize(bytes: number) {
  const b = Number(bytes) || 0
  if (b < 1000) return `${b} B`
  if (b < 1e6) return `${Math.round(b / 100) / 10} KB`.replace('.0 ', ' ')
  return `${Math.round(b / 1e5) / 10} MB`.replace('.0 ', ' ')
}

const okInfo = (f: unknown): f is FileInfo =>
  !!f && typeof (f as FileInfo).path === 'string' && !excluded((f as FileInfo).path) && Number.isFinite((f as FileInfo).size)

// One cached list per repo + branch (GitHub) with its tree ETag, so opening files again costs a free 304.
let cache: { key: string; etag?: string; files: FileInfo[] } | null = null

/** Every file in the workspace with its size, A–Z. Same exclusions as the notes (dot-folders, app/, node_modules). */
export async function listFiles(source: Source): Promise<FileInfo[]> {
  if (source.kind === 'local') {
    const r = await fetch('/__hq/tree', { cache: 'no-store' })
    if (!r.ok) throw new Error(`Local dev server: no file list (${r.status}). Restart it after updating the app.`)
    const list = await r.json().catch(() => [])
    return (Array.isArray(list) ? list : []).filter(okInfo)
  }
  const auth = (source as { auth?: { token: string; repo: string; branch: string } }).auth
  if (!auth?.token) return []
  const key = `${auth.repo}@${auth.branch}`
  let r: Response
  try {
    r = await fetch(`https://api.github.com/repos/${auth.repo}/git/trees/${encodeURIComponent(auth.branch)}?recursive=1`, {
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${auth.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(cache?.key === key && cache.etag ? { 'If-None-Match': cache.etag } : {}),
      },
    })
  } catch {
    throw new Error('Can’t reach GitHub right now. Check the connection and try again.')
  }
  if (r.status === 304 && cache?.key === key) return cache.files
  if (!r.ok) throw new Error(`GitHub ${r.status}: could not list the files`)
  const tree = await r.json()
  const files = (Array.isArray(tree.tree) ? tree.tree : [])
    .filter((t: any) => t && t.type === 'blob')
    .map((t: any) => ({ path: String(t.path), size: Number(t.size) || 0 }))
    .filter(okInfo)
    .sort((a: FileInfo, b: FileInfo) => a.path.localeCompare(b.path))
  cache = { key, etag: r.headers.get('etag') || undefined, files }
  return files
}

/** A media file's bytes as a Blob typed from its extension; null when it is missing or not a media type. */
export async function readMedia(source: Source, path: string): Promise<Blob | null> {
  const type = MEDIA_TYPE[extOf(path)]
  if (!type) return null
  const b = await source.readBytes(path)
  return b && b.size > 0 ? new Blob([b], { type }) : null
}

/** An SVG for an <img>: its text, typed image/svg+xml (scripts never run inside an <img>). */
export async function readSvg(source: Source, path: string): Promise<Blob | null> {
  const text = await source.read(path)
  return text ? new Blob([text], { type: 'image/svg+xml' }) : null
}
