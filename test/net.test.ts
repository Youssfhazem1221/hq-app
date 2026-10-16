// A stale tab after a deploy (lib/net.ts) and GitHub calls that got no answer, in plain words (lib/sync.ts netError).
import test from 'node:test'
import assert from 'node:assert/strict'
import { app } from './helpers.ts'

const N = await app('lib/net')
const S = await app('lib/sync')

test('isStaleChunk: page files missing after a deploy (Chrome, Firefox, Safari, CSS), nothing else', () => {
  for (const m of [
    'Failed to fetch dynamically imported module: https://x.github.io/hq-app/assets/Project-DL8AiPqe.js',
    'error loading dynamically imported module: https://x.github.io/hq-app/assets/Ask-1.js',
    'Importing a module script failed.',
    'Unable to preload CSS for /hq-app/assets/Docs-2.css',
  ])
    assert.equal(N.isStaleChunk(new TypeError(m)), true, m)
  for (const m of ['Failed to fetch', 'GitHub 502: bad gateway', '', null]) assert.equal(N.isStaleChunk(m && new TypeError(m)), false, String(m))
})

test('netError: no answer, or a bad token character, in plain words; anything else unchanged', () => {
  assert.match(S.netError(new TypeError('Failed to fetch')).message, /^Can’t reach GitHub right now/)
  assert.match(S.netError(new TypeError('Load failed'), 'the AI').message, /^Can’t reach the AI/)
  assert.match(S.netError(new TypeError('NetworkError when attempting to fetch resource.')).message, /^Can’t reach GitHub/)
  const bad = "Failed to execute 'fetch' on 'Window': Failed to read the 'headers' property from 'RequestInit': String contains non ISO-8859-1 code point."
  assert.equal(S.netError(new TypeError(bad)).message, S.BAD_TOKEN_MSG)
  const other = new Error('something else')
  assert.equal(S.netError(other), other)
})
