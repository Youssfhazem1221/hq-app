// "Set up my profile" (module D, blueprint §8.8 + onboarding-intake.md): a 4-step wizard for anyone.
//  1 Ask your Claude  · copy the prompt (login filled in) + a 3-step picture of what to do with it
//  2 Upload           · drop, pick or paste hq-intake-<login>.md (≤20 kB), shown back as plain text
//  3 Review           · Gemini's draft (E2's "profile-draft" action) as cards you include and edit
//  4 Save             · your profile (one commit, your own token) + optional own projects, log settings, look, intake
// Rules: everything saved is visible to the team and HQ's AI (says so); the intake is saved only when ticked (default
// off); no memberships on other people's projects (Ask to join instead, Y3); model output is plain text, never HTML.
// No AI here (no key, not allowed, offline) → the same cards, filled in by hand.
import { useMemo, useRef, useState } from 'react'
import { useHQ, usePrefsApi } from '../../lib/hq-context'
import { displayName, projectSlug } from '../../lib/hq'
import { createProject, dayOf, localTz, profilePathFor, requestJoin, saveProfilePatch } from '../../lib/people'
import { slugOf, validTz, type LogConfig } from '../../lib/people-core'
import type { UiPrefs } from '../../lib/contracts'
import { Icon } from '../../lib/icons'
import { firstName } from '../../lib/util'
import { toast } from '../toast'
import { Callout } from '../ui'
import { requestProfileDraft } from './profile-draft'
import {
  INTAKE_MAX, PRESET_LABEL, byteLength, cleanDraft, draftFromProfile, draftLogConfig, draftToProfile, emptyDraft, intakeFile, intakePath, intakeProblem, intakePrompt, kindLabel, line,
  sensitiveFields, type DraftProject, type DraftSkill, type ProfileDraft,
} from './people-ui-core'

type Step = 1 | 2 | 3 | 4
const STEPS = ['Ask your Claude', 'Upload', 'Review', 'Save']
const PRONOUNS = ['he/him', 'she/her', 'they/them']
const ZONES = ['Africa/Cairo', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Kolkata', 'UTC']
const UI_WORDS: Record<string, string> = {
  theme: 'Theme', accent: 'Accent', density: 'Density', size: 'Text size', font: 'Font', lh: 'Line spacing', ls: 'Letter spacing', motion: 'Motion',
  contrast: 'Contrast', calm: 'Calm colours', focus: 'Focus mode', keys: 'Single-key shortcuts',
}
const GUESS = /\s*\(guess\)\s*$/i
const unguess = (s: string) => s.replace(GUESS, '').trim()
const isGuess = (s: string) => GUESS.test(s)
const same = (a: unknown, b: unknown) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()

/** The workspace host's first name for the prompt ("with my friend <name>"): whoever owns the most projects, never
 *  the person themself. null when that's me (the host runs the wizard too). */
function hostName(model: ReturnType<typeof useHQ>['model'], me: string): string | null {
  const count = new Map<string, number>()
  for (const p of model.projects) {
    const o = String(p.data.owner || '').trim()
    if (o) count.set(o, (count.get(o) || 0) + 1)
  }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
  if (!top || same(top, me)) return null
  return firstName(displayName(model, top)) || top
}

type Include = { identity: boolean; role: boolean; skills: boolean; stack: boolean; ask: boolean; work: boolean; log: boolean; ui: boolean }

export function Onboarding({ onDone, compact }: { onDone?: () => void; compact?: boolean }) {
  const { model, me, source, reload } = useHQ()
  const prefs = usePrefsApi()
  const mine = model.roster.find((p) => same(p.login, me.login))
  const has = !!mine
  const [step, setStep] = useState<Step>(1)
  const [intake, setIntake] = useState('')
  const [fileName, setFileName] = useState('')
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [manual, setManual] = useState(false)
  const [d, setD] = useState<ProfileDraft>(() =>
    mine ? draftFromProfile(mine, model.byPath.get(mine.path)?.data) : emptyDraft(me.name && me.name !== me.login ? me.name : '', localTz()),
  )
  const [dropped, setDropped] = useState<string[]>([])
  const [inc, setInc] = useState<Include>({ identity: true, role: true, skills: true, stack: true, ask: true, work: true, log: !has, ui: false })
  const [learning, setLearning] = useState<string[]>(() => [...(mine?.learning || [])])
  const [makeProjects, setMakeProjects] = useState<Record<number, boolean>>({})
  const [keepIntake, setKeepIntake] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const host = useMemo(() => hostName(model, me.login), [model, me.login])
  const prompt = intakePrompt(me.login, host)
  const bytes = byteLength(intake)
  const tooBig = bytes > INTAKE_MAX
  const known = useMemo(() => model.projects.flatMap((p) => [projectSlug(p), String(p.data.title || '')]).filter(Boolean), [model.projects])
  const logCfg: LogConfig = useMemo(() => draftLogConfig(d.log), [d.log])
  const warn = sensitiveFields(logCfg)
  const others = model.projects.filter((p) => String(p.data.status || 'active') !== 'done' && !same(p.data.owner, me.login))
  // Local mode without HQ_LOCAL_LOGIN: "me" is a display default and the server refuses people/ writes.
  const readOnly = me.configured === false

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      toast('Prompt copied · paste it into Claude Code', 'ok')
    } catch {
      setCopied(false)
      toast('Copy is blocked here: select the prompt below and copy it', 'info')
      const el = document.getElementById('ob-prompt') as HTMLTextAreaElement | null
      el?.closest('details')?.setAttribute('open', '')
      el?.select()
    }
  }
  const readFile = (f: File | undefined | null) => {
    if (!f) return
    setErr('')
    if (f.size > INTAKE_MAX * 2) return setErr(`That file is ${Math.round(f.size / 1000)} kB; the intake can be ${INTAKE_MAX / 1000} kB at most`)
    if (!/\.(md|markdown|txt)$/i.test(f.name)) return setErr('Pick the .md file your Claude wrote')
    const r = new FileReader()
    r.onload = () => {
      setIntake(String(r.result || '').replace(/\r\n?/g, '\n'))
      setFileName(f.name)
    }
    r.onerror = () => setErr('Could not read that file')
    r.readAsText(f)
  }
  const draftIt = async () => {
    if (busy || !intake.trim() || tooBig) return
    setBusy(true)
    setErr('')
    const r = await requestProfileDraft(source, intake, known)
    setBusy(false)
    if (r.ok) {
      const nd = cleanDraft(r.draft)
      if (!nd.work_style.timezone) nd.work_style.timezone = d.work_style.timezone
      if (!nd.identity.name) nd.identity.name = d.identity.name
      setD(nd)
      setDropped(r.dropped)
      setInc((x) => ({ ...x, ui: Object.keys(nd.ui).length > 0 }))
      setManual(false)
      setStep(3)
    } else {
      setManual(r.manual)
      setErr(r.manual ? `${r.error}. You can fill your profile in by hand.` : r.error)
    }
  }
  const byHand = () => {
    setManual(true)
    setErr('')
    setStep(3)
  }

  const save = async () => {
    if (busy || readOnly) return
    const name = unguess(d.identity.name)
    if (!name) {
      setStep(3)
      return setErr('Add your name first')
    }
    // Checked before anything is written: an intake kept in HQ must not carry a key or an email (the team and AI see it).
    const bad = keepIntake && intake.trim() ? intakeProblem(intake.slice(0, INTAKE_MAX)) : null
    if (bad) return setErr(`Not saved: line ${bad.line} of your intake ${bad.why}. Remove it, or untick "Keep my intake in HQ".`)
    setBusy(true)
    setErr('')
    try {
      const clean = (s: string) => unguess(s)
      const draft: ProfileDraft = {
        ...d,
        identity: inc.identity ? { name, pronouns: clean(d.identity.pronouns), about: clean(d.identity.about) } : { name, pronouns: '', about: '' },
        role: inc.role ? clean(d.role) : '',
        focus: inc.role ? clean(d.focus) : '',
        skills: inc.skills ? d.skills.map((s) => ({ ...s, name: clean(s.name), evidence: clean(s.evidence) })).filter((s) => s.name) : [],
        stack: inc.stack ? d.stack.map(clean).filter(Boolean) : [],
        projects: d.projects.map((p) => ({ ...p, name: clean(p.name), line: clean(p.line) })),
        ask_me_about: inc.ask ? d.ask_me_about.map(clean).filter(Boolean) : [],
        work_style: inc.work ? { ...d.work_style, hours: clean(d.work_style.hours), communication: clean(d.work_style.communication) } : { timezone: d.work_style.timezone, hours: '', communication: '' },
      }
      const { patch, body } = draftToProfile(draft, { learning, log: inc.log ? logCfg : undefined, tz: localTz() })
      await saveProfilePatch(source, me, patch, has ? {} : { body })
      const made: string[] = []
      // `model` was built before this loop: pass the slots already given so each new project gets its own colour.
      const usedColors: number[] = []
      for (const [i, on] of Object.entries(makeProjects)) {
        const p = draft.projects[Number(i)]
        if (!on || !p?.name) continue
        try {
          usedColors.push((await createProject(source, me, { title: p.name, usedColors }, model)).color)
          made.push(p.name)
        } catch (e: any) {
          toast(`${p.name}: ${String(e?.message || e)}`, 'error')
        }
      }
      if (keepIntake && intake.trim()) {
        const path = intakePath(slugOf(me.login))
        await source.update(path, () => intakeFile(me.login, intake.slice(0, INTAKE_MAX), dayOf()), `people: intake ${me.login}`)
      }
      if (inc.ui && Object.keys(d.ui).length) prefs.apply(d.ui as Partial<UiPrefs>, 'Look from your intake')
      toast(`Profile saved${made.length ? ` · ${made.length} project${made.length === 1 ? '' : 's'} created` : ''}`, 'ok')
      setSaved(true)
      await reload()
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  // ---- render ----
  const stepper = (
    <ol className="ob-steps" aria-label="Steps">
      {STEPS.map((s, i) => {
        const n = (i + 1) as Step
        const state = n < step ? 'done' : n === step ? 'cur' : ''
        return (
          <li key={s} className={state} aria-current={n === step ? 'step' : undefined}>
            <span className="ob-n">{n < step ? <Icon name="check" size="s" /> : n}</span>
            <span className="ob-l">{s}</span>
          </li>
        )
      })}
    </ol>
  )

  if (saved)
    return (
      <section className={'w ob' + (compact ? ' compact' : '')} aria-labelledby="ob-title">
        <div className="pp-h">
          <Icon name="ok" />
          <h2 id="ob-title">Your profile is in HQ</h2>
        </div>
        <p className="sm fg2">Teammates and HQ's AI can see it now. Projects belong to their owners: ask to join the ones you want to work on.</p>
        {others.length > 0 && (
          <div className="rows ob-join" role="list">
            {others.slice(0, 6).map((p) => (
              <JoinRow key={p.path} slug={projectSlug(p)} title={String(p.data.title || projectSlug(p))} owner={displayName(model, String(p.data.owner || ''))} />
            ))}
          </div>
        )}
        <div className="pp-ctrl">
          <a className="btn primary sm" href={'#/people/' + slugOf(me.login)}>
            Open my page
            <Icon name="arrow" size="s" />
          </a>
          {onDone && (
            <button className="btn ghost sm" type="button" onClick={onDone}>
              Close
            </button>
          )}
        </div>
      </section>
    )

  return (
    <section className={'w ob' + (compact ? ' compact' : '')} aria-labelledby="ob-title">
      <div className="pp-h">
        <Icon name="user" />
        <h2 id="ob-title">{has ? 'Update my profile' : 'Set up my profile'}</h2>
        <span className="chip line" data-tipt="Everything you save is visible to the team and to HQ's AI">
          <Icon name="eye" />
          visible to the team
        </span>
      </div>
      {stepper}

      {step === 1 && (
        <div className="ob-body">
          <p className="ob-lead">Your own Claude reads your Claude folder and projects (read-only) and writes a short intake. HQ turns it into a profile you check.</p>
          <ol className="ob-guide" aria-label="What to do with the prompt">
            <li>
              <Icon name="pc" />
              <b>Open Claude Code</b>
              <span>in a terminal on your computer</span>
            </li>
            <li>
              <Icon name="copy" />
              <b>Paste the prompt</b>
              <span>tell it which project folders to read</span>
            </li>
            <li>
              <Icon name="file" />
              <b>Check the file</b>
              <span>hq-intake-{me.login}.md, edit anything private out</span>
            </li>
          </ol>
          <details className="tg ob-prompt">
            <summary>
              <Icon name="chevR" size="s" className="chev" />
              <span className="sm">See the prompt</span>
            </summary>
            <div className="tg-body">
              <label className="sr" htmlFor="ob-prompt">
                Prompt for your Claude
              </label>
              <textarea id="ob-prompt" className="inp ob-pre" readOnly rows={10} value={prompt} />
            </div>
          </details>
          <div className="pp-ctrl">
            <button className="btn primary" type="button" onClick={copy}>
              <Icon name={copied ? 'check' : 'copy'} size="s" />
              {copied ? 'Copied' : 'Copy prompt'}
            </button>
            <button className="btn" type="button" onClick={() => setStep(2)}>
              I have my file
              <Icon name="arrow" size="s" />
            </button>
            <button className="btn ghost sm" type="button" onClick={byHand}>
              Skip: fill it in by hand
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="ob-body">
          <div
            className={'ob-drop' + (drag ? ' on' : '')}
            onDragOver={(e) => {
              e.preventDefault()
              setDrag(true)
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDrag(false)
              readFile(e.dataTransfer.files?.[0])
            }}
          >
            <Icon name="file" />
            <p>
              <b>Drop hq-intake-{me.login}.md here</b>
              <span className="hint"> or </span>
              <button className="more" type="button" onClick={() => fileInput.current?.click()}>
                choose the file
              </button>
            </p>
            <input ref={fileInput} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" className="sr" tabIndex={-1} aria-hidden="true" onChange={(e) => readFile(e.target.files?.[0])} />
            <span className="hint">Up to {INTAKE_MAX / 1000} kB · nothing is saved yet</span>
          </div>
          <label className="field">
            <span>Or paste it</span>
            <textarea
              className="inp ob-paste"
              rows={intake ? 10 : 4}
              placeholder="# Who I am …"
              value={intake}
              onChange={(e) => {
                setIntake(e.target.value)
                setFileName('')
                setErr('')
              }}
            />
          </label>
          <p className={'hint' + (tooBig ? ' bad' : '')} aria-live="polite">
            {fileName ? `${fileName} · ` : ''}
            {(bytes / 1000).toFixed(1)} of {INTAKE_MAX / 1000} kB{tooBig ? ' · too long: cut it down first' : ''}
          </p>
          {err && (
            <p className="pp-err" role="alert">
              <Icon name="alert" size="s" /> {err}
            </p>
          )}
          <div className="pp-ctrl">
            <button className="btn ghost sm" type="button" onClick={() => setStep(1)}>
              <Icon name="chevL" size="s" />
              Back
            </button>
            <span style={{ flex: 1 }} />
            {manual && (
              <button className="btn sm" type="button" onClick={byHand}>
                Fill it in by hand
              </button>
            )}
            <button className="btn primary" type="button" onClick={draftIt} disabled={busy || !intake.trim() || tooBig}>
              {busy ? (
                <>
                  <Icon name="loader" size="s" className="spin" />
                  Reading your intake…
                </>
              ) : (
                <>
                  <Icon name="spark" size="s" />
                  Make my draft
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="ob-body">
          <p className="ob-lead">
            {manual ? 'Fill in what you like; only your name is needed.' : 'Gemini drafted this from your intake. Keep what is right, fix the rest. "guess" marks what it inferred.'}
          </p>
          {dropped.length > 0 && <p className="hint">Left out: {dropped.slice(0, 4).join(' · ')}</p>}
          <div className="ob-cards">
            <Card title="Who you are" on={inc.identity} onToggle={(v) => setInc({ ...inc, identity: v })} required>
              <Field label="Name" value={d.identity.name} max={60} onChange={(v) => setD({ ...d, identity: { ...d.identity, name: v } })} />
              <div className="field">
                <span>Pronouns</span>
                <div className="pp-chips">
                  {PRONOUNS.map((p) => (
                    <button key={p} className="qchip" type="button" aria-pressed={same(unguess(d.identity.pronouns), p)} onClick={() => setD({ ...d, identity: { ...d.identity, pronouns: p } })}>
                      {p}
                    </button>
                  ))}
                  <button className="qchip" type="button" aria-pressed={!d.identity.pronouns} onClick={() => setD({ ...d, identity: { ...d.identity, pronouns: '' } })}>
                    prefer not
                  </button>
                  <input className="inp sm ob-pron" aria-label="Custom pronouns" placeholder="custom" maxLength={24} value={PRONOUNS.some((p) => same(unguess(d.identity.pronouns), p)) ? '' : d.identity.pronouns} onChange={(e) => setD({ ...d, identity: { ...d.identity, pronouns: e.target.value } })} />
                </div>
              </div>
              <Field label="About (1–2 lines)" value={d.identity.about} max={200} onChange={(v) => setD({ ...d, identity: { ...d.identity, about: v } })} />
            </Card>
            <Card title="Role & focus" on={inc.role} onToggle={(v) => setInc({ ...inc, role: v })}>
              <Field label="Role" value={d.role} max={80} onChange={(v) => setD({ ...d, role: v })} />
              <Field label="Focus right now" value={d.focus} max={140} onChange={(v) => setD({ ...d, focus: v })} />
            </Card>
            <Card title="Skills" on={inc.skills} onToggle={(v) => setInc({ ...inc, skills: v })}>
              <SkillList skills={d.skills} onChange={(skills) => setD({ ...d, skills })} />
            </Card>
            <Card title="Tools & stack" on={inc.stack} onToggle={(v) => setInc({ ...inc, stack: v })}>
              <ChipList items={d.stack} max={16} len={32} label="tool" onChange={(stack) => setD({ ...d, stack })} />
            </Card>
            <Card title="Ask me about · learning" on={inc.ask} onToggle={(v) => setInc({ ...inc, ask: v })}>
              <span className="hint">Ask me about</span>
              <ChipList items={d.ask_me_about} max={8} len={60} label="topic" onChange={(ask_me_about) => setD({ ...d, ask_me_about })} />
              <span className="hint">Learning</span>
              <ChipList items={learning} max={8} len={60} label="thing you're learning" onChange={setLearning} />
            </Card>
            <Card title="Work style" on={inc.work} onToggle={(v) => setInc({ ...inc, work: v })}>
              <label className="field">
                <span>Time zone</span>
                <input className="inp sm" list="ob-zones" value={d.work_style.timezone} onChange={(e) => setD({ ...d, work_style: { ...d.work_style, timezone: e.target.value.trim() } })} aria-invalid={!!d.work_style.timezone && !validTz(d.work_style.timezone)} />
                <datalist id="ob-zones">
                  {[...new Set([localTz(), ...ZONES])].map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </label>
              <Field label="Best hours" value={d.work_style.hours} max={80} onChange={(v) => setD({ ...d, work_style: { ...d.work_style, hours: v } })} />
              <Field label="How you like to communicate" value={d.work_style.communication} max={140} onChange={(v) => setD({ ...d, work_style: { ...d.work_style, communication: v } })} />
            </Card>
            <Card title="My projects" on={true} note="Your own projects. Others' projects: ask their owner to join.">
              {d.projects.length ? (
                d.projects.map((p, i) => (
                  <ProjectRow
                    key={i}
                    p={p}
                    make={!!makeProjects[i]}
                    taken={known.some((k) => same(k, p.name))}
                    onMake={(v) => setMakeProjects({ ...makeProjects, [i]: v })}
                    onChange={(np) => setD({ ...d, projects: d.projects.map((x, j) => (j === i ? np : x)) })}
                    onRemove={() => setD({ ...d, projects: d.projects.filter((_, j) => j !== i) })}
                  />
                ))
              ) : (
                <p className="sm muted">None listed. You can create projects later from Projects.</p>
              )}
              {d.projects.length < 8 && (
                <button className="more" type="button" onClick={() => setD({ ...d, projects: [...d.projects, { name: '', line: '', status: 'active', link: '' }] })}>
                  <Icon name="plus" size="s" /> Add a project of yours
                </button>
              )}
            </Card>
            <Card title="How you log" on={inc.log} onToggle={(v) => setInc({ ...inc, log: v })}>
              <div className="pp-chips">
                {(['minimal', 'dev', 'designer', 'learning'] as const).map((k) => (
                  <button key={k} className="qchip" type="button" aria-pressed={d.log.preset === k && !d.log.kinds.length && !d.log.fields.length} onClick={() => setD({ ...d, log: { preset: k, kinds: [], fields: [] } })}>
                    {PRESET_LABEL[k]}
                  </button>
                ))}
              </div>
              <p className="sm fg2">
                Check-ins ask: {logCfg.fields.map((f) => f.label + (f.required ? '*' : '')).join(' · ')} · kinds: {logCfg.kinds.map(kindLabel).join(', ')}
              </p>
              {warn.length > 0 && <p className="hint warn-t">{warn.join(', ')} looks personal: the team and HQ's AI can read it.</p>}
            </Card>
            {Object.keys(d.ui).length > 0 && (
              <Card title="How you like your screen" on={inc.ui} onToggle={(v) => setInc({ ...inc, ui: v })} note="Only on your devices' look; change it any time in Adjust look.">
                <div className="pp-chips">
                  {Object.entries(d.ui).map(([k, v]) => (
                    <span key={k} className="chip line">
                      {UI_WORDS[k] || k}: {v}
                    </span>
                  ))}
                </div>
              </Card>
            )}
          </div>
          {err && (
            <p className="pp-err" role="alert">
              <Icon name="alert" size="s" /> {err}
            </p>
          )}
          <div className="pp-ctrl">
            <button className="btn ghost sm" type="button" onClick={() => setStep(manual && !intake ? 1 : 2)}>
              <Icon name="chevL" size="s" />
              Back
            </button>
            <span style={{ flex: 1 }} />
            <button
              className="btn primary"
              type="button"
              onClick={() => {
                if (!unguess(d.identity.name)) return setErr('Add your name first')
                setErr('')
                setStep(4)
              }}
            >
              Next
              <Icon name="arrow" size="s" />
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="ob-body">
          <ul className="ob-sum">
            <li>
              <Icon name="user" />
              <span>
                Your profile <span className="hint">· {profilePathFor(me.login)} · one commit with your own token</span>
              </span>
            </li>
            {inc.log && (
              <li>
                <Icon name="gear" />
                <span>Log settings · {logCfg.fields.map((f) => f.label).join(', ')}</span>
              </li>
            )}
            {Object.values(makeProjects).some(Boolean) && (
              <li>
                <Icon name="projects" />
                <span>
                  New projects you own:{' '}
                  {d.projects
                    .filter((_, i) => makeProjects[i])
                    .map((p) => p.name)
                    .join(', ')}
                </span>
              </li>
            )}
            {inc.ui && Object.keys(d.ui).length > 0 && (
              <li>
                <Icon name="wand" />
                <span>Your look · {Object.keys(d.ui).length} setting{Object.keys(d.ui).length === 1 ? '' : 's'}</span>
              </li>
            )}
          </ul>
          {intake.trim() && (
            <label className="ob-keep">
              <input type="checkbox" checked={keepIntake} onChange={(e) => setKeepIntake(e.target.checked)} />
              <span>
                Keep my intake in HQ <span className="hint">(visible to the team + AI)</span>
              </span>
            </label>
          )}
          <Callout icon="eye">Everything you save here is visible to the team and to HQ's AI.</Callout>
          {err && (
            <p className="pp-err" role="alert">
              <Icon name="alert" size="s" /> {err}
            </p>
          )}
          {readOnly && (
            <p className="pp-err" role="note">
              <Icon name="info" size="s" /> Viewing only: set HQ_LOCAL_LOGIN in .env.local to save your profile.
            </p>
          )}
          <div className="pp-ctrl">
            <button className="btn ghost sm" type="button" onClick={() => setStep(3)}>
              <Icon name="chevL" size="s" />
              Back
            </button>
            <span style={{ flex: 1 }} />
            <button className="btn primary" type="button" onClick={save} disabled={busy || readOnly}>
              {busy ? 'Saving…' : has ? 'Save my profile' : 'Save · join HQ'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
export default Onboarding

// ---- small parts ----

function Card(p: { title: string; on: boolean; onToggle?: (v: boolean) => void; required?: boolean; note?: string; children: React.ReactNode }) {
  return (
    <div className={'ob-card' + (p.on ? '' : ' off')}>
      <div className="ob-ch">
        <b>{p.title}</b>
        {p.onToggle && !p.required && (
          <label className="ob-inc">
            <input type="checkbox" checked={p.on} onChange={(e) => p.onToggle!(e.target.checked)} />
            include
          </label>
        )}
      </div>
      {p.note && <p className="hint">{p.note}</p>}
      {p.on && <div className="ob-cb">{p.children}</div>}
    </div>
  )
}

function Field({ label, value, max, onChange }: { label: string; value: string; max: number; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>
        {label}
        {isGuess(value) && <span className="chip warn ob-guess">guess</span>}
      </span>
      <input className="inp sm" value={value} maxLength={max + 8} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function ChipList({ items, max, len, label, onChange }: { items: string[]; max: number; len: number; label: string; onChange: (x: string[]) => void }) {
  const [v, setV] = useState('')
  const add = () => {
    const t = line(v, len)
    if (!t || items.length >= max || items.some((x) => same(x, t))) return setV('')
    onChange([...items, t])
    setV('')
  }
  return (
    <div className="pp-chips">
      {items.map((x) => (
        <span key={x} className={'chip line' + (isGuess(x) ? ' warn' : '')}>
          {x}
          <button className="chip-x" type="button" aria-label={`Remove ${x}`} onClick={() => onChange(items.filter((y) => y !== x))}>
            <Icon name="x" />
          </button>
        </span>
      ))}
      {items.length < max && (
        <input
          className="inp sm ob-add"
          aria-label={`Add a ${label}`}
          placeholder={`+ ${label}`}
          maxLength={len}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add()
            }
          }}
          onBlur={add}
        />
      )}
    </div>
  )
}

function SkillList({ skills, onChange }: { skills: DraftSkill[]; onChange: (s: DraftSkill[]) => void }) {
  const set = (i: number, patch: Partial<DraftSkill>) => onChange(skills.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  return (
    <div className="ob-skills">
      {skills.map((s, i) => (
        <div className="ob-skill" key={i}>
          <input className="inp sm" aria-label="Skill" value={s.name} maxLength={40} onChange={(e) => set(i, { name: e.target.value })} />
          <span className="ob-lv" role="group" aria-label={`Level of ${s.name || 'skill'}`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" aria-pressed={s.level === n} aria-label={`Level ${n}`} onClick={() => set(i, { level: n })}>
                {n}
              </button>
            ))}
          </span>
          <span className={'hint ob-ev' + (isGuess(s.evidence) || isGuess(s.name) ? ' warn-t' : '')} title={s.evidence}>
            {isGuess(s.evidence) || isGuess(s.name) ? 'guess · ' : ''}
            {unguess(s.evidence)}
          </span>
          <button className="icon-btn" type="button" aria-label={`Remove ${s.name || 'skill'}`} onClick={() => onChange(skills.filter((_, j) => j !== i))}>
            <Icon name="x" size="s" />
          </button>
        </div>
      ))}
      {skills.length < 12 && (
        <button className="more" type="button" onClick={() => onChange([...skills, { name: '', level: 3, evidence: '' }])}>
          <Icon name="plus" size="s" /> Add a skill
        </button>
      )}
    </div>
  )
}

function ProjectRow(p: { p: DraftProject; make: boolean; taken: boolean; onMake: (v: boolean) => void; onChange: (p: DraftProject) => void; onRemove: () => void }) {
  return (
    <div className="ob-proj">
      <input className="inp sm" aria-label="Project name" value={p.p.name} maxLength={60} onChange={(e) => p.onChange({ ...p.p, name: e.target.value })} />
      <input className="inp sm" aria-label="One line about it" placeholder="one line" value={p.p.line} maxLength={140} onChange={(e) => p.onChange({ ...p.p, line: e.target.value })} />
      <label className="ob-inc" data-tipt={p.taken ? 'A project with this name is already in HQ: ask its owner to join' : 'Creates projects/<name>/project.md with you as owner'}>
        <input type="checkbox" checked={p.make && !p.taken} disabled={p.taken || !p.p.name.trim()} onChange={(e) => p.onMake(e.target.checked)} />
        create in HQ
      </label>
      <button className="icon-btn" type="button" aria-label={`Remove ${p.p.name || 'project'}`} onClick={p.onRemove}>
        <Icon name="x" size="s" />
      </button>
    </div>
  )
}

function JoinRow({ slug, title, owner }: { slug: string; title: string; owner: string }) {
  const { model, me, source, reload } = useHQ()
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const ask = async () => {
    if (busy) return
    setBusy(true)
    try {
      await requestJoin(source, me, model, { project: slug })
      setSent(true)
      toast(`Asked ${owner} to join ${title}`, 'ok')
      await reload()
    } catch (e: any) {
      toast(String(e?.message || e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="row" role="listitem">
      <span className="t">{title}</span>
      <span className="meta">owner {owner}</span>
      {sent ? (
        <span className="chip ok">
          <Icon name="check" />
          asked
        </span>
      ) : (
        <button className="btn sm" type="button" onClick={ask} disabled={busy}>
          Ask to join
        </button>
      )}
    </div>
  )
}
