// Docs reader images: a note may show an image that is a file in the data repo (![Props](props_flat.jpg)), and nothing
// else. lib/md-html.ts resolves the href against the note's folder and leaves a <span data-repo-img> placeholder; the
// reader reads the bytes through the Source (local dev server route / GitHub raw media type, token in a header).
// Remote URLs, schemes, ".." above the repo root, dot-folders and non-image files never become a placeholder or a read.
// Synthetic data only (temp folders, made-up bytes).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { app, rm, startLocal, tmpDir } from './helpers.ts'
import { imageType, mdToRawHtml, PURIFY, repoImagePath } from '../src/lib/md-html.ts'

const NOTE = 'projects/demo/kit/assets/sheets/README.md'

test('repoImagePath: relative to the note folder, ./ and ../ inside the repo, /x from the repo root, encoded names', () => {
  assert.equal(repoImagePath(NOTE, 'props_flat.jpg'), 'projects/demo/kit/assets/sheets/props_flat.jpg')
  assert.equal(repoImagePath(NOTE, './img/a.png'), 'projects/demo/kit/assets/sheets/img/a.png')
  assert.equal(repoImagePath(NOTE, '../../b.webp'), 'projects/demo/kit/b.webp')
  assert.equal(repoImagePath(NOTE, '../../../../../top.gif'), 'top.gif', 'up to the repo root is fine')
  assert.equal(repoImagePath(NOTE, '/notes/pics/c.jpeg'), 'notes/pics/c.jpeg')
  assert.equal(repoImagePath(NOTE, 'my%20pic.PNG'), 'projects/demo/kit/assets/sheets/my pic.PNG')
  assert.equal(repoImagePath(NOTE, 'my pic.png'), 'projects/demo/kit/assets/sheets/my pic.png', '<my pic.png> form')
  assert.equal(repoImagePath(NOTE, 'a.png#zoom'), 'projects/demo/kit/assets/sheets/a.png', 'a #fragment is dropped')
  assert.equal(repoImagePath('README.md', 'a.png'), 'a.png', 'a note at the repo root')
})

test('repoImagePath refuses schemes, //host, backslashes, queries, escapes above the root, dot-folders, other types', () => {
  const bad = [
    'https://exfil.invalid/a.png',
    'http://127.0.0.1:5173/__hq/raw?path=a.png',
    'HTTPS://x.invalid/a.png',
    'data:image/png;base64,iVBORw0KGgo=',
    'blob:https://app.invalid/1234',
    'javascript:alert(1)//a.png',
    'file:///C:/Users/a.png',
    'C:/Users/a.png',
    'c:a.png',
    '//exfil.invalid/a.png',
    '\\\\host\\share\\a.png',
    '/\\exfil.invalid/a.png',
    'img\\a.png',
    '%2F%2Fexfil.invalid/a.png',
    'img%5Ca.png',
    'a.png?raw=1',
    'a%3Fraw=1.png',
    'a.png%3Astream.png',
    'a%00.png',
    '../../../../../../escape.png',
    '/../escape.png',
    '..%2F..%2F..%2F..%2F..%2F..%2Fescape.png',
    '%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/escape.png',
    '.git/objects/a.png',
    '/.hq/a.png',
    'img/.hidden/a.png',
    'logo.svg',
    'page.html',
    'notes.md',
    'a.png.md',
    'a.png/',
    'a.jpgx',
    'pic',
    '',
    '   ',
    '%E0%A4%A.png',
    'a'.repeat(600) + '.png',
  ]
  for (const href of bad) assert.equal(repoImagePath(NOTE, href), null, `refused: ${href}`)
  assert.equal(repoImagePath('', 'a.png'), 'a.png', 'no base = from the repo root')
  assert.equal(repoImagePath('README.md', '../a.png'), null, '.. above the root of a root note')
})

test('imageType: the five image types only, by extension, never SVG or HTML', () => {
  assert.equal(imageType('a/b.png'), 'image/png')
  assert.equal(imageType('a/b.JPG'), 'image/jpeg')
  assert.equal(imageType('b.jpeg'), 'image/jpeg')
  assert.equal(imageType('b.webp'), 'image/webp')
  assert.equal(imageType('b.gif'), 'image/gif')
  for (const p of ['b.svg', 'b.html', 'b.md', 'b.png.html', 'constructor', 'b.toString', '']) assert.equal(imageType(p), null, p)
})

test('placeholder: a repo image becomes <span data-repo-img> around the old plain link; no <img>, nothing fetched', () => {
  const html = mdToRawHtml('Sheet: ![Props](props_flat.jpg)', NOTE)
  assert.ok(
    html.includes('<span data-repo-img="projects/demo/kit/assets/sheets/props_flat.jpg" data-alt="Props"><a href="props_flat.jpg">Props</a></span>'),
    html,
  )
  assert.ok(!/<img\b/i.test(html), 'no <img> from markdown')
  assert.ok(!/\ssrc=/i.test(html), 'no src attribute')
})

test('placeholder: remote and refused images stay plain links; without a note path nothing changes', () => {
  const md = '![r](https://exfil.invalid/a.png?d=notes) ![up](../../../../../../x.png) ![v](logo.svg) ![d](.git/a.png)'
  const html = mdToRawHtml(md, NOTE)
  assert.ok(!html.includes('data-repo-img'), html)
  assert.ok(html.includes('<a href="https://exfil.invalid/a.png?d=notes">r</a>'))
  assert.ok(html.includes('<a href="logo.svg">v</a>'))
  const plain = mdToRawHtml('![Props](props_flat.jpg)')
  assert.ok(!plain.includes('data-repo-img'), 'no base → no placeholder (posts and answers rendered without a path)')
  assert.ok(plain.includes('<a href="props_flat.jpg">Props</a>'))
  // the base is per call: a later call without one gets no placeholder
  mdToRawHtml('![a](a.png)', NOTE)
  assert.ok(!mdToRawHtml('![a](a.png)').includes('data-repo-img'))
})

test('placeholder: alt text and paths are escaped (no attribute break-out), raw HTML images are still text', () => {
  const html = mdToRawHtml('![x" onerror="alert(1)](<a b.png>) <img src="a.png" onerror="x()">', NOTE)
  assert.ok(html.includes('data-alt="x&quot; onerror=&quot;alert(1)"'), html)
  assert.ok(html.includes('data-repo-img="projects/demo/kit/assets/sheets/a b.png"'), html)
  assert.ok(!/<img\b/i.test(html), 'raw <img> shows as text')
  assert.ok(html.includes('&lt;img src='), html)
  // DOMPurify keeps data-* attributes (the placeholder survives); <img> and src stay forbidden in markdown output
  assert.ok(!('ALLOW_DATA_ATTR' in PURIFY), 'data attributes not switched off')
  assert.ok(PURIFY.FORBID_TAGS.includes('img') && PURIFY.FORBID_ATTR.includes('src'))
})

test('placeholderPath (reader side) re-checks the attribute: only clean repo image paths', async () => {
  const { placeholderPath } = await app('components/repo-images')
  assert.equal(placeholderPath('projects/demo/a.png'), 'projects/demo/a.png')
  for (const p of [undefined, '', '../a.png', 'a/../b.png', './a.png', 'https://x.invalid/a.png', '//x.invalid/a.png', '.hq/a.png', 'a.svg', 'a%20b.png'])
    assert.equal(placeholderPath(p), null, String(p))
})

/** Made-up bytes that start like a PNG (and include bytes that are not valid UTF-8, so a text read would mangle them). */
const BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28, 0x01, 0x02])

test('LocalSource.readBytes ↔ GET /__hq/raw: exact bytes typed by extension; 404 for anything that is not a repo image', async () => {
  const root = tmpDir('rawimg')
  const outside = tmpDir('rawimg-out')
  const put = (rel: string, data: Uint8Array | string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
    fs.writeFileSync(path.join(root, rel), data)
  }
  put('notes/pics/a.png', BYTES)
  put('notes/pics/b.JPG', BYTES)
  put('notes/pics/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
  put('notes/readme.md', '# hi\n')
  put('.hq/a.png', BYTES)
  put('app/a.png', BYTES)
  fs.writeFileSync(path.join(outside, 'secret.png'), BYTES)
  let linked = false
  try {
    fs.symlinkSync(outside, path.join(root, 'notes', 'link'), 'junction')
    linked = true
  } catch {
    /* no symlinks here: that case is skipped */
  }
  const local = await startLocal(root, 'alice')
  try {
    const { LocalSource } = await app('lib/source')
    const src = new LocalSource()
    const blob = await src.readBytes('notes/pics/a.png')
    assert.ok(blob, 'read')
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), BYTES, 'bytes unchanged')
    assert.equal(blob.type, 'image/png')
    assert.equal((await src.readBytes('notes/pics/b.JPG')).type, 'image/jpeg')
    assert.equal(await src.readBytes('notes/pics/missing.png'), null)
    for (const p of ['notes/pics/logo.svg', 'notes/readme.md', '.hq/a.png', 'app/a.png', '../a.png', 'notes/../../a.png', 'C:/a.png', 'notes\\pics\\a.png'])
      assert.equal(await src.readBytes(p), null, `not served: ${p}`)
    if (linked) assert.equal(await src.readBytes('notes/link/secret.png'), null, 'a link out of the workspace is not followed')
    const r = await fetch(local.base + '/__hq/raw?path=' + encodeURIComponent('notes/pics/a.png'))
    assert.equal(r.headers.get('content-type'), 'image/png')
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
  } finally {
    await local.close()
    rm(root)
    rm(outside)
  }
})

test('GitHubSource.readBytes: contents API with the raw media type, token only in the header; 404 → null', async () => {
  const { GitHubSource } = await app('lib/source')
  const calls: { url: string; headers: Record<string, string> }[] = []
  const real = globalThis.fetch
  globalThis.fetch = (async (url: any, init: any = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} })
    if (String(url).includes('missing')) return new Response('{"message":"Not Found"}', { status: 404 })
    if (String(url).includes('broken')) return new Response('{}', { status: 500 })
    return new Response(BYTES, { status: 200, headers: { 'content-type': 'application/octet-stream' } })
  }) as typeof fetch
  try {
    const gh = new GitHubSource({ owner: 'o', repo: 'r', branch: 'main', token: 'tok_secret_123' })
    const blob = await gh.readBytes('projects/demo/my pic.png')
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), BYTES)
    assert.equal(calls[0].url, 'https://api.github.com/repos/o/r/contents/projects/demo/my%20pic.png?ref=main')
    assert.equal(calls[0].headers.Accept, 'application/vnd.github.raw+json', 'raw media type (works past 1 MB)')
    assert.equal(calls[0].headers.Authorization, 'Bearer tok_secret_123')
    assert.ok(!calls[0].url.includes('tok_secret'), 'no token in the URL')
    assert.equal(await gh.readBytes('missing.png'), null)
    await assert.rejects(gh.readBytes('broken.png'), /GitHub 500/)
  } finally {
    globalThis.fetch = real
  }
})
