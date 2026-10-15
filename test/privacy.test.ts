// A7 · No real logins, names or project slugs in the public app: every app file git would publish (tracked or new, not
// ignored: src/, test/, scripts/, vite.config.ts, index.html, README/DESIGN, .github/…) and the built app/dist are
// scanned for the private workspace's people, employer, business and project names.
// The terms are NOT in this public repo (not even encoded): they load at test time from the private workspace
// (../scripts/test/fixtures/privacy-terms.txt) or from HQ_PRIVACY_TERMS (comma-separated, e.g. a CI secret). Without
// either, the scans skip with a note. Allowed: src/config.ts DEFAULT_REPO (the default data repo, public by design).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { APP } from './helpers.ts'

const TERMS_FILE = path.resolve(APP, '..', 'scripts', 'test', 'fixtures', 'privacy-terms.txt')
const fromEnv = String(process.env.HQ_PRIVACY_TERMS || '').split(',')
const fromFile = fs.existsSync(TERMS_FILE) ? fs.readFileSync(TERMS_FILE, 'utf8').split(/\r?\n/).filter((l) => !l.trim().startsWith('#')) : []
const TERMS = [...new Set([...fromEnv, ...fromFile].map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 3))]
const NO_TERMS = !TERMS.length && 'no privacy terms here (public repo alone): set HQ_PRIVACY_TERMS or run inside the private workspace'
if (NO_TERMS) console.log(`# privacy: ${NO_TERMS}`)

const rel = (f: string) => path.relative(APP, f).split(path.sep).join('/')
const TEXT = /(\.(tsx?|jsx?|mjs|cjs|css|html|json|md|svg|txt|ya?ml)|(^|\/)\.gitignore)$/i
const SKIP = /^(node_modules|dist|\.git)\//

/** The files git would publish from app/ (tracked + untracked, minus ignored). Falls back to a folder walk. */
function publishable(): string[] {
  try {
    const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: APP, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const list = out.split('\n').map((s) => s.trim()).filter(Boolean)
    if (list.length) return list
  } catch {
    /* no git: walk */
  }
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.git') || e.name === '.gstack' ? [] : walk(abs)
      return [rel(abs)]
    })
  return walk(APP)
}

const config = fs.readFileSync(path.join(APP, 'src', 'config.ts'), 'utf8')
const DEFAULT_REPO = config.match(/DEFAULT_REPO\s*=\s*'([^']+)'/)?.[1] || ''

/** Indexes of the terms found in a text (the terms themselves are never printed). */
function hits(text: string) {
  const low = text.toLowerCase()
  return TERMS.map((t, i) => (low.includes(t) ? i : -1)).filter((i) => i >= 0)
}

test('A7 · no app file git would publish has real names, logins or project slugs (config DEFAULT_REPO excepted)', { skip: NO_TERMS }, () => {
  const files = publishable().filter((f) => TEXT.test(f) && !SKIP.test(f))
  assert.ok(files.includes('vite.config.ts') && files.some((f) => f.startsWith('test/')) && files.some((f) => f.startsWith('src/')), 'the scan covers src/, test/ and vite.config.ts')
  const bad: string[] = []
  for (const r of files) {
    const abs = path.join(APP, ...r.split('/'))
    if (!fs.existsSync(abs)) continue // deleted in the working tree
    let text = fs.readFileSync(abs, 'utf8')
    if (r === 'src/config.ts') text = text.split('\n').filter((l) => !/^export const DEFAULT_REPO\s*=/.test(l)).join('\n')
    const h = hits(text)
    if (h.length) bad.push(`${r}: term #${h.join(', #')}`)
  }
  assert.deepEqual(bad, [], 'real names/slugs in the public app repo')
})

test('A7 · built app/dist has no real names, logins or slugs except DEFAULT_REPO', { skip: NO_TERMS || (!fs.existsSync(path.join(APP, 'dist')) && 'no build') }, () => {
  assert.ok(DEFAULT_REPO, 'DEFAULT_REPO found in src/config.ts')
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
  const bad: string[] = []
  for (const f of walk(path.join(APP, 'dist')).filter((x) => TEXT.test(x))) {
    const text = fs.readFileSync(f, 'utf8').split(DEFAULT_REPO).join('')
    const h = hits(text)
    if (h.length) bad.push(`${rel(f)}: term #${h.join(', #')}`)
  }
  assert.deepEqual(bad, [])
})

test('the scanner finds a planted term and ignores the synthetic team (self-check)', { skip: NO_TERMS }, () => {
  assert.deepEqual(hits(`const x = '${TERMS[0].toUpperCase()}'`), [0])
  assert.deepEqual(hits('alice bob carol demo solo'), [])
})

test('this public test file carries no term list (plain, base64 or hashed)', () => {
  const src = fs.readFileSync(path.join(APP, 'test', 'privacy.test.ts'), 'utf8')
  assert.doesNotMatch(src, /Buffer\.from\([^)]*base64|atob\(|createHash\(/, 'no decoded or hashed list')
  assert.doesNotMatch(src, /\b[0-9a-f]{40,64}\b/, 'no hashes')
  if (!NO_TERMS) assert.deepEqual(hits(src), [], 'no term in plain text')
})
