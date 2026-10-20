// Apply and undo Ask AI changes (lazy: only the Apply card loads it). Every step is checked as the person clicking:
// the file must still be exactly the version the AI read (sha1), the new text must be exactly what the preview showed,
// and the shared house rules (write-policy.ts, the same file the AI's tools and the dev server use) must allow it.
// The save is one commit on GitHub (the person's own token; the message names them) or a dev-server write locally.
import { applyEdits, textSha1, writeRefusal } from './write-policy'
import type { Change } from './ai-changes'
import type { Me, Source } from './source'

export type ChangeState = 'ready' | 'applied' | 'changed' | 'gone' | 'exists'

/** Plain words for a change that can't be applied as it is. */
export const STATE_WORDS: Record<Exclude<ChangeState, 'ready'>, string> = {
  applied: 'Applied',
  changed: 'This file changed since the AI read it. Ask again for a fresh change.',
  gone: 'This file is gone now.',
  exists: 'This file exists now with other text, so this card can’t apply or undo it.',
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

/** Where a change stands against the file's current text (null = no such file). */
export async function stateOf(c: Change, cur: string | null): Promise<ChangeState> {
  if (c.op === 'create') return cur === null ? 'ready' : (await textSha1(cur)) === c.after ? 'applied' : 'exists'
  if (cur === null) return 'gone'
  const sha = await textSha1(cur)
  return sha === c.after ? 'applied' : sha === c.base ? 'ready' : 'changed'
}

/** The text after the change, made from the current text (which must be its base). Throws when the result is not
 *  exactly what the preview promised (sha1 `after`). */
export async function nextText(c: Change, cur: string | null): Promise<string> {
  const r = c.op === 'edit' ? applyEdits(cur ?? '', c.edits || []) : { text: c.text }
  if (typeof r.text !== 'string' || (await textSha1(r.text)) !== c.after) throw new Error("This change doesn't fit the file any more. Ask again for a fresh one.")
  return r.text
}

/** The text before the change, from the text after it (Undo after a reload): a new file → null (remove it); a small
 *  file → its saved `before`; a big one → its edits reversed, when that gives back exactly the old text. undefined =
 *  it can't be undone from here. */
export async function priorText(c: Change, now: string): Promise<string | null | undefined> {
  if (c.op === 'create') return null
  if (typeof c.before === 'string') return (await textSha1(c.before)) === c.base ? c.before : undefined
  if (c.op === 'edit' && c.edits?.length && c.edits.every((e) => e.replace)) {
    const back = applyEdits(now, [...c.edits].reverse().map((e) => ({ find: e.replace, replace: e.find })))
    if (typeof back.text === 'string' && (await textSha1(back.text)) === c.base) return back.text
  }
  return undefined
}

/** What the house rules need besides the file: its project's project.md, a reply's parent post. Read fresh. */
async function rulesContext(source: Source, path: string) {
  let project: string | null | undefined
  if (path.startsWith('projects/')) {
    const slug = path.split('/')[1].replace(/\.md$/i, '')
    project = (await source.read(`projects/${slug}/project.md`)) ?? (await source.read(`projects/${slug}.md`))
  }
  const parentId = (path.match(/^board\/replies\/([^/]+?)--[^/]+\.md$/) || [])[1]
  const parent = parentId ? (await source.read(`board/${parentId}.md`)) !== null : undefined
  return { project, parent }
}

/** Why `me` may not apply this change to the current text ('' = they may): the same check Apply runs, early, so the
 *  card can say so instead of offering a button that would fail. */
export async function refusalOf(source: Source, me: Me, c: Change, cur: string | null): Promise<string> {
  const next = await nextText(c, cur)
  return writeRefusal({ path: c.path, login: me.login, cur, next, ...(await rulesContext(source, c.path)) })
}

/** The commit message: what changed + who applied it ("via Ask AI" lives in the prefix). */
export const commitMessage = (c: Pick<Change, 'summary'>, me: Pick<Me, 'login'>, undo = false) =>
  `ai-apply: ${undo ? 'undo ' : ''}${clip(c.summary.replace(/\s+/g, ' ').trim(), 70)} (by ${me.login})`

/** Apply one change as `me`. → the texts before and after (for the toast's Undo). */
export async function applyChange(source: Source, me: Me, c: Change): Promise<{ cur: string | null; next: string }> {
  const cur = await source.read(c.path)
  const st = await stateOf(c, cur)
  if (st !== 'ready') throw new Error(STATE_WORDS[st])
  const next = await nextText(c, cur)
  const why = writeRefusal({ path: c.path, login: me.login, cur, next, ...(await rulesContext(source, c.path)) })
  if (why) throw new Error(why)
  await source.apply(c.path, cur, next, commitMessage(c, me))
  return { cur, next }
}

/** Undo an applied change as `me`: only while the file is still exactly what the change made. `known` = the texts
 *  from applyChange in this tab; without it the change's own data rebuilds the old text (priorText). */
export async function undoChange(source: Source, me: Me, c: Change, known?: { cur: string | null; next: string }) {
  const now = await source.read(c.path)
  if (now === null || (await textSha1(now)) !== c.after) throw new Error('This file changed after the change was applied, so it can’t be undone here.')
  const prior = known ? known.cur : await priorText(c, now)
  if (prior === undefined) throw new Error('This change can’t be undone here: open the file and change it back.')
  const why = writeRefusal({ path: c.path, login: me.login, cur: now, next: prior, ...(await rulesContext(source, c.path)) })
  if (why) throw new Error(why)
  await source.apply(c.path, now, prior, commitMessage(c, me, true))
}
