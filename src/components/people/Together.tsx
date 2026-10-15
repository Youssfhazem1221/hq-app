// Together tab (module D, blueprint §8.4 + spec §6.4): the last 14 days as a team. Tiles (asks answered, median first
// reply, blockers resolved), Who's on what (role chips + coarse activity dots, no numbers per person), Pairs as a node
// diagram (never ranked) and up to 3 team-up ideas. One person → one sentence (+ the dev-only layout preview).
// Team and pair level only: nothing here shows a per-person total (blueprint P13).
import { askAnywhere } from '../../lib/router'
import { Icon } from '../../lib/icons'
import { Empty, Stat, Widget } from '../ui'
import { JoinGuideButton } from './JoinGuide'
import { PairDiagram } from './PairDiagram'
import type { TogetherData } from './people-ui-core'

const DOTS = ['·', '●', '●●', '●●●']
const DOT_WORD = ['none', 'some', 'steady', 'busy']
const ASK_TEAM_UP = 'Where can we team up next month? Use members, skills, ask-me-about, solo projects and open blockers.'

export function Together(p: { data: TogetherData; nameOf: (login: string) => string; titleOf: (slug: string) => string; sample?: boolean; onPreview?: () => void }) {
  const { data, nameOf, titleOf, sample } = p
  if (data.people < 2 && !sample)
    return (
      <div className="w">
        <Empty icon="link" text="Together needs two people. It fills in after a teammate's first post, reply or to-do.">
          {p.onPreview ? (
            <button className="btn sm" type="button" onClick={p.onPreview}>
              <Icon name="eye" size="s" />
              Preview the layout
            </button>
          ) : (
            <JoinGuideButton className="btn sm" />
          )}
        </Empty>
      </div>
    )
  const cls = sample ? ' is-sample' : ''
  const colName = (l: string) => (l === 'claude' ? 'Claude' : nameOf(l))
  return (
    <div className="together">
      {data.tiles.length > 0 && (
        <div className={'ph-stats tg-stats' + cls}>
          {data.tiles.map((t) => (
            <Stat key={t.label} tile={t} />
          ))}
        </div>
      )}
      <div className="grid">
        <div className="c7">
          <Widget id="onwhat" title="Who's on what" icon="grid" className={cls.trim()} act={<span className="hint">● some · ●● steady · ●●● busy</span>}>
            {data.projects.length ? (
              <div className="matrix-wrap hide-m">
                <table className="matrix">
                  <caption className="sr">Role and activity per project, last 14 days. Dots: none, some, steady, busy.</caption>
                  <thead>
                    <tr>
                      <th scope="col">Project</th>
                      {data.columns.map((c) => (
                        <th scope="col" key={c}>
                          {colName(c)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.projects.map((s) => (
                      <tr key={s}>
                        <th scope="row">{titleOf(s)}</th>
                        {data.columns.map((c) => {
                          const cell = data.cells[s]?.[c] || { dots: 0 }
                          return (
                            <td key={c}>
                              {cell.role && (
                                <span className="chip line">
                                  <Icon name={cell.role === 'owner' ? 'flag' : 'users'} />
                                  {cell.part || cell.role}
                                </span>
                              )}
                              <span className="adots" aria-label={DOT_WORD[cell.dots]}>
                                {DOTS[cell.dots]}
                              </span>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="sm muted">No active projects yet.</p>
            )}
            {data.projects.length > 0 && (
              <div className="mx-cards" role="list" aria-label="Who's on what, by project">
                {data.projects.map((s) => (
                  <div className="mx-card" role="listitem" key={s}>
                    <b>{titleOf(s)}</b>
                    <div className="pp-chips">
                      {data.columns
                        .filter((c) => data.cells[s]?.[c]?.role || data.cells[s]?.[c]?.dots)
                        .map((c) => {
                          const cell = data.cells[s][c]
                          return (
                            <span key={c} className="chip line">
                              {cell.role && <Icon name={cell.role === 'owner' ? 'flag' : 'users'} />}
                              {colName(c)}
                              {cell.part ? ` · ${cell.part}` : ''}
                              <span className="adots" aria-label={DOT_WORD[cell.dots]}>
                                {DOTS[cell.dots]}
                              </span>
                            </span>
                          )
                        })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Widget>
        </div>
        <div className="c5">
          <Widget id="pairs" title="Pairs" icon="link" className={cls.trim()} act={<span className="hint">never ranked</span>}>
            {data.pairs.length ? <PairDiagram pairs={data.pairs} nameOf={colName} /> : <p className="sm muted">No pairs yet: they appear after a reply, a to-do for someone or an unblock.</p>}
          </Widget>
        </div>
        <div className="c12">
          <Widget id="ideas" title="Team-up ideas" icon="idea" className={cls.trim()}>
            {data.ideas.length ? (
              <ul className="blist">
                {data.ideas.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            ) : (
              <p className="sm muted">No ideas yet.</p>
            )}
            <div className="pp-ctrl">
              <button className="btn sm" type="button" onClick={() => !sample && askAnywhere(ASK_TEAM_UP)} disabled={sample}>
                <Icon name="spark" size="s" />
                Ask AI where we can team up
              </button>
            </div>
          </Widget>
        </div>
      </div>
    </div>
  )
}
