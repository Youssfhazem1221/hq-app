// Commits in human words: Home "Recent changes", project activity and the change toast (GitHub mode). Plain module (no
// React), so the app shell can use it without pulling the work pages in. Never shows a file id or a tool prefix.
import type { Commit } from './source'

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

const AREA: [RegExp, string][] = [
  [/^docs?\b/i, 'updated the docs'],
  [/^agent\b/i, 'updated the agent rules'],
  [/^status\b/i, 'updated the status'],
  [/^board: reply\b/i, 'replied on the board'],
  [/^board\b.*\(bridge\)\s*$/i, 'replied on the board'],
  [/^board: (done|close)/i, 'closed a board post'],
  [/^board: reopen/i, 'reopened a board post'],
  [/^board\b/i, 'posted on the board'],
  [/^ai-apply: undo\b/i, 'undid an AI change'],
  [/^ai-apply\b/i, 'applied an AI change'],
  [/^ai: answer/i, 'answered a question'],
  [/^ai: (summarize|summary)/i, 'asked AI for a summary'],
  [/^ai\b/i, 'asked AI'],
  [/^project: new\b/i, 'started a project'],
  [/^project: team\b/i, 'changed a project team'],
  [/^project: milestone done/i, 'ticked a milestone'],
  [/^project: first milestone/i, 'added a milestone'],
  [/^project\b/i, 'updated a project'],
  [/^people: ui\b/i, 'changed their look'],
  [/^people\b/i, 'updated a profile'],
  [/^log\b/i, 'checked in'],
  [/^digest\b/i, 'wrote the weekly digest'],
]

/** File ids like 20261015-023331-alice-h4u never reach human text. */
const noIds = (s: string) => s.replace(/\b\d{8}-\d{6}(?:-[A-Za-z0-9]+)*\b/g, '').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim()

/** "Claude updated the docs" · "Alice finished “Ship it”" · "Bob: <subject>". */
export function humanChange(c: Pick<Commit, 'message' | 'actor' | 'author'>, nameOf: (login: string) => string): string {
  const actor = String(c.actor || c.author || '')
  const who = /^hq-ai$/i.test(actor) ? 'Pinwheel AI' : /^hq-digest$/i.test(actor) ? 'The digest' : nameOf(actor) || 'Someone'
  // a tool prefix ("claude: board … (bridge)") says who, not what: the actor already names Claude
  const msg = String(c.message || '').replace(/\s*\[skip ci\]\s*$/i, '').replace(/^claude:\s*/i, '').trim()
  const todo = msg.match(/^todo: (done|doing|todo|reopen|undo) · (.+?)(?: → .*)?$/i)
  if (todo) {
    const verb = { done: 'finished', doing: 'started', todo: 'reopened', reopen: 'reopened', undo: 'undid a change to' }[todo[1].toLowerCase()]
    return `${who} ${verb} “${clip(todo[2], 48)}”`
  }
  const add = msg.match(/^todo: (.+)$/i)
  if (add) return `${who} added a to-do: ${clip(noIds(add[1]), 48)}`
  for (const [re, words] of AREA) if (re.test(msg)) return `${who} ${words}`
  const subject = noIds(msg.replace(/^[\w -]{1,24}:\s*/, ''))
  return subject ? `${who}: ${clip(subject, 60)}` : `${who} changed a file`
}
