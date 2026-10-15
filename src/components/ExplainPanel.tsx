// Answers, laid out the same way everywhere (module C2, spec §6.5): lead → ONE picture → ≤3 bullets → Next → numbered
// source chips. Ask AI renders full answers with it; the Docs reader's Explain panel (`<ExplainPanel path/>`) renders
// the compact form beside the page: status line while it reads → lead → picture → bullets → source → "Keep asking in a
// new chat" (the chat is named after the page). Rich blocks go through B's BLOCKS (≤4 per answer, fresh ctx per render).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useHQ, useHQMaybe } from '../lib/hq-context'
import { Icon } from '../lib/icons'
import { projectOfPath, projectSlug, requestId, routeFor, type Model } from '../lib/hq'
import { title as docTitle, type Doc } from '../lib/md'
import { go } from '../lib/router'
import { onEscape } from '../lib/focus'
import { makeId, same, store } from '../lib/util'
import { aiErrorWords, ask, liveMarkdown, useLive, type Live, type SourceRef } from '../lib/askStream'
import { answerParts, explainQuestion, firstLine, SHOWN_BULLETS, stageText, type AnswerSource } from '../lib/read-core'
import type { BlockCtx } from '../lib/contracts'
import { BLOCKS, newBlockCtx } from './blocks'
import { Markdown, Toggle } from './ui'

/** Store key of the active Ask chat (the Ask page reads it on mount). */
export const ASK_CHAT_KEY = 'hq.chat'

/** Markdown with ```chart / ```explainer blocks counted against a shared per-answer ctx (A's Markdown draws them). */
export function RichMd({ md, base, ctx }: { md: string; base?: string; ctx: BlockCtx }) {
  return <Markdown md={md} base={base} ctx={ctx} />
}

/** Title of a repo path for chips and status lines: the doc's title, a project file's project title, else the name. */
export function titleOfPath(model: Model | null | undefined, path: string) {
  const doc = model?.byPath.get(path)
  const slug = projectOfPath(path)
  if (slug && /\/project\.md$/i.test(path)) {
    const p = model?.projects.find((d) => projectSlug(d) === slug)
    if (p) return String(p.data.title || slug)
  }
  if (doc) return docTitle(doc)
  return path.split('/').pop()!.replace(/\.md$/i, '')
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Numbered source chips: page titles (path in the tooltip), web links by title or host. */
export function SourceChips({ sources }: { sources: AnswerSource[] }) {
  const model = useHQMaybe()?.model
  const list = sources.filter((s) => (s.url && /^https?:\/\//i.test(s.url)) || (s.path && /^[\w./-]{1,160}$/.test(s.path))).slice(0, 8)
  if (!list.length) return null
  return (
    <div className="src" aria-label="Sources">
      {list.map((s, i) =>
        s.url ? (
          <a key={s.url} className="srcchip" href={s.url} target="_blank" rel="noopener noreferrer" data-tipt={s.url}>
            <b>{i + 1}</b>
            <span>{s.title || hostOf(s.url)}</span>
          </a>
        ) : (
          <a key={s.path} className="srcchip" href={'#' + routeFor(s.path!)} data-tipt={s.path}>
            <b>{i + 1}</b>
            <span>{titleOfPath(model, s.path!)}</span>
          </a>
        ),
      )}
    </div>
  )
}

/** "Reading Ways to make money…" with a pulse (calm mode: no pulse). Live region for screen readers. */
export function StatusLine({ text }: { text: string }) {
  if (!text) return null
  return (
    <div className="statusline" role="status">
      <span className="pulse" aria-hidden="true" />
      <span>{text}…</span>
    </div>
  )
}

const asSources = (refs: SourceRef[] | undefined): AnswerSource[] =>
  (refs || []).map((r) => (r.url ? { url: r.url, title: r.title } : { path: r.path })).filter((s) => s.url || s.path)

type AnswerProps = {
  md: string
  /** For relative links and the rich-block ctx (ai/answers/<id>.md). */
  base?: string
  /** Live sources from the stream: used when the text has no Sources list yet. */
  liveSources?: SourceRef[]
  /** Explain panel: no Next bar, picture budget shared with nothing else. */
  compact?: boolean
  /** The actions row (Make it a to-do · Save to project · Copy). */
  children?: ReactNode
}

/** One answer in the spec's anatomy. Answers without a lead or bullets (a greeting) render as plain markdown. */
export function AnswerView({ md, base, liveSources, compact, children }: AnswerProps) {
  const parts = useMemo(() => answerParts(md), [md])
  const ctx = newBlockCtx(base)
  const sources = parts.sources.length ? parts.sources : asSources(liveSources)
  const structured = !!(parts.lead || parts.bullets.length)
  const more = parts.bullets.slice(SHOWN_BULLETS)
  const longRest = parts.rest.length > 600 && !!(parts.visual || parts.bullets.length)
  return (
    <div className={'answer' + (compact ? ' compact' : '')}>
      {structured ? (
        <>
          {parts.lead && (
            <div className="lead">
              <Markdown md={parts.lead} base={base} />
            </div>
          )}
          {parts.visual && <div className="a-vis">{BLOCKS[parts.visual.lang](parts.visual.src, ctx)}</div>}
          {parts.bullets.length > 0 && (
            <ul className="blist">
              {parts.bullets.slice(0, SHOWN_BULLETS).map((b, i) => (
                <li key={i}>
                  <Markdown md={b} base={base} />
                </li>
              ))}
            </ul>
          )}
          {more.length > 0 && (
            <Toggle title={<span>{more.length} more</span>} className="a-more">
              <ul className="blist">
                {more.map((b, i) => (
                  <li key={i}>
                    <Markdown md={b} base={base} />
                  </li>
                ))}
              </ul>
            </Toggle>
          )}
          {parts.rest &&
            (longRest ? (
              <Toggle title={<span>More detail</span>} className="a-more">
                <RichMd md={parts.rest} base={base} ctx={ctx} />
              </Toggle>
            ) : (
              <RichMd md={parts.rest} base={base} ctx={ctx} />
            ))}
        </>
      ) : (
        <RichMd md={md} base={base} ctx={ctx} />
      )}
      {!compact && parts.next && (
        <div className="nextbar slim" role="note" aria-label="Next step">
          <Icon name="arrow" />
          <div className="nb-t">
            <span className="k">Next</span>
            <div className="nb-p">
              <Markdown md={parts.next} base={base} />
            </div>
          </div>
        </div>
      )}
      <SourceChips sources={sources} />
      {children && <div className="acts">{children}</div>}
    </div>
  )
}

/** A live (streaming) answer: status line, then the words so far (an unclosed block shows "Drawing…"). */
export function LiveAnswer({ l, compact, children }: { l: Live; compact?: boolean; children?: ReactNode }) {
  const model = useHQMaybe()?.model
  const working = l.state === 'streaming' || l.state === 'waiting'
  const stage = stageText(l.state, l.status, !!l.text, (p) => titleOfPath(model, p))
  if (!working && l.text) return <AnswerView md={l.text} base={`ai/answers/${l.id}.md`} liveSources={l.sources} compact={compact}>{children}</AnswerView>
  return (
    <div className={'answer' + (compact ? ' compact' : '')} aria-busy={working}>
      <StatusLine text={stage} />
      {l.text && !compact && <Markdown md={liveMarkdown(l.text)} base={`ai/answers/${l.id}.md`} />}
      {l.error && (
        <div className="callout bad" role="alert">
          <Icon name="alert" />
          {l.state === 'error' ? (
            // plain words first; the provider's raw message only behind Details
            <span className="err-words">
              {aiErrorWords(l.error)}
              <details className="err-raw">
                <summary>Details</summary>
                <code>{l.error}</code>
              </details>
            </span>
          ) : (
            <span>{l.error}</span>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Explain panel
// ---------------------------------------------------------------------------------------------------------------

/** This session's Explain answer per page (closing and reopening the panel reuses it). */
const explainIds = new Map<string, string>()

/** My newest saved Explain answer for a page, if any. */
function savedExplain(model: Model, me: string, path: string): { id: string; answer: Doc } | null {
  for (const r of model.requests) {
    if (r.data.kind !== 'summarize' || r.data.target !== path || !same(r.data.author, me)) continue
    const a = model.answers.get(requestId(r))
    if (a && a.data.status !== 'error') return { id: requestId(r), answer: a }
  }
  return null
}

/** `<ExplainPanel path/>`: "About this page" beside the doc (above it on narrow screens). Esc or × closes it; the page
 *  stays. The answer is a new chat named after the page, so "Keep asking" opens it in Ask AI. */
export function ExplainPanel({ path, onClose }: { path: string; onClose: () => void }) {
  const { model, me, source, refresh } = useHQ()
  const lives = useLive()
  const doc = model.byPath.get(path)
  const name = doc ? docTitle(doc) : titleOfPath(model, path)
  const saved = useMemo(() => savedExplain(model, me.login, path), [model, me.login, path])
  const [id, setId] = useState<string | null>(() => explainIds.get(path) || saved?.id || null)
  const live = id ? lives.find((l) => l.id === id) : undefined
  const answer = id ? model.answers.get(id) : undefined
  const head = useRef<HTMLHeadingElement>(null)
  const close = useRef(onClose)
  close.current = onClose

  const start = () => {
    const nid = makeId(me.login)
    explainIds.set(path, nid)
    setId(nid)
    void ask(
      source, me,
      { id: nid, thread: nid, question: explainQuestion(name, path), kind: 'summarize', target: path, connectors: [], model: 'fast', project: projectOfPath(path) },
      [], refresh,
    )
  }

  useEffect(() => {
    // explainIds is set synchronously by start(), so a second mount run (StrictMode) reuses it instead of asking again
    const known = explainIds.get(path)
    if (!id && known) setId(known)
    else if (!id) start()
    head.current?.focus({ preventScroll: true })
    return onEscape(() => close.current())
  }, [])

  const keepAsking = () => {
    if (!id) return
    store.set(ASK_CHAT_KEY, id)
    go('/ask')
  }

  let body: ReactNode
  if (live && (live.state !== 'done' || !answer)) body = <LiveAnswer l={live} compact />
  else if (answer) body = <AnswerView md={answer.body} base={answer.path} compact />
  else body = <StatusLine text={`Reading ${name}`} />
  const done = !!answer || live?.state === 'done'
  const failed = live?.state === 'error'

  return (
    <aside className="xpanel" aria-labelledby="xp-title">
      <div className="xp-h">
        <Icon name="spark" />
        <h2 id="xp-title" tabIndex={-1} ref={head}>
          About this page
        </h2>
        <button className="icon-btn" type="button" aria-label="Close" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <div className="xp-b" aria-live="polite">
        {body}
        {(done || failed) && (
          <div className="xp-acts">
            {done && (
              <button className="btn sm" type="button" onClick={keepAsking}>
                <Icon name="spark" size="s" />
                Keep asking in a new chat
              </button>
            )}
            <button className="btn ghost sm" type="button" onClick={start} data-tipt="Ask about this page again (a new answer)">
              <Icon name="refresh" size="s" />
              {failed ? 'Try again' : 'Ask again'}
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}

/** The chat title an Explain answer gets (its question's first line). */
export const explainTitle = (q: string) => firstLine(q)
