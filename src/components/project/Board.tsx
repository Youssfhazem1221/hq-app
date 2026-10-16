// The project board widget: the project's `board:` lanes with their cards (lib/project-board.ts). Saving a card's new
// stage or date rewrites only those two frontmatter keys in its file, then offers Undo (the exact old file back).
import { useMemo, useState } from 'react'
import { useHQ } from '../../lib/hq-context'
import type { Doc } from '../../lib/md'
import { boardConfig, boardOf, dayName, setCard, type BoardCard } from '../../lib/project-board'
import { Widget } from '../ui'
import { toast } from '../toast'
import { same } from '../work-ui'
import { BoardCardView } from './BoardCard'

const SHOWN = 4

export function ProjectBoard({ p, slug }: { p: Doc; slug: string }) {
  const { model, me, source, reload } = useHQ()
  const cfg = useMemo(() => boardConfig(p, slug), [p, slug])
  const board = useMemo(() => (cfg ? boardOf(cfg, model.projectFiles.get(slug) || [], new Date().toISOString().slice(0, 10)) : null), [cfg, model, slug])
  // long lanes show their first SHOWN cards (soonest go-live first) and a "+N more" button
  const [more, setMore] = useState<Set<string>>(() => new Set())
  if (!cfg || !board?.total) return null
  const canEdit = same(p.data.owner, me.login)

  async function save(c: BoardCard, stage: string, date: string) {
    if (!cfg) return
    let before: string | null = null
    let after: string | null = null
    try {
      const ok = await source.update(
        c.path,
        (cur) => {
          before = cur
          after = cur === null ? null : setCard(cur, cfg, { stage, date: date || null })
          return after === cur ? null : after
        },
        `${slug}: ${c.item} → ${stage}${date ? ' · ' + date : ''}`,
      )
      if (!ok || after === null || after === before) return
      await reload()
      const undo = () =>
        source
          .update(c.path, (cur) => (cur !== null && cur === after && before !== null ? before : cur), `${slug}: undo ${c.item}`)
          .then(() => reload())
          .catch((e) => toast(String(e?.message || e), 'error'))
      toast(`${c.item}: ${stage}${date ? ', ' + dayName(date) : ''}`, 'ok', { undo })
    } catch (e: any) {
      toast(String(e?.message || e), 'error')
    }
  }

  return (
    <div id="board">
      <Widget id="board" title={cfg.title} icon="cols" count={board.total}>
        <div className="pb-lanes">
          {board.lanes.map(({ lane, cards }) => (
            <section key={lane.name} className="pb-lane" aria-label={`${lane.name}: ${cards.length}`}>
              <h3 className="pb-h">
                {lane.name}
                <span className="count">{cards.length}</span>
              </h3>
              {(more.has(lane.name) ? cards : cards.slice(0, SHOWN)).map((c) => (
                <BoardCardView key={c.path + c.stage + (c.date || '')} c={c} cfg={cfg} canEdit={canEdit} onSave={(card, s, d) => void save(card, s, d)} />
              ))}
              {cards.length > SHOWN && (
                <button
                  className="btn sm ghost pb-more"
                  type="button"
                  aria-expanded={more.has(lane.name)}
                  onClick={() =>
                    setMore((cur) => {
                      const n = new Set(cur)
                      if (n.has(lane.name)) n.delete(lane.name)
                      else n.add(lane.name)
                      return n
                    })
                  }
                >
                  {more.has(lane.name) ? 'Show fewer' : `+${cards.length - SHOWN} more`}
                </button>
              )}
              {!cards.length && <p className="pb-empty">Nothing here yet</p>}
            </section>
          ))}
        </div>
      </Widget>
    </div>
  )
}
