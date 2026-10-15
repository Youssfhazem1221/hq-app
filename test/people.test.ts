// people.ts: the People writers (own log, profile, log settings, help requests, projects and teams, join/leave)
// and selectors (personCtx, forYouFor, quickEntry, seenStore), on the synthetic fixture (alice, bob, carol) in an
// in-memory Source that runs the real updateLoop. Includes M2 acceptance (9). Skips without the fixture.
import test from 'node:test'
import assert from 'node:assert/strict'
import YAML from 'yaml'
import { app, filesOf, fixture, memSource } from './helpers.ts'

const F = await fixture()
const skip = !F && 'fixture not available (public app repo)'
const P = await app('lib/people')
const { buildModel, saveProfile } = await app('lib/hq')
const { parse } = await app('lib/md')
const core = await app('lib/people-core')
const NOW = F?.NOW || '2026-10-18T05:07:00Z'
const alice = { login: 'alice', name: 'Alice' }
const bob = { login: 'bob', name: 'Bob' }
const carol = { login: 'carol', name: 'carol' }
const ALOG = 'people/alice/log/2026-10.md'
const BLOG = 'people/bob/log/2026-10.md'

async function setup() {
  const mem = await memSource(filesOf(F!.FILES))
  return { ...mem, model: buildModel(F!.FILES) }
}
/** Lines of b that differ from a (same line count assumed only where it matters). */
const diff = (a: string, b: string) => {
  const A = a.split('\n')
  const B = b.split('\n')
  return { removed: A.filter((l) => !B.includes(l)), added: B.filter((l) => !A.includes(l)) }
}
const fmOf = (text: string) => parse('x.md', text).data

// ---- projects (Y3: owner only) ----

test('(9) setProjectTeam as a non-owner throws before any PUT (with and without the model)', { skip }, async () => {
  const { src, puts, model } = await setup()
  const team = { members: ['bob', 'carol'], roles: {}, helpWanted: [] }
  await assert.rejects(P.setProjectTeam(src, bob, 'demo', team, model, NOW), /Only alice can change this project/)
  await assert.rejects(P.setProjectTeam(src, bob, 'demo', team, undefined, NOW), /Only alice can change this project/)
  assert.equal(puts.length, 0)
})

test('setProjectTeam as the owner: only members, roles, help_wanted, updated, updated_by change; same team → no write', { skip }, async () => {
  const { src, data, puts, model } = await setup()
  const before = data.get('projects/demo/project.md')!
  const written = await P.setProjectTeam(src, alice, 'demo', {
    members: ['bob', 'carol'], roles: { alice: 'lead, research', bob: 'mobile app', carol: 'onboarding copy' }, helpWanted: ['Android build', 'Copy review'],
  }, model, NOW)
  assert.equal(written, true)
  assert.equal(puts.length, 1)
  assert.equal(puts[0].message, 'project: team demo by alice')
  const after = data.get('projects/demo/project.md')!
  const keys = (ls: string[]) => [...new Set(ls.map((l) => (l.match(/^([a-z_]+):/) || [])[1] || 'list item'))].sort()
  const d = diff(before, after)
  assert.deepEqual(d.removed, ['updated: 2026-10-16', 'members: [bob]'], 'existing role and help lines stay byte-identical')
  assert.deepEqual(keys(d.added), ['list item', 'members', 'updated'])
  assert.deepEqual(d.added.filter((l) => l.startsWith('  - ')), ['  - bob', '  - carol', '  - "carol=onboarding copy"', '  - Copy review'])
  const fm = fmOf(after)
  assert.deepEqual(fm.members, ['bob', 'carol'])
  assert.deepEqual(fm.roles, ['alice=lead · research', 'bob=mobile app', 'carol=onboarding copy'], 'commas → " ·" (F32)')
  assert.deepEqual(fm.help_wanted, ['Android build', 'Copy review'])
  assert.equal(fm.updated, P.dayOf(NOW))
  assert.equal(fm.updated_by, 'alice')
  assert.equal(fm.milestones[0].text, 'Login screen', 'other keys keep their values')
  assert.ok(after.endsWith('# Demo app\n\nFixture project for the people-core tests.\n'), 'body untouched')
  // the same team again: nothing to write
  assert.equal(await P.setProjectTeam(src, alice, 'demo', { members: ['bob', 'carol'], roles: fm.roles.reduce((m: any, r: string) => ({ ...m, [r.split('=')[0]]: r.split('=')[1] }), {}), helpWanted: fm.help_wanted }, model, NOW), false)
  assert.equal(puts.length, 1)
  await assert.rejects(P.setProjectTeam(src, alice, 'demo', { members: ['claude'], roles: {}, helpWanted: [] }, model, NOW), /Not a teammate/)
  await assert.rejects(P.setProjectTeam(src, alice, 'demo', { members: [], roles: {}, helpWanted: ['a', 'b', 'c', 'd', 'e', 'f'] }, model, NOW), /At most 5/)
  assert.equal(puts.length, 1)
})

test('createProject: create-only from the hq.mjs template, I own it; an existing slug fails cleanly (no overwrite)', { skip }, async () => {
  const { src, data, puts, model } = await setup()
  const r = await P.createProject(src, bob, { title: 'Map  app' }, model, NOW)
  assert.deepEqual(r, { slug: 'map-app', path: 'projects/map-app/project.md', color: 2 })
  const text = data.get(r.path)!
  // demo + solo have no color: → both show slot 1, so the new project gets the lowest free slot, 2
  assert.equal(text, P.projectTemplate('Map app', 'map-app', 'bob', P.dayOf(NOW), 2))
  const fm = fmOf(text)
  assert.deepEqual([fm.title, fm.type, fm.owner, fm.status, fm.color, fm.started, fm.updated], ['Map app', 'project', 'bob', 'active', 2, P.dayOf(NOW), P.dayOf(NOW)])
  assert.equal(puts[0].message, 'project: new map-app by bob')
  await assert.rejects(P.createProject(src, bob, { title: 'Demo' }, model, NOW), /already exists/)
  await assert.rejects(P.createProject(src, bob, { title: 'Solo', slug: 'solo' }, undefined, NOW), /already exists/, 'without the model: the file check')
  assert.equal(puts.length, 1)
  assert.equal(data.get('projects/solo/project.md'), F!.FILES.find((f) => f.path === 'projects/solo/project.md')!.text)
  await assert.rejects(P.createProject(src, bob, { title: '  ' }, model, NOW), /needs a title/)
})

test('createProject: several projects made from one model (onboarding) each get their own colour slot', { skip }, async () => {
  const { src, data, model } = await setup()
  const used: number[] = []
  for (const title of ['Notes app', 'Recipe site', 'Garden log']) used.push((await P.createProject(src, bob, { title, usedColors: used }, model, NOW)).color)
  assert.deepEqual(used, [2, 3, 4], 'demo + solo show slot 1; then the lowest free slot each time')
  assert.equal(fmOf(data.get('projects/garden-log/project.md')!).color, 4)
})

test('requestJoin / requestLeave: posts to the owner with request + part; refused when already on / not on it', { skip }, async () => {
  const { src, data, puts, model } = await setup()
  const path = await P.requestJoin(src, bob, model, { project: 'solo', part: 'research, notes' })
  const fm = fmOf(data.get(path)!)
  assert.deepEqual([fm.author, fm.to, fm.project, fm.request, fm.part, fm.type, fm.for_claude, fm.status], ['bob', 'alice', 'solo', 'join', 'research · notes', 'question', false, 'open'])
  assert.match(data.get(path)!, /🙋 I'd like to join solo as: research · notes/)
  await assert.rejects(P.requestJoin(src, bob, model, { project: 'demo' }), /already on demo/)
  await assert.rejects(P.requestJoin(src, alice, model, { project: 'solo' }), /already on solo/)
  const leave = await P.requestLeave(src, bob, model, { project: 'demo' })
  assert.deepEqual([fmOf(data.get(leave)!).request, fmOf(data.get(leave)!).to], ['leave', 'alice'])
  await assert.rejects(P.requestLeave(src, bob, model, { project: 'solo' }), /not a member/)
  assert.equal(puts.length, 2)
})

test('answerJoin add: team + close + reply (3 PUTs); the project diff touches only team lines', { skip }, async () => {
  const { src, data, puts, model } = await setup()
  const POST = 'board/20261016-071500-bob-q1z.md'
  const before = data.get('projects/solo/project.md')!
  await P.answerJoin(src, alice, model, model.byPath.get(POST), 'add', NOW)
  assert.deepEqual(puts.map((p) => p.path.replace(/--.*$/, '--<id>')), ['projects/solo/project.md', POST, 'board/replies/20261016-071500-bob-q1z--<id>'])
  const d = diff(before, data.get('projects/solo/project.md')!)
  assert.deepEqual(d.removed, ['updated: 2026-10-16'])
  // `updated` is replaced in place; the new keys go just before the closing ---
  assert.deepEqual(d.added, [`updated: ${P.dayOf(NOW)}`, 'members:', '  - bob', 'roles:', '  - "bob=research help"', 'updated_by: alice'])
  assert.deepEqual(core.membersOf('solo', [{ path: 'projects/solo/project.md', data: fmOf(data.get('projects/solo/project.md')!) }]), [
    { login: 'alice', role: 'owner' }, { login: 'bob', role: 'member', part: 'research help' },
  ])
  const post = fmOf(data.get(POST)!)
  assert.deepEqual([post.status, post.closed_by, post.closed_at], ['done', 'alice', NOW])
  assert.match(puts[2].text, /parent: 20261016-071500-bob-q1z/)
  assert.match(puts[2].text, /✅ Added as research help/)
  // only the owner answers
  await assert.rejects(P.answerJoin(src, bob, model, model.byPath.get(POST), 'add', NOW), /This request is for alice/)
})

test('answerJoin decline: reply + close (2 PUTs), no project change; answerLeave removes the member (3 PUTs)', { skip }, async () => {
  const { src, data, puts, model } = await setup()
  const POST = 'board/20261016-071500-bob-q1z.md'
  await P.answerJoin(src, alice, model, model.byPath.get(POST), 'decline', NOW)
  assert.deepEqual(puts.map((p) => p.path.split('--')[0]), ['board/replies/20261016-071500-bob-q1z', POST])
  assert.equal(fmOf(data.get(POST)!).status, 'done')
  const leavePath = await P.requestLeave(src, bob, model, { project: 'demo' })
  const m2 = buildModel([...data].map(([path, text]) => ({ path, text })))
  puts.length = 0
  await P.answerLeave(src, alice, m2, m2.byPath.get(leavePath), NOW)
  assert.equal(puts.length, 3)
  const fm = fmOf(data.get('projects/demo/project.md')!)
  assert.equal(fm.members, undefined, 'last member gone → the key is removed')
  assert.deepEqual(fm.roles, ['alice=lead · research'])
  assert.deepEqual(fm.help_wanted, ['Android build'])
})

// ---- own log ----

test('appendLog: one row in MY month file; twice → one row, no second write; a new month is created deterministically', { skip }, async () => {
  const { src, data, puts, model } = await setup()
  const t = P.logTargetFor(model, 'alice')
  const e = { at: '2026-10-17T09:00:00Z', kind: 'done', project: 'demo', fields: { did: 'Wrote the app tests', minutes: 30 }, ref: [] }
  const r = await P.appendLog(src, alice, e, t)
  assert.deepEqual(r, { written: true, path: ALOG, when: '17 Oct 12:00' })
  assert.equal(puts[0].message, 'log: done from alice')
  assert.ok(data.get(ALOG)!.endsWith('## Sat 17 Oct\n\n| When | Kind | Project | Did | Time | Energy | Ref |\n|---|---|---|---|---|---|---|\n| 17 Oct 12:00 | ✅ done | demo | Wrote the app tests | 30 | — | — |\n'))
  assert.equal((await P.appendLog(src, alice, e, t)).written, false)
  assert.equal(puts.length, 1)
  const nov = { ...e, at: '2026-11-02T08:00:00Z' }
  const r2 = await P.appendLog(src, alice, nov, t)
  assert.equal(r2.path, 'people/alice/log/2026-11.md')
  assert.equal(data.get(r2.path), core.appendEntry(null, nov, t.cfg, 'alice', 'Africa/Cairo'))
  await assert.rejects(P.appendLog(src, alice, { ...e, fields: { minutes: 5 } }, t), /Did is required/)
  await assert.rejects(P.appendLog(src, alice, { ...e, at: 'yesterday' }, t), /not valid/)
  assert.equal(puts.length, 2)
  assert.equal(P.logTargetFor(model, 'carol'), null, 'no profile → no check-in target')
})

test('editLogRow / removeLogRow: own rows ≤7 days only, in place; others\' logs and moves to another month refused', { skip }, async () => {
  const { src, data, puts, model } = await setup()
  const cfg = P.logTargetFor(model, 'alice').cfg
  assert.equal(await P.editLogRow(src, alice, ALOG, '16 Oct 17:20', { fields: { did: 'Solo research notes v2', minutes: 75 } }, cfg, NOW), true)
  const row = core.parseLog(data.get(ALOG)!, cfg).find((x: any) => x.when === '16 Oct 17:20')
  assert.deepEqual([row.fields.did, row.fields.minutes, row.project], ['Solo research notes v2', 75, 'solo'])
  assert.equal(puts[0].message, 'log: fix from alice')
  await assert.rejects(P.removeLogRow(src, alice, ALOG, '2 Oct 11:00', cfg, NOW), /older than 7 days/)
  await assert.rejects(P.removeLogRow(src, alice, BLOG, '16 Oct 13:00', cfg, NOW), /your own log/)
  await assert.rejects(P.editLogRow(src, alice, ALOG, '16 Oct 14:00', { at: '2026-11-01T10:00:00Z' }, cfg, NOW), /stays in its month/)
  await assert.rejects(P.removeLogRow(src, alice, ALOG, '1 Oct 00:00', cfg, NOW), /is gone/)
  assert.equal(await P.removeLogRow(src, alice, ALOG, '16 Oct 17:20', cfg, NOW), true)
  assert.equal(core.parseLog(data.get(ALOG)!, cfg).length, 10)
  assert.equal(puts.length, 2)
})

test('askForHelp: a to-do for the teammate pointing at my blocker row; refused for other logs, myself or bots', { skip }, async () => {
  const { src, data } = await setup()
  const path = await P.askForHelp(src, alice, { logPath: ALOG, when: '16 Oct 14:00', to: '@bob', title: 'Need the Android build\nto test', project: 'demo' })
  const fm = fmOf(data.get(path)!)
  assert.deepEqual([fm.title, fm.owner, fm.by, fm.project, fm.status, fm.blocker], ['Help: Need the Android build to test', 'bob', 'alice', 'demo', 'todo', `${ALOG}#16 Oct 14:00`])
  await assert.rejects(P.askForHelp(src, alice, { logPath: BLOG, when: '16 Oct 10:30', to: 'bob', title: 'x' }), /your own log/)
  await assert.rejects(P.askForHelp(src, alice, { logPath: ALOG, when: '16 Oct 14:00', to: 'alice', title: 'x' }), /teammate/)
  await assert.rejects(P.askForHelp(src, alice, { logPath: ALOG, when: '16 Oct 14:00', to: 'claude', title: 'x' }), /teammate/)
})

// ---- profile and log settings ----

test('saveLogConfig: block-style log: block, only those lines change, reads back the same; unchanged → no write', { skip }, async () => {
  const { src, data, puts, model } = await setup()
  const before = data.get('people/alice.md')!
  const cfg = structuredClone(P.logTargetFor(model, 'alice').cfg)
  assert.equal((await P.saveLogConfig(src, alice, cfg)).written, false, 'the fixture block is already in the app\'s exact format')
  cfg.goals = [{ metric: 'minutes', per: 'week', target: 300 }]
  cfg.fields.push({ key: 'mood', label: 'Mood', type: 'scale', max: 5 })
  const r = await P.saveLogConfig(src, alice, cfg)
  assert.deepEqual([r.written, r.errors], [true, []])
  assert.equal(puts.length, 1)
  assert.equal(puts[0].message, 'people: log settings alice')
  const after = data.get('people/alice.md')!
  assert.ok(!/log:[\s\S]*\{/.test(after.split('---')[1]), 'no flow maps (C1)')
  const outside = (t: string) => t.replace(/\nlog:\n(  .*\n)+/, '\n<log>\n')
  assert.equal(outside(after), outside(before), 'every line outside the log: block is byte-identical')
  assert.deepEqual(core.validateConfig(fmOf(after).log), { config: cfg, errors: [] })
  assert.equal((await P.saveLogConfig(src, alice, cfg)).written, false)
  // invalid parts are dropped and listed
  const bad = await P.saveLogConfig(src, alice, { ...cfg, fields: [...cfg.fields, { key: 'When', type: 'text' }] })
  assert.ok(bad.errors.length > 0)
  await assert.rejects(P.saveLogConfig(src, carol, cfg), /profile first/)
})

test('saveProfilePatch: onboarding creates one file; a patch changes only its keys; maps go in block style', { skip }, async () => {
  const { src, data, puts } = await setup()
  const log = structuredClone(core.PRESETS.designer)
  assert.equal(await P.saveProfilePatch(src, carol, {
    name: 'Carol', pronouns: 'she/her', timezone: 'Africa/Cairo', status: 'active', role: 'Designer (fixture)', ask_me_about: ['UI copy'], log, github: 'mallory',
  }, { body: 'Synthetic test person (fixture).' }), true)
  assert.equal(puts.length, 1)
  const carolText = data.get('people/carol.md')!
  assert.ok(carolText.startsWith('---\nname: Carol\ngithub: carol\n'), 'name first, github = my login (never another)')
  assert.ok(!carolText.includes('{'), 'block style')
  const roster = core.rosterOf([{ path: 'people/carol.md', data: fmOf(carolText) }])
  assert.deepEqual([roster[0].login, roster[0].log.preset, roster[0].pronouns], ['carol', 'designer', 'she/her'])

  const before = data.get('people/alice.md')!
  assert.equal(await P.saveProfilePatch(src, alice, { pronouns: 'they/them', focus: 'Tests, then UI' }), true)
  const d = diff(before, data.get('people/alice.md')!)
  assert.deepEqual(d.removed, ['pronouns: she/her', 'focus: Demo login + solo research'])
  assert.deepEqual(d.added, ['pronouns: they/them', 'focus: "Tests, then UI"'])
  assert.equal(await P.saveProfilePatch(src, alice, { pronouns: 'they/them' }), false, 'unchanged → no write')
  await P.saveProfilePatch(src, alice, { links: { site: 'https://example.invalid/alice' } }, { body: 'New bio.' })
  const t = data.get('people/alice.md')!
  assert.match(t, /\nlinks:\n {2}site: https:\/\/example\.invalid\/alice\n---\n\nNew bio\.\n$/)
  assert.equal(fmOf(t).log.fields.length, 3, 'the log block is untouched')
})

test('saveProfile (old form) merges: keys the form left unchanged keep the newer saved value', { skip }, async () => {
  const { src, data } = await setup()
  const base = fmOf(data.get('people/alice.md')!)
  // meanwhile, another device changed the pronouns
  data.set('people/alice.md', data.get('people/alice.md')!.replace('pronouns: she/her', 'pronouns: they/them'))
  await saveProfile(src, alice, { ...base, role: 'New role (fixture)' }, 'Bio.', base)
  const fm = fmOf(data.get('people/alice.md')!)
  assert.deepEqual([fm.role, fm.pronouns, fm.github, fm.log.preset], ['New role (fixture)', 'they/them', 'alice', 'custom'])
})

// ---- selectors ----

test('quickEntry: the one-line check-in → entry + chips + errors', { skip }, async () => {
  const { model } = await setup()
  const q = P.quickEntry(model, 'alice', '#win +de 45m fixed it @bo energy=4', NOW)
  assert.deepEqual(q.entry, { at: NOW, kind: 'win', project: 'demo', fields: { minutes: 45, energy: 4, did: 'fixed it' }, ref: ['@bob'] })
  assert.deepEqual(q.errors, [])
  assert.deepEqual(q.chips, ['🏆 win', 'demo', '45 min', '⚡4', '@bob'])
  assert.deepEqual(P.quickEntry(model, 'alice', '45m +so', NOW).errors, ['Did is required'])
})

test('forYouFor = core forYou on the model; seenStore keeps only a time + short hashes and survives bad storage', { skip }, async () => {
  const { model } = await setup()
  const seen = { at: '', ack: [] }
  assert.deepEqual(P.forYouFor(model, bob, NOW, seen), core.forYou('bob', model.all, model.logEntries, seen, NOW))
  // 2 replies (alice on both of bob's posts; the one that also says @bob counts once) + 1 mention (alice's 15 Oct row)
  assert.deepEqual(P.forYouFor(model, 'bob', NOW, seen).map((i: any) => i.kind), ['help', 'assigned', 'to-me', 'added', 'reply', 'reply', 'mention', 'digest'])

  const mem = new Map<string, string>()
  const ls = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true })
  try {
    assert.deepEqual(P.seenStore.get('Bob'), { at: '', ack: [] })
    const added = P.forYouFor(model, 'bob', NOW).find((i: any) => i.kind === 'added')
    P.seenStore.ack('bob', added.hash)
    P.seenStore.markSeen('bob', NOW)
    P.seenStore.markSeen('bob', '2026-01-01T00:00:00Z')
    assert.deepEqual(JSON.parse(mem.get('hq.seen.bob')!), { at: NOW, ack: [added.hash] }, 'no text, no paths; time never moves back')
    const after = P.forYouFor(model, 'bob', NOW)
    assert.ok(!after.some((i: any) => i.kind === 'added'), '[Got it] removes "added"')
    assert.ok(!after.some((i: any) => ['reply', 'mention', 'digest'].includes(i.kind)), 'seen items drop out')
    mem.set('hq.seen.bob', '{"at": 5, "ack": ["../secret path", "zz", "0123abcd", "0123abcd"]}')
    assert.deepEqual(P.seenStore.get('bob'), { at: '', ack: ['0123abcd'] })
    mem.set('hq.seen.bob', 'not json')
    assert.deepEqual(P.seenStore.get('bob'), { at: '', ack: [] })
    Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('blocked') }, configurable: true })
    assert.deepEqual(P.seenStore.get('bob'), { at: '', ack: [] })
    P.seenStore.ack('bob', '0123abcd')
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had)
    else delete (globalThis as any).localStorage
  }
})

test('personCtx(alice) as alice: projects, counts, goals, time, blockers, waits, For you, Next = the core functions', { skip }, async () => {
  const { model } = await setup()
  const seen = { at: '', ack: [] }
  const c = P.personCtx(model, 'Alice', NOW, { viewer: 'alice', seen })
  assert.deepEqual([c.login, c.slug, c.isMe, c.isClaude, c.tz], ['alice', 'alice', true, false, 'Africa/Cairo'])
  assert.deepEqual(c.projects.map((p: any) => [p.slug, p.role]), [['demo', 'owner'], ['solo', 'owner']])
  assert.equal(c.entries.length, 11)
  assert.equal(c.profile.path, 'people/alice.md')
  const own = core.deriveEvents(model.all, { logs: model.logEntries, viewer: 'alice' })
  assert.ok(c.events.some((e: any) => e.kind === 'ai.question' && e.title === "What's waiting on me?"), 'own question text on own page')
  assert.deepEqual(c.week, { from: '2026-10-17T21:00:00Z', to: '2026-10-18T05:07:01Z', counts: core.summarize(own, 'alice', '2026-10-17T21:00:00Z', '2026-10-18T05:07:01Z') })
  assert.deepEqual(c.lastWeek.counts, core.summarize(own, 'alice', '2026-10-10T21:00:00Z', '2026-10-17T21:00:00Z'))
  assert.equal(c.lastWeek.counts.checkins, 7)
  assert.deepEqual(c.goals.map((g: any) => g.label), ['0 of 4 this week'])
  assert.deepEqual(c.time, core.timeByProject(c.entries, c.cfg, 8, NOW, 'Africa/Cairo'))
  assert.deepEqual(c.openBlockers.map((e: any) => e.when), ['16 Oct 14:00'])
  const waits = core.waitingOn(model.all, model.logEntries, NOW)
  assert.deepEqual(c.waitingOn, waits.filter((w: any) => w.waiter === 'alice'))
  assert.deepEqual(c.waitingForThem, waits.filter((w: any) => w.on === 'alice'))
  assert.equal(c.lastCheckin, '2026-10-16T14:20:00Z')
  assert.equal(c.quiet, false)
  assert.deepEqual(c.forYou, core.forYou('alice', model.all, model.logEntries, seen, NOW))
  assert.deepEqual(c.next, core.nextLine('alice', c.person, { events: own, forYou: c.forYou, waits, now: NOW, nameOf: P.nameOf(model) }))
})

test('personCtx: someone else\'s page has no For you and hides their AI text; a ghost login; Claude', { skip }, async () => {
  const { model } = await setup()
  const b = P.personCtx(model, 'bob', NOW, { viewer: 'alice' })
  assert.deepEqual([b.isMe, b.forYou], [false, []])
  assert.ok(b.events.filter((e: any) => e.kind === 'ai.question').every((e: any) => e.title === 'asked AI'))
  // bob's join request is on solo; only his 16 Oct blocker is still open (the others were unblocked or helped)
  assert.equal(b.next.text, 'Bob · on demo, solo · last check-in 1 day ago · 1 open blocker')
  assert.deepEqual(b.openBlockers.map((e: any) => e.when), ['16 Oct 10:30'])
  const g = P.personCtx(model, 'carol', NOW, { viewer: 'alice' })
  assert.deepEqual([g.person, g.next.text, g.projects], [null, 'carol · no profile yet', []])
  assert.deepEqual(g.waitingForThem.map((w: any) => w.waiter), ['alice'])
  const cl = P.personCtx(model, 'claude', NOW)
  assert.deepEqual([cl.isClaude, cl.person.name, cl.entries.length, cl.projects], [true, 'Claude', 2, []])
  // a quiet week: nudge after 3 days (amber, never red)
  const later = P.personCtx(model, 'alice', '2026-10-21T12:00:00Z', { viewer: 'alice', seen: { at: '', ack: [] } })
  assert.equal(later.quiet, true)
})

// ---- review fixes (2026-10-15 re-check) ----

const filesFrom = (data: Map<string, string>) => [...data].map(([path, text]) => ({ path, text }))

test('review F3: a stray profile naming alice in github: changes nothing (roster and displayName go by path)', { skip }, async () => {
  const { displayName } = await app('lib/hq')
  // the stray name sorts before "Alice", so a lookup by `github` over the profiles would pick it first
  const model = buildModel([...F!.FILES, { path: 'people/a.md', text: '---\nname: Aaa Not Alice\ngithub: alice\npronouns: he/him\n---\n' }])
  assert.equal(displayName(model, 'alice'), 'Alice')
  assert.equal(displayName(model, 'ALICE'), 'Alice')
  assert.deepEqual(['name', 'pronouns', 'path'].map((k) => model.roster.find((p: any) => p.login === 'alice')[k]), ['Alice', 'she/her', 'people/alice.md'])
  assert.equal(P.logTargetFor(model, 'alice').tz, 'Africa/Cairo')
})

test("review F9: saveLogConfig keeps a relabelled field's old labels, so older month tables keep counting", { skip }, async () => {
  const { src, data } = await setup()
  const cfg0 = buildModel(F!.FILES).roster.find((p: any) => p.login === 'alice').log
  const relabel = (label: string) => ({ ...cfg0, fields: cfg0.fields.map((f: any) => (f.key === 'energy' ? { key: f.key, label, type: f.type, max: f.max } : f)) })
  const energyRows = (files: { path: string; text: string }[]) => buildModel(files).logEntries.get('alice').filter((e: any) => typeof e.fields.energy === 'number').length
  const before = energyRows(F!.FILES)
  let r = await P.saveLogConfig(src, alice, relabel('Energy level'))
  assert.deepEqual(r.config.fields.find((f: any) => f.key === 'energy').aliases, ['Energy'])
  // a row under the new label, then a second relabel: both older headers still map to `energy`
  const m1 = buildModel(filesFrom(data))
  await P.appendLog(src, alice, { at: '2026-10-17T07:00:00Z', kind: 'done', project: 'demo', fields: { did: 'tuned the build', energy: 3 }, ref: [] }, P.logTargetFor(m1, 'alice'))
  assert.match(data.get(ALOG)!, /\| Did \| Time \| Energy level \| Ref \|/)
  r = await P.saveLogConfig(src, alice, relabel('Vigor'))
  assert.deepEqual(r.config.fields.find((f: any) => f.key === 'energy').aliases, ['Energy level', 'Energy'])
  assert.match(data.get('people/alice.md')!, /\n {6}aliases:\n {8}- Energy level\n {8}- Energy\n/)
  const files = filesFrom(data)
  assert.equal(energyRows(files), before + 1)
  const keys = new Set(buildModel(files).logEntries.get('alice').flatMap((e: any) => Object.keys(e.fields)))
  assert.ok(!keys.has('energy_level') && !keys.has('vigor'), [...keys].join(','))
})

test('review F12: after a time-zone change, a row near midnight stays tied to the file it is in (help to-do, blockers, mentions)', { skip }, async () => {
  const files = filesOf(F!.FILES)
  files['people/bob.md'] = files['people/bob.md'].replace('timezone: Africa/Cairo', 'timezone: America/New_York')
  const { src, data } = await memSource(files)
  let model = buildModel(filesFrom(data))
  const e = { at: '2026-10-31T23:30:00Z', kind: 'blocked', project: 'demo', fields: { did: 'Build server down' }, ref: ['@alice'] }
  const r = await P.appendLog(src, bob, e, P.logTargetFor(model, 'bob'))
  assert.deepEqual([r.path, r.when], [BLOG, '1 Nov 01:30']) // October file (New York date), Cairo wall time (the file's tz)
  const help = await P.askForHelp(src, bob, { logPath: r.path, when: r.when, to: 'alice', title: 'Build server down', project: 'demo' })
  model = buildModel(filesFrom(data))
  const later = '2026-11-01T10:00:00Z'
  assert.ok(!P.forYouFor(model, 'alice', later, { at: '', ack: [] }).some((i: any) => i.path.includes('2026-11.md')), 'no item points at a file that does not exist')
  assert.ok(P.personCtx(model, 'bob', later, { viewer: 'bob' }).openBlockers.some((x: any) => x.when === '1 Nov 01:30'))
  const { setTodoStatus } = await app('lib/hq')
  await setTodoStatus(src, alice, model.byPath.get(help), 'done', '2026-11-01T09:00:00Z')
  model = buildModel(filesFrom(data))
  assert.ok(!P.personCtx(model, 'bob', later, { viewer: 'bob' }).openBlockers.some((x: any) => x.when === '1 Nov 01:30'), 'the done help to-do resolves it')
  // the row can still be fixed in place (it keeps its own month)
  assert.equal(await P.editLogRow(src, bob, BLOG, '1 Nov 01:30', { fields: { did: 'Build server down (rebooting)' } }, P.logTargetFor(model, 'bob').cfg, later), true)
})
