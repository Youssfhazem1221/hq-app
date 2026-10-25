// File viewer (phase 2 of HQ as a portfolio): lib/files (kinds, the file list from the dev server and from GitHub),
// lib/data-shape (JSON / TSV / CSV → sections, records, charts) and lib/html-preview (a page made self-contained for
// the sandboxed frame), plus the dev server's /__hq/tree, /__hq/raw media types and .svg text reads. Synthetic data only.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { app, rm, startLocal, tmpDir } from './helpers.ts'

const F = await app('lib/files')
const D = await app('lib/data-shape')
const H = await app('lib/html-preview')

// ---- lib/files ----------------------------------------------------------------------------------------------------

test('kindOf / humanSize / MEDIA_TYPE: by extension, case-insensitive; prototype names are not kinds', () => {
  const kinds = { 'a/b.JSON': 'json', 'x.tsv': 'table', 'x.csv': 'table', 'p.JPG': 'image', 'v.svg': 'svg', 'm.mp4': 'video', 's.mp3': 'audio', 'i.html': 'html', 'c.mjs': 'text', 'n.md': 'md', 'z.bin': 'other', constructor: 'other', 'x.toString': 'other', '': 'other' }
  for (const [p, k] of Object.entries(kinds)) assert.equal(F.kindOf(p), k, p)
  assert.equal(F.MEDIA_TYPE.svg, undefined, 'svg is never a raw media type')
  assert.equal(F.MEDIA_TYPE.html, undefined)
  assert.deepEqual([F.humanSize(512), F.humanSize(13938), F.humanSize(2_819_173)], ['512 B', '13.9 KB', '2.8 MB'])
})

test('listFiles (GitHub): one tree call, token only in the header, dot-folders / app/ / node_modules dropped; 304 → the cached list', async () => {
  const real = globalThis.fetch
  const calls: { url: string; headers: Record<string, string> }[] = []
  globalThis.fetch = (async (url: any, init: any = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} })
    if (init.headers?.['If-None-Match'] === 'W/"t1"') return new Response(null, { status: 304 })
    return new Response(
      JSON.stringify({
        tree: [
          { path: 'projects/a/data/x.json', type: 'blob', size: 120 },
          { path: 'projects/a/data', type: 'tree' },
          { path: '.hq/realtime.json', type: 'blob', size: 90 },
          { path: 'app/src/x.ts', type: 'blob', size: 5 },
          { path: 'projects/a/site/node_modules/y.js', type: 'blob', size: 5 },
          { path: 'projects/a/cover.png', type: 'blob', size: 2048 },
        ],
      }),
      { status: 200, headers: { etag: 'W/"t1"' } },
    )
  }) as typeof fetch
  try {
    const src = { kind: 'github', auth: { token: 'tok_secret_9', repo: 'o/r', branch: 'main' } }
    const first = await F.listFiles(src)
    assert.deepEqual(first, [{ path: 'projects/a/cover.png', size: 2048 }, { path: 'projects/a/data/x.json', size: 120 }])
    assert.equal(calls[0].url, 'https://api.github.com/repos/o/r/git/trees/main?recursive=1')
    assert.equal(calls[0].headers.Authorization, 'Bearer tok_secret_9')
    assert.ok(!calls[0].url.includes('tok_secret_9'), 'the token never goes in the URL')
    const again = await F.listFiles(src)
    assert.equal(calls[1].headers['If-None-Match'], 'W/"t1"')
    assert.deepEqual(again, first, '304 → same list')
  } finally {
    globalThis.fetch = real
  }
})

const BYTES = Uint8Array.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0xff, 0xfe, 0x80])

test('dev server: /__hq/tree lists every file with its size (no dot-folders, app/, keys); /__hq/raw serves video + audio typed; svg is text only', async () => {
  const root = tmpDir('tree')
  const put = (rel: string, data: Uint8Array | string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), data)
  }
  put('projects/a/project.md', '---\ntitle: A\n---\n')
  put('projects/a/data/x.json', '{"a":1}')
  put('projects/a/media/clip.mp4', BYTES)
  put('projects/a/media/beat.MP3', BYTES)
  put('projects/a/media/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
  put('projects/a/page.html', '<p>hi</p>')
  put('.hq/realtime.json', '{}')
  put('app/x.json', '{}')
  put('projects/a/id_rsa', 'secret')
  const local = await startLocal(root, 'alice')
  try {
    const { LocalSource } = await app('lib/source')
    const src = new LocalSource()
    const list = await F.listFiles(src)
    const paths = list.map((f: { path: string }) => f.path)
    for (const p of ['projects/a/project.md', 'projects/a/data/x.json', 'projects/a/media/clip.mp4', 'projects/a/media/logo.svg', 'projects/a/page.html']) assert.ok(paths.includes(p), p)
    for (const p of ['.hq/realtime.json', 'app/x.json', 'projects/a/id_rsa']) assert.ok(!paths.includes(p), `not listed: ${p}`)
    assert.equal(list.find((f: { path: string }) => f.path === 'projects/a/data/x.json').size, 7)
    const clip = await F.readMedia(src, 'projects/a/media/clip.mp4')
    assert.equal(clip.type, 'video/mp4')
    assert.deepEqual(new Uint8Array(await clip.arrayBuffer()), BYTES)
    assert.equal((await F.readMedia(src, 'projects/a/media/beat.MP3')).type, 'audio/mpeg')
    const r = await fetch(local.base + '/__hq/raw?path=' + encodeURIComponent('projects/a/media/clip.mp4'))
    assert.equal(r.headers.get('content-type'), 'video/mp4')
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
    for (const p of ['projects/a/media/logo.svg', 'projects/a/page.html', 'projects/a/data/x.json'])
      assert.equal((await fetch(local.base + '/__hq/raw?path=' + encodeURIComponent(p))).status, 404, `no raw bytes for ${p}`)
    const svg = await fetch(local.base + '/__hq/read?path=' + encodeURIComponent('projects/a/media/logo.svg'))
    assert.equal(svg.status, 200)
    assert.match(svg.headers.get('content-type') || '', /^text\/plain/, 'svg is served as plain text, so it never runs')
    const asImg = await F.readSvg(src, 'projects/a/media/logo.svg')
    assert.equal(asImg.type, 'image/svg+xml', 'typed for an <img> only')
  } finally {
    await local.close()
    rm(root)
  }
})

// ---- lib/data-shape ------------------------------------------------------------------------------------------------

const ledger = {
  total: 1.5,
  items: [
    ...Array.from({ length: 8 }, (_, i) => ({ what: `img sheet-${i} 2K`, usd: 0.1, at: `2026-10-1${i % 3}T10:00:00Z` })),
    ...Array.from({ length: 4 }, (_, i) => ({ what: `tts line ${i}`, usd: 0.05, at: '2026-10-12T11:00:00Z' })),
    { what: 'music bed', usd: 0.3, at: '2026-10-13T09:00:00Z' },
  ],
}

test('jsonSections: settings, then records with a time chart, a group chart (first word) and totals for an amount column', () => {
  const s = D.jsonSections(ledger)
  assert.deepEqual(s.map((x: any) => x.kind), ['props', 'records'])
  const recs = s[1].recs
  assert.equal(recs.title, 'what')
  assert.equal(recs.time, 'at')
  assert.equal(recs.num, 'usd')
  assert.equal(recs.measure, true)
  assert.deepEqual(recs.group, { key: 'what', firstWord: true })
  const t = D.timeSpec(recs)
  assert.equal(t.title, 'USD per day')
  assert.equal(t.unit, '$')
  assert.deepEqual(t.labels, ['Oct 10', 'Oct 11', 'Oct 12', 'Oct 13'])
  const g = D.groupSpec(recs)
  assert.deepEqual(g.labels, ['img', 'music', 'tts'])
  assert.equal(g.title, 'USD by kind')
  const stats = Object.fromEntries(D.recordStats(recs).map((x: any) => [x.label, x.value]))
  assert.equal(stats.Rows, '13')
  assert.equal(stats['Total USD'], '$1.3')
  assert.equal(stats.Dates, '2026-10-10 → 2026-10-13')
})

test('jsonSections: about text → note, bilingual objects → columns, a map of objects → keyed cards named by their key, tuples → x/y', () => {
  const s = D.jsonSections({
    _about: 'Every film on the portfolio.',
    works: [
      { id: 'a', brand: 'x', title: { en: 'One', ar: 'واحد' }, line: { en: 'First line here', ar: 'سطر' }, poster: 1.5 },
      { id: 'b', brand: 'x', title: { en: 'Two', ar: 'اثنان' }, line: { en: 'Second line', ar: 'سطر' }, poster: 2 },
      { id: 'c', brand: 'y', title: { en: 'Three', ar: 'ثلاثة' }, line: { en: 'Third line', ar: 'سطر' }, poster: 3 },
      { id: 'd', brand: 'y', title: { en: 'Four', ar: 'أربعة' }, line: { en: 'Fourth line', ar: 'سطر' }, poster: 4 },
    ],
    takes: { V4_t1: { file: 'v.wav', key: 'A minor', seconds: 30 }, A_t1: { file: 'a.wav', key: 'C major', seconds: 28 } },
    centers: { piggy: [267, 251], wallet: [710, 251] },
    hero: ['a', 'b'],
  })
  assert.deepEqual(s.map((x: any) => [x.kind, x.label]), [['note', 'About'], ['records', 'Works'], ['records', 'Takes'], ['records', 'Centers'], ['chips', 'Hero']])
  const works = s[1].recs
  assert.equal(works.title, 'title.en')
  assert.equal(works.sub, 'line.en')
  assert.equal(works.measure, false, 'poster is a time, not an amount')
  assert.deepEqual(D.groupSpec(works).labels.sort(), ['x', 'y'])
  assert.equal(D.groupSpec(works).title, 'Rows by brand', 'not "Poster by brand": non-amounts are counted, not summed')
  const takes = s[2].recs
  assert.equal(takes.title, '__key', 'a map is named by its own keys, not by a field called key')
  assert.equal(takes.cols[0].label, 'ID', 'the map key is an ID (a field may itself be called "key")')
  assert.equal(D.groupSpec(works, 'Works').title, 'Works by brand', 'counted rows are named by the section')
  assert.deepEqual(s[3].recs.cols.map((c: any) => c.key), ['__key', 'x', 'y'])
  assert.equal(D.groupSpec(s[3].recs), null, 'one row per group is not a group')
})

test('jsonSections: long template strings one level down become notes; deep mixed objects become a tree; > 24 parts fold', () => {
  const s = D.jsonSections({ defaults: { size: '2K', templates: { sheet: 'x'.repeat(200), hook: 'y'.repeat(200) }, deep: { a: { b: { c: 1 } }, d: [1, { e: 2 }] } } })
  const kinds = s.map((x: any) => `${x.kind}:${x.label}`)
  assert.ok(kinds.includes('note:Defaults › Templates › Sheet'), kinds.join(' | '))
  assert.ok(kinds.some((k: string) => k.startsWith('tree:')), kinds.join(' | '))
  const many = D.jsonSections(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, [i, i + 1, i + 2]])))
  assert.equal(many.length, D.MAX_SECTIONS)
  assert.equal(many.at(-1).kind, 'tree')
})

test('jsonSections / jsonTable never throw and always give a view', () => {
  const odd: unknown[] = [null, 0, 'x', [], {}, [[]], [null, 1, 'a', {}], { a: [] }, { a: { b: [] } }, Array.from({ length: 3 }, () => ({})), { __proto__: { x: 1 } }, [1e308, -0, NaN]]
  for (const v of odd) {
    const s = D.jsonSections(v)
    assert.ok(Array.isArray(s) && s.length >= 1, JSON.stringify(v))
    const t = D.jsonTable(v)
    assert.ok(t.recs && Array.isArray(t.recs.rows))
  }
  const leaves = D.jsonTable({ a: { b: 1, c: { d: true, e: 'x' } } })
  assert.deepEqual(leaves.recs.rows.map((r: any) => r.path), ['a.b', 'a.c.d', 'a.c.e'], 'no records → every leaf as a Path · Value row')
})

test('TSV without a header: columns named by what they hold; NA is empty; top chart by the number, named by the longest text', () => {
  const tsv = ['13000\tNucT9TK9Ds4\tNA\tThe Best Advice I Ever Got', '106000\tStctBbhyWFE\tNA\tI Don’t Know How To Advertise', '8900\tvfnSh0Fimus\tNA\tJust Take Action', '4200000\tq1W2e3R4t5Y\tNA\tShould I Sell My Company?'].join('\n')
  const recs = D.delimitedRecords(D.parseDelimited(tsv, 'tsv'), 'tsv')
  assert.deepEqual(recs.cols.map((c: any) => `${c.label}:${c.type}`), ['Number:number', 'Video:yt', 'Empty:empty', 'Text:text'])
  assert.equal(recs.rows.length, 4, 'no row taken as a header')
  const top = D.topSpec(recs)
  assert.equal(top.labels[0], 'Should I Sell My Company?')
  assert.deepEqual(top.series[0].data.slice(0, 2), [4200000, 106000])
})

test('CSV: a header row, "quoted, cells", "" escapes and ; separators', () => {
  const csv = 'name,views,note\n"Smith, J",1200,"said ""hi"""\nLee,800,\n'
  const recs = D.delimitedRecords(D.parseDelimited(csv, 'csv'), 'csv')
  assert.deepEqual(recs.cols.map((c: any) => c.label), ['name', 'views', 'note'])
  assert.equal(recs.rows[0].c0, 'Smith, J')
  assert.equal(recs.rows[0].c2, 'said "hi"')
  assert.equal(recs.num, 'c1')
  assert.equal(recs.measure, true, 'a header named views is an amount')
  assert.deepEqual(D.parseDelimited('a;b;c\n1;2;3', 'csv'), [['a', 'b', 'c'], ['1', '2', '3']])
  assert.deepEqual(D.delimitedRecords(D.parseDelimited('city,country\nCairo,Egypt\nGiza,Egypt', 'csv'), 'csv').cols.map((c: any) => c.label), ['city', 'country'], 'a text-only CSV keeps its header')
})

test('jsonTokens: keys, strings, numbers, literals and punctuation rebuild the exact text', () => {
  // raw text, not JSON.stringify output: it would print -2.5e3 as -2500
  const pretty = '{\n  "a": 1,\n  "b\\"q": "x\\\\\\"y",\n  "c": [true, null, -2.5e3]\n}'
  const toks = D.jsonTokens(pretty)
  assert.equal(toks.map((t: any) => t.s).join(''), pretty)
  assert.deepEqual(toks.filter((t: any) => t.t === 'key').map((t: any) => t.s), ['"a"', '"b\\"q"', '"c"'])
  assert.ok(toks.some((t: any) => t.t === 'num' && t.s === '-2.5e3'))
  assert.ok(toks.some((t: any) => t.t === 'lit' && t.s === 'null'))
})

// ---- lib/html-preview ---------------------------------------------------------------------------------------------

const files: Record<string, string> = {
  'projects/y/kit/engine/paper.css': 'body{color:red}</style><script>alert(1)</script>',
  'projects/y/kit/engine/parts.js': 'window.parts = "</script><img src=x onerror=alert(1)>"',
  'projects/y/site/public/css/site.css': '.a{}',
}
const io = {
  has: (p: string) => p in files || p === 'projects/y/videos/01/pic.png',
  size: (p: string) => (files[p] || '').length + (p.endsWith('.png') ? 4 : 0),
  text: async (p: string) => files[p] ?? null,
  bytes: async (p: string) => (p.endsWith('.png') ? new Blob([Uint8Array.from([137, 80, 78, 71])]) : null),
}

test('buildPreview: local CSS, scripts and images inline (escaped); remote ones stay; CSP + no-referrer first in <head>', async () => {
  const html = [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="stylesheet" href="../../kit/engine/paper.css">',
    '<link href="https://fonts.googleapis.com/css2?family=Archivo" rel="stylesheet">',
    '</head><body><img src="pic.png" alt="p"><img src="https://x.invalid/a.png">',
    '<script src="../../kit/engine/parts.js" defer></script><script src="../../kit/engine/missing.js"></script>',
    '<script>inline()</script></body></html>',
  ].join('\n')
  const out = await H.buildPreview(html, 'projects/y/videos/01/index.html', io)
  assert.deepEqual(out.inlined.sort(), ['projects/y/kit/engine/paper.css', 'projects/y/kit/engine/parts.js', 'projects/y/videos/01/pic.png'])
  assert.deepEqual(out.missing, ['../../kit/engine/missing.js'])
  assert.ok(out.doc.indexOf('Content-Security-Policy') < out.doc.indexOf('<meta charset'), 'the policy comes first in <head>')
  assert.ok(out.doc.includes(H.PREVIEW_CSP))
  assert.ok(out.doc.includes('<meta name="referrer" content="no-referrer">'))
  assert.ok(out.doc.includes('<style data-from="projects/y/kit/engine/paper.css">'))
  assert.ok(!/<\/style><script>alert/.test(out.doc), 'an inlined stylesheet cannot close its <style> early')
  assert.ok(out.doc.includes('<\\/script><img src=x'), 'an inlined script cannot close its <script> early')
  assert.ok(!/<script[^>]*\bdefer\b/.test(out.doc) && !/src="\.\.\/\.\.\/kit\/engine\/parts\.js"/.test(out.doc))
  assert.ok(out.doc.includes('src="data:image/png;base64,iVBORw=="'))
  assert.ok(out.doc.includes('https://fonts.googleapis.com/css2?family=Archivo'), 'remote font CSS kept (the policy allows it)')
  assert.ok(out.doc.includes('src="https://x.invalid/a.png"'), 'remote image left as is (the policy blocks it)')
  assert.ok(out.doc.includes('<script>inline()</script>'))
})

test('localTarget: relative to the page, "/x" from the nearest public/ folder, never a scheme or a backslash', () => {
  assert.equal(H.localTarget('projects/y/site/public/index.html', '/css/site.css'), 'projects/y/site/public/css/site.css')
  assert.equal(H.localTarget('projects/y/a/b.html', '../c.js?v=2#x'), 'projects/y/c.js')
  assert.equal(H.localTarget('a.html', '/x.js'), 'x.js')
  for (const u of ['https://a.b/c.js', '//cdn/x.js', 'data:text/css,a', 'javascript:alert(1)', '#top', 'a\\b.js', '%E0%A4%A.js']) assert.equal(H.localTarget('a/b.html', u), null, u)
})

test('buildPreview: size caps skip big files, a page without <head> still gets the policy', async () => {
  const big = { ...io, size: () => 3_000_001 }
  const out = await H.buildPreview('<link rel="stylesheet" href="../../kit/engine/paper.css"><p>x</p>', 'projects/y/videos/01/index.html', big)
  assert.deepEqual(out.skipped, ['projects/y/kit/engine/paper.css'])
  assert.ok(out.doc.startsWith('<!doctype html><head><meta http-equiv="Content-Security-Policy"'))
  assert.ok(out.doc.includes('href="../../kit/engine/paper.css"'), 'a skipped stylesheet stays a (blocked) link')
})
