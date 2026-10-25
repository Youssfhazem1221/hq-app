// The file viewer's media views: an image, an SVG (inside an <img> only), a video, an audio file, and a web page
// running in a sandboxed frame (lib/html-preview: local CSS, scripts and images put inline first).
import { useEffect, useMemo, useState } from 'react'
import { Monitor, RotateCw, Smartphone, Square } from 'lucide-react'
import type { Source } from '../../lib/source'
import { MEDIA_MAX, extOf, humanSize, kindOf, readMedia, readSvg, type FileInfo, type FileKind } from '../../lib/files'
import { buildPreview, type Preview } from '../../lib/html-preview'
import { Callout, Segmented } from '../ui'

/** A blob: URL for a media file, revoked when the view closes. `state`: loading · ok · missing · error. */
function useMediaUrl(source: Source, path: string, kind: FileKind) {
  const [st, setSt] = useState<{ url: string | null; state: 'loading' | 'ok' | 'missing' | 'error' }>({ url: null, state: 'loading' })
  useEffect(() => {
    let alive = true
    let made: string | null = null
    setSt({ url: null, state: 'loading' })
    ;(kind === 'svg' ? readSvg(source, path) : readMedia(source, path)).then(
      (b) => {
        if (!alive) return
        if (!b) return setSt({ url: null, state: 'missing' })
        made = URL.createObjectURL(b)
        setSt({ url: made, state: 'ok' })
      },
      () => alive && setSt({ url: null, state: 'error' }),
    )
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [source, path, kind])
  return st
}

export function MediaView({ source, path, kind, info, webUrl }: { source: Source; path: string; kind: FileKind; info?: FileInfo; webUrl: string | null }) {
  const max = MEDIA_MAX[kind] ?? 0
  if (info && max && info.size > max)
    return (
      <Callout icon="info">
        {humanSize(info.size)} is too big to open here (up to {humanSize(max)}).{' '}
        {webUrl && (
          <a href={webUrl} target="_blank" rel="noopener noreferrer">
            Open it on GitHub
          </a>
        )}
      </Callout>
    )
  return <MediaBody source={source} path={path} kind={kind} />
}

function MediaBody({ source, path, kind }: { source: Source; path: string; kind: FileKind }) {
  const { url, state } = useMediaUrl(source, path, kind)
  const [actual, setActual] = useState(false)
  if (state === 'loading') return <span className="sk fv-media-sk" aria-label="Loading" />
  if (state !== 'ok' || !url) return <Callout icon="alert">{state === 'missing' ? 'This file could not be read from the repo.' : 'Loading this file failed. Check the connection and reload.'}</Callout>
  const name = path.split('/').pop() || path
  if (kind === 'video') return <video className="fv-media" src={url} controls playsInline preload="metadata" aria-label={name} />
  if (kind === 'audio') return <audio className="fv-audio" src={url} controls preload="metadata" aria-label={name} />
  return (
    <figure className="fv-fig">
      <button className={'fv-imgbtn' + (actual ? ' actual' : '')} type="button" onClick={() => setActual((a) => !a)} aria-pressed={actual} title={actual ? 'Fit to the page' : 'Show at full size'}>
        <img src={url} alt={name} decoding="async" />
      </button>
      <figcaption className="sm muted">
        {actual ? 'Full size: click to fit' : 'Fitted: click for full size'}
        {kind === 'image' && (
          <>
            {' · '}
            {/* a raster blob typed from the extension: opening it can never run anything (SVG gets no such link) */}
            <a href={url} target="_blank" rel="noopener noreferrer">
              Open in a new tab
            </a>
          </>
        )}
      </figcaption>
    </figure>
  )
}

type Size = 'fit' | 'phone' | 'wide'

/** A web page from the repo, live, in a frame that is sealed off from HQ: scripts run in an opaque origin (no access
 *  to this app, its storage or the token) and reach no network except Google Fonts. */
export function PageFrame({ source, path, html, files }: { source: Source; path: string; html: string; files: FileInfo[] }) {
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f.size])), [files])
  const [pv, setPv] = useState<Preview | null>(null)
  const [err, setErr] = useState('')
  const [n, setN] = useState(0)
  const portrait = /9\s*\/\s*16|1080\s*[x×,]\s*1920|1920px/i.test(html)
  const [size, setSize] = useState<Size>(portrait ? 'phone' : 'fit')
  useEffect(() => {
    let alive = true
    setPv(null)
    setErr('')
    buildPreview(html, path, {
      has: (p) => byPath.has(p),
      size: (p) => byPath.get(p) ?? 0,
      text: (p) => source.read(p),
      bytes: (p) => (extOf(p) === 'svg' ? readSvg(source, p) : kindOf(p) === 'image' ? readMedia(source, p) : Promise.resolve(null)),
    }).then(
      (r) => alive && setPv(r),
      (e) => alive && setErr(String(e?.message || e)),
    )
    return () => {
      alive = false
    }
  }, [html, path, source, byPath])
  if (err) return <Callout icon="alert">The preview could not be built: {err}</Callout>
  if (!pv) return <span className="sk fv-media-sk" aria-label="Building the preview" />
  const style = size === 'phone' ? { height: '78vh', width: 'calc(78vh * 9 / 16)', maxWidth: '100%' } : size === 'wide' ? { aspectRatio: '16 / 9', height: 'auto' } : { height: '72vh' }
  return (
    <div className="fv-page">
      <div className="fv-bar">
        <Segmented
          label="Frame size"
          value={size}
          onChange={setSize}
          options={[
            ['fit', <><Square className="i s" aria-hidden />Fit</>],
            ['phone', <><Smartphone className="i s" aria-hidden />Phone 9:16</>],
            ['wide', <><Monitor className="i s" aria-hidden />Wide 16:9</>],
          ]}
        />
        <button className="btn sm ghost" type="button" onClick={() => setN((x) => x + 1)} title="Run the page again from the start">
          <RotateCw className="i s" aria-hidden />
          Restart
        </button>
      </div>
      <iframe
        key={n}
        className="fv-frame"
        title={`Preview of ${path.split('/').pop()}`}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={pv.doc}
        style={style}
      />
      <p className="sm muted fv-foot">
        Runs sealed off: no access to HQ, no network except Google Fonts.
        {pv.inlined.length > 0 && ` ${pv.inlined.length} local file${pv.inlined.length === 1 ? '' : 's'} put inline.`}
      </p>
      {(pv.missing.length > 0 || pv.skipped.length > 0) && (
        <details className="fv-tree">
          <summary className="sm">
            {pv.missing.length + pv.skipped.length} file{pv.missing.length + pv.skipped.length === 1 ? '' : 's'} not in the preview
          </summary>
          <ul className="sm">
            {pv.missing.map((m) => (
              <li key={'m' + m}>{m}: not in the repo</li>
            ))}
            {pv.skipped.map((m) => (
              <li key={'s' + m}>{m}: too big to put inline</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
