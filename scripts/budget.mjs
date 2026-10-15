#!/usr/bin/env node
// Bundle budget (spec §9), run after `vite build`: gzip sizes of dist/assets.
//   entry  = the index script + every chunk it imports statically (what the first paint downloads)  ≤ 150 kB
//   chunk  = each lazily loaded JS chunk (route pages, shared lazy code)                              ≤ 40 kB
//   css    = all CSS files together                                                                  ≤ 25 kB
// kB = 1000 bytes (the unit Vite prints). Exit 1 when anything is over. `--json` prints the numbers as JSON.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const LIMIT = { entry: 150, chunk: 40, css: 25 }
const args = process.argv.slice(2)
const json = args.includes('--json')
const here = path.dirname(fileURLToPath(import.meta.url))
const dist = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(here, '..', 'dist'))
const assets = path.join(dist, 'assets')

if (!fs.existsSync(path.join(dist, 'index.html')) || !fs.existsSync(assets)) {
  console.error(`budget: no build at ${dist} (run \`npx vite build\` first)`)
  process.exit(1)
}

const kb = (n) => Math.round(n / 10) / 100
const gz = (file) => zlib.gzipSync(fs.readFileSync(path.join(assets, file)), { level: 9 }).length
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const local = (href) => path.basename(href.split('?')[0])

// Entry = <script type=module src> + its static imports (transitively). Dynamic import("…") does not count.
const entryFile = local((html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/) || [])[1] || '')
if (!entryFile) {
  console.error('budget: no module entry script in dist/index.html')
  process.exit(1)
}
const STATIC_IMPORT = /(?:\bfrom|\bimport)\s*["'](\.\/[^"']+\.js)["']/g
const entry = new Set()
const queue = [entryFile]
while (queue.length) {
  const f = queue.shift()
  if (entry.has(f) || !fs.existsSync(path.join(assets, f))) continue
  entry.add(f)
  const code = fs.readFileSync(path.join(assets, f), 'utf8')
  for (const m of code.matchAll(STATIC_IMPORT)) queue.push(local(m[1]))
}

const files = fs.readdirSync(assets)
const js = files.filter((f) => f.endsWith('.js'))
const css = files.filter((f) => f.endsWith('.css'))
const entryBytes = [...entry].reduce((a, f) => a + gz(f), 0)
const chunks = js.filter((f) => !entry.has(f)).map((f) => ({ file: f, gz: gz(f) })).sort((a, b) => b.gz - a.gz)
const cssBytes = css.reduce((a, f) => a + gz(f), 0)

const over = []
if (kb(entryBytes) > LIMIT.entry) over.push(`entry ${kb(entryBytes)} kB > ${LIMIT.entry} kB`)
for (const c of chunks) if (kb(c.gz) > LIMIT.chunk) over.push(`chunk ${c.file} ${kb(c.gz)} kB > ${LIMIT.chunk} kB`)
if (kb(cssBytes) > LIMIT.css) over.push(`css ${kb(cssBytes)} kB > ${LIMIT.css} kB`)

const report = {
  entry: { kB: kb(entryBytes), limit: LIMIT.entry, files: [...entry].map((f) => ({ file: f, kB: kb(gz(f)) })) },
  chunks: { largest: chunks.slice(0, 5).map((c) => ({ file: c.file, kB: kb(c.gz) })), count: chunks.length, limit: LIMIT.chunk },
  css: { kB: kb(cssBytes), limit: LIMIT.css, files: css.map((f) => ({ file: f, kB: kb(gz(f)) })) },
  ok: !over.length,
  over,
}
if (json) console.log(JSON.stringify(report, null, 2))
else {
  const row = (label, v, lim) => `${(v <= lim ? 'ok  ' : 'OVER').padEnd(5)}${label.padEnd(44)}${String(v).padStart(8)} kB  (≤ ${lim})`
  console.log('Bundle budget (gzip)')
  console.log(row(`entry: ${[...entry].join(' + ')}`.slice(0, 44), kb(entryBytes), LIMIT.entry))
  for (const c of chunks.slice(0, 8)) console.log(row(`chunk: ${c.file}`, kb(c.gz), LIMIT.chunk))
  if (chunks.length > 8) console.log(`     … ${chunks.length - 8} smaller chunks`)
  console.log(row(`css: ${css.join(' + ')}`.slice(0, 44), kb(cssBytes), LIMIT.css))
  console.log(over.length ? `\nOver budget:\n- ${over.join('\n- ')}` : '\nWithin budget.')
}
process.exit(over.length ? 1 : 0)
