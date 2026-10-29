// Module D (People UI) on the pure parts and the writers it drives: week dots / heatmap / tiles, For-you rows and
// toasts (M3-9 "alice added you to demo" once), the check-in line (M3-1 one row on a double submit), the onboarding
// prompt + profile draft (intake → profile: own facts only, no memberships, model text cleaned), the profile-draft
// client (local route vs GitHub mode, token never in the URL), Together tiles/pairs (team level only, P13), and the
// dev-only sample team never reaching production code paths (D2, static check). Fixture tests skip in the public repo.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { APP, app, fixture, memSource } from './helpers.ts'
import { loadTsx } from './tsx.ts'

const F = await fixture()
const skip = !F && 'fixture not available (public app repo)'
const ui = await app('components/people/people-ui-core')
const core = await app('lib/people-core')
const P = await app('lib/people')
const { buildModel } = await app('lib/hq')
const NOW = F?.NOW || '2026-10-18T05:07:00Z'
const model = F ? buildModel(F.FILES) : null
const alice = { login: 'alice', name: 'Alice' }
const bob = { login: 'bob', name: 'Bob' }
const carol = { login: 'carol', name: 'carol' }

test('words: plurals and the Person sub line never carry a stray "·"', () => {
  assert.equal(ui.peopleSoFar(1), '1 person so far')
  assert.equal(ui.peopleSoFar(2), '2 people so far')
  assert.equal(ui.peopleSoFar(0), '0 people so far')
  assert.deepEqual(ui.subParts({ pronouns: 'they/them', role: '', timezone: 'Africa/Cairo' }), ['they/them', 'Cairo'])
  assert.deepEqual(ui.subParts({ pronouns: '', role: '· designer ·', timezone: '' }), ['designer'])
  for (const p of ui.subParts({ pronouns: ' · ', role: 'a · b', timezone: 'America/New_York' })) assert.ok(!/^[·\s]|[·\s]$/.test(p), p)
  assert.equal(ui.fmtMinutes(45), '45 min')
  assert.equal(ui.fmtMinutes(90), '1.5 h')
  assert.equal(ui.fmtMinutes(0), '')
})

test('week dots, heatmap and tiles from a person log (alice, fixture)', { skip }, () => {
  const ctx = P.personCtx(model, 'alice', NOW, { viewer: 'alice' })
  const wk = ui.weekCounts(ctx.entries, ctx.cfg, ctx.tz, NOW)
  assert.equal(wk.counts.length, 7)
  assert.equal(wk.start, '2026-10-18') // Sun 18 Oct (alice's week starts Sunday; NOW = Sun 08:07 Cairo)
  assert.equal(wk.today, 0)
  assert.deepEqual(wk.counts.slice(1), [null, null, null, null, null, null], 'days still to come are null')
  const heat = ui.heatCells(ctx.entries, ctx.cfg, ctx.tz, NOW, 12)
  assert.equal(heat.cells.length, 84)
  // every row except the 🔓 one counts once: 11 rows in October, 1 of them unblocked
  assert.equal(heat.total, 10)
  const tiles = ui.personTiles(ctx.cfg.tiles, ctx.lastWeek.counts, { minutes: 0 })
  const shown = tiles.filter(Boolean)
  assert.ok(shown.some((t: any) => t.label === 'time this week' && /h$/.test(String(t.value))))
  assert.ok(shown.some((t: any) => t.label === 'wins this week' && t.value === 1))
  // zeros drop out (PageHeader rule): a week with nothing gives no tiles
  assert.deepEqual(ui.personTiles(['minutes', 'wins'], { minutes: 0, wins: 0 }, {}), [null, null])
  const t2 = ui.personTiles(['minutes'], { minutes: 600 }, { minutes: 570 })[0]
  assert.equal(t2.value, '10 h')
  assert.deepEqual(t2.delta, { text: '+0.5 h', good: true })
})

test('For you rows: one control per kind, plain words, age tooltip', { skip }, () => {
  const items = P.forYouFor(model, 'bob', NOW, { at: '', ack: [] })
  assert.ok(items.length >= 4)
  const nameOf = (l: string) => P.nameOf(model)(l)
  const views = items.map((it: any) => [it.kind, ui.forYouView(it, nameOf, NOW, false)])
  const want: Record<string, string> = { help: 'tick', assigned: 'tick', 'to-me': 'open', added: 'gotit', reply: 'open', mention: 'open', digest: 'open', join: 'review', leave: 'review' }
  for (const [kind, v] of views) {
    assert.equal(v.control, want[kind], kind)
    assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(v.text), `no emoji in "${v.text}"`)
    assert.ok(v.href.startsWith('#/'), v.href)
  }
  const added = views.find(([k]: any) => k === 'added')?.[1]
  assert.match(added.text, /^You were added to Demo app as mobile app$/)
  assert.match(added.tip, /^from Alice · /)
  const join = P.forYouFor(model, 'alice', NOW, { at: '', ack: [] }).find((x: any) => x.kind === 'join')
  assert.equal(ui.forYouView(join, nameOf, NOW).control, 'review')
  assert.equal(ui.forYouView({ ...items.find((x: any) => x.kind === 'assigned') || items[0], kind: 'assigned' }, nameOf, NOW, true).control, 'decide')
})

test('decisions: kind: decision, or Pick/Choose/Decide + a link to a doc with options', () => {
  const has = (p: string) => p === 'notes/options.md'
  assert.equal(ui.isDecisionData({ kind: 'decision', title: 'x' }, has), true)
  assert.equal(ui.isDecisionData({ title: 'Pick a direction', link: 'notes/options.md' }, has), true)
  assert.equal(ui.isDecisionData({ title: 'Pick a direction', link: 'notes/other.md' }, has), false)
  assert.equal(ui.isDecisionData({ title: 'Review the plan', link: 'notes/options.md' }, has), false)
})

test('For-you toasts: nothing on the first load, then each new item once, max 2 + "+N more"', () => {
  const it = (id: string, kind = 'assigned', since = '2026-10-10T00:00:00Z') => ({ id, hash: id, kind, from: 'alice', title: 'T ' + id, path: 'todos/' + id + '.md', since, isNew: true })
  assert.deepEqual(ui.newForYou(null, [it('a')]), [])
  assert.deepEqual(ui.newForYou(new Set(['a']), [it('a')]), [])
  assert.deepEqual(ui.newForYou(new Set(['a']), [it('a'), it('b')]).map((x: any) => x.id), ['b'])
  const lines = ui.toastLines([it('b'), it('c'), it('d')], (l: string) => l.toUpperCase())
  assert.deepEqual(lines, ['New to-do from ALICE: T b', 'New to-do from ALICE: T c', '+1 more for you'])
  const added = { ...it('m', 'added'), title: 'demo', part: 'mobile app' }
  assert.deepEqual(ui.toastLines([added], (l: string) => l), ['alice added you to demo (mobile app)'])
})

test('M3-9 · carol added to demo → exactly one toast "Alice added you to Demo app (…)", none after Got it', { skip }, async () => {
  const [{ forYouToasts }] = await loadTsx(['lib/foryou-toasts.ts'])
  const before = buildModel(F!.FILES)
  const first = forYouToasts(null, before, 'carol', NOW)
  assert.deepEqual(first.lines, [], 'first load never toasts')
  const files = F!.FILES.map((f: any) => (f.path === 'projects/demo/project.md' ? { ...f, text: f.text.replace('members: [bob]', 'members: [bob, carol]').replace('  - "bob=mobile app"', '  - "bob=mobile app"\n  - "carol=copy"') } : f))
  const after = buildModel(files)
  // carol has no seen state in node (no localStorage) → seenStore falls back to empty; the added item is new
  const r = forYouToasts(first.ids, after, 'carol', NOW)
  assert.deepEqual(r.lines, ['Alice added you to Demo app (copy)'])
  const again = forYouToasts(r.ids, after, 'carol', NOW)
  assert.deepEqual(again.lines, [], 'the same model never toasts twice')
})

test('check-in: chips override the parsed line; "Reads as" words; M3-1 a double submit gives one row', { skip }, async () => {
  const q = P.quickEntry(model, 'alice', 'fixed the login bug 45m +de energy=4 @bob', NOW)
  const cfg = P.logTargetFor(model, 'alice').cfg
  assert.equal(q.entry.project, 'demo')
  const r = ui.readsAs(q.entry, cfg, (s: string) => s.toUpperCase())
  assert.equal(r.kind, 'done')
  assert.equal(r.project, 'DEMO')
  assert.deepEqual(r.bits, ['45 min', 'energy 4/5', '@bob'])
  const o = ui.applyOverrides(q.entry, cfg, { kind: 'win', project: 'solo', minutes: 90, scale: null })
  assert.equal(o.kind, 'win')
  assert.equal(o.project, 'solo')
  assert.equal(o.fields.minutes, 90)
  assert.equal(o.fields.energy, undefined)
  assert.equal(ui.entryText(o, cfg), 'fixed the login bug')
  assert.match(ui.ciPlaceholder(cfg, 'demo'), /^fixed the login bug 45m \+demo energy=4$/)
  // M3-1: appendLog twice with the same row (a fast double submit) → one row, the second call writes nothing
  const { src } = await memSource(Object.fromEntries(F!.FILES.map((f: any) => [f.path, f.text])))
  const e = { ...o, at: '2026-10-18T06:00:00Z' }
  const a = await P.appendLog(src, alice, e, { cfg, tz: 'Africa/Cairo' })
  const b = await P.appendLog(src, alice, e, { cfg, tz: 'Africa/Cairo' })
  assert.equal(a.written, true)
  assert.equal(b.written, false)
  const text = await src.read(a.path)
  assert.equal(text.split('\n').filter((l: string) => l.includes('fixed the login bug')).length, 1)
})

test('rows: own rows editable for 7 days; days newest first; row time', () => {
  assert.equal(ui.canEditRow({ at: '2026-10-12T10:00:00Z' }, '2026-10-18T05:00:00Z'), true)
  assert.equal(ui.canEditRow({ at: '2026-10-10T10:00:00Z' }, '2026-10-18T05:00:00Z'), false)
  const rows = [
    { date: '2026-10-12', at: '2026-10-12T07:00:00Z', when: '12 Oct 10:00' },
    { date: '2026-10-13', at: '2026-10-13T11:32:00Z', when: '13 Oct 14:32' },
    { date: '2026-10-13', at: '2026-10-13T06:00:00Z', when: '13 Oct 09:00' },
  ]
  const days = ui.logDays(rows)
  assert.deepEqual(days.map((d: any) => d.date), ['2026-10-13', '2026-10-12'])
  assert.deepEqual(days[0].rows.map((r: any) => r.when), ['13 Oct 14:32', '13 Oct 09:00'])
  assert.equal(ui.rowTime('13 Oct 14:32'), '14:32')
  assert.equal(ui.rowTime('29 Oct 02:30 +02:00'), '02:30')
})

test('onboarding prompt: the login is filled in, the host name comes from data, the rules are there', () => {
  const p = ui.intakePrompt('sam-dev', 'Sam')
  assert.ok(p.startsWith("I'm joining Pinwheel, a shared workspace with my friend Sam. Help me write my profile intake for it.\n"))
  assert.ok(p.includes('2. Write ONE file, hq-intake-sam-dev.md, in my home folder, using this template:'))
  assert.ok(p.includes("   # What I'd like to build with Sam"))
  for (const s of ['Never open .credentials.json', 'Use `git log` for counts and dates only.', '- Max ~600 words, short bullets.', '(guess)', '# How I like my screen'])
    assert.ok(p.includes(s), s)
  const host = ui.intakePrompt('sam-dev', null)
  assert.ok(host.startsWith("I'm setting up my profile in Pinwheel, my shared workspace."))
  assert.ok(!host.includes('my friend'))
  assert.equal(ui.byteLength('é'), 2)
  assert.equal(ui.INTAKE_MAX, 20000)
})

test('profile draft: the browser re-cleans model output (tags, enums, links, levels, ui keys)', () => {
  const d = ui.cleanDraft({
    identity: { name: '<b>Sam</b>', pronouns: 'they/them', about: 'x'.repeat(500) },
    role: 'Dev\u202e', focus: 7,
    skills: [{ name: 'RAG', level: 9, evidence: 'repo' }, { name: '', level: 2 }, 'junk'],
    stack: ['TS', 'TS', 3, '<script>'],
    projects: [{ name: 'Mine', line: 'one', status: 'weird', link: 'javascript:alert(1)' }, { name: 'Pub', link: 'https://example.com/x' }],
    ask_me_about: ['a', 'b'], work_style: { timezone: 'Mars/Base', hours: 'mornings' },
    log: { preset: 'dev', kinds: ['done', 'evil'], fields: ['did', 'minutes', 'html'] },
    ui: { theme: 'dark', size: 'xl;background:red', font: 'comic', calm: 'on', html: '<x>' },
    extra: 'dropped',
  })
  assert.equal(d.identity.name, 'Sam')
  assert.equal(d.identity.about.length, 200)
  assert.equal(d.role, 'Dev')
  assert.equal(d.focus, '7')
  assert.deepEqual(d.skills, [{ name: 'RAG', level: 5, evidence: 'repo' }])
  assert.deepEqual(d.stack, ['TS', '3'], 'deduped, tags stripped, plain text only')
  assert.deepEqual(d.projects, [{ name: 'Mine', line: 'one', status: 'active', link: '' }, { name: 'Pub', line: '', status: 'active', link: 'https://example.com/x' }])
  assert.equal(d.work_style.timezone, '')
  assert.deepEqual(d.log, { preset: 'dev', kinds: ['done'], fields: ['did', 'minutes'] })
  assert.deepEqual(d.ui, { theme: 'dark', calm: 'on' })
  assert.equal('extra' in d, false)
  for (const junk of [null, 'x', 42, [], { identity: 'x', skills: 'y', projects: {}, log: [] }]) assert.doesNotThrow(() => ui.cleanDraft(junk))
})

test('profile draft: no links or images in text fields (only a project link field keeps its https link)', () => {
  const d = ui.cleanDraft({
    identity: { name: 'Sam', about: 'Dev ![p](https://exfil.invalid/p.png?d=x) here' },
    focus: '[click me](https://phish.invalid/login) and https://phish.invalid/2 or www.phish.invalid now',
    skills: [{ name: 'RAG', level: 3, evidence: '![e](https://exfil.invalid/e.png)notes-app' }],
    stack: ['[TS](https://x.invalid)'],
    projects: [{ name: 'Pub', line: 'see https://x.invalid', link: 'https://example.com/x' }],
  })
  assert.equal(d.identity.about, 'Dev p here')
  assert.equal(d.focus, 'click me and or now')
  assert.equal(d.skills[0].evidence, 'enotes-app')
  assert.deepEqual(d.stack, ['TS'])
  assert.equal(d.projects[0].line, 'see')
  assert.equal(d.projects[0].link, 'https://example.com/x')
  const { body } = ui.draftToProfile(d)
  assert.ok(!/https?:|\]\(/.test(body.replace('https://example.com/x', '')), body)
})

test('profile draft → profile: own facts only (no memberships), a valid block-style log, body sections', async () => {
  const d = ui.cleanDraft({
    identity: { name: 'Sam', pronouns: 'they/them', about: 'Builds small tools.' }, role: 'Engineer', focus: 'Agents',
    skills: [{ name: 'RAG', level: 4, evidence: 'notes-app' }], stack: ['TypeScript'], projects: [{ name: 'Notes app', line: 'a tiny app', status: 'active', link: '' }],
    ask_me_about: ['RAG'], work_style: { timezone: 'Europe/Berlin', hours: 'mornings', communication: 'async' }, log: { preset: '', kinds: ['done', 'blocked', 'win'], fields: ['did', 'minutes', 'energy'] }, ui: {},
  })
  const cfg = ui.draftLogConfig(d.log, 'mon')
  assert.equal(core.validateConfig(cfg).errors.length, 0)
  assert.equal(cfg.preset, 'custom')
  assert.equal(cfg.week_starts, 'mon')
  assert.deepEqual(cfg.fields.map((f: any) => f.key), ['did', 'minutes', 'energy'])
  assert.deepEqual(ui.sensitiveFields(cfg), ['Energy'], 'energy is flagged before saving (P5)')
  assert.equal(ui.draftLogConfig({ preset: 'dev', kinds: [], fields: [] }).preset, 'dev')
  const { patch, body } = ui.draftToProfile(d, { learning: ['Rust'], log: cfg, tz: 'Africa/Cairo' })
  assert.deepEqual(Object.keys(patch).sort(), ['ask_me_about', 'focus', 'learning', 'log', 'name', 'pronouns', 'role', 'skills', 'status', 'timezone'])
  assert.equal(patch.timezone, 'Europe/Berlin')
  assert.ok(!('projects' in patch) && !('members' in patch), 'no project list in a profile (Y3)')
  assert.match(body, /## Skills\n\n- RAG · 4\/5 · notes-app/)
  assert.match(body, /## My projects\n\n- Notes app · a tiny app · active/)
  // the onboarding write: one file, block-style log the scripts' parser can read, then rosterOf reads it back
  const { src, puts } = await memSource({})
  await P.saveProfilePatch(src, { login: 'sam-dev', name: 'Sam' }, patch, { body })
  assert.equal(puts.length, 1)
  const text = await src.read('people/sam-dev.md')
  assert.match(text, /\nlog:\n {2}preset: custom\n/)
  assert.match(text, /\n {2}fields:\n {4}- key: did\n/)
  const [person] = core.rosterOf([{ path: 'people/sam-dev.md', ...(await app('lib/md')).parse('people/sam-dev.md', text) }])
  assert.equal(person.login, 'sam-dev')
  assert.equal(person.pronouns, 'they/them')
  assert.equal(person.timezone, 'Europe/Berlin')
  assert.deepEqual(person.log.fields.map((f: any) => f.key), ['did', 'minutes', 'energy'])
  // the raw intake becomes a file only when ticked; its shape:
  const f = ui.intakeFile('sam-dev', '# Who I am\r\nSam\r\n', '2026-10-15')
  assert.equal(ui.intakePath('sam-dev'), 'people/sam-dev/intake.md')
  assert.ok(f.startsWith('---\ntitle: "sam-dev · intake"\ntype: intake\nperson: sam-dev\nupdated: 2026-10-15\n---\n\n```text\n# Who I am\nSam\n```\n'), 'kept as written, inside a code fence')
  // a fence inside the intake can't close ours; HTML/links in it stay text
  const g = ui.intakeFile('sam-dev', 'a\n```js\nx\n```\n<form><img src=https://exfil.invalid/x>', '2026-10-15')
  assert.match(g, /\n````text\na\n```js\nx\n```\n<form><img src=https:\/\/exfil\.invalid\/x>\n````\n$/)
  // keys/tokens and emails are named by line before anything is kept
  assert.equal(ui.intakeProblem('# Me\nfine text <b>ok</b>'), null)
  assert.deepEqual(ui.intakeProblem('# Me\nmail me: sam@example.com'), { line: 2, why: 'looks like an email address' })
  assert.deepEqual(ui.intakeProblem('a\r\nb\r\ntoken ghp_' + 'A'.repeat(36)), { line: 3, why: 'looks like a key or token' })
  // my profile back as a draft (Update my profile)
  const back = ui.draftFromProfile(person, { focus: 'Agents' })
  assert.equal(back.identity.name, 'Sam')
  assert.equal(back.focus, 'Agents')
  assert.deepEqual(back.ask_me_about, ['RAG'])
})

test('profile-draft client: local route, GitHub mode (token in a header, never the URL), manual fallback', async () => {
  // one module graph, so `instanceof GitHubSource` sees the same class
  const [{ requestProfileDraft, UI_TWEAK_URL }, { GitHubSource, LocalSource }] = await loadTsx(['components/people/profile-draft.ts', 'lib/source.ts'])
  const calls: { url: string; init: any }[] = []
  const ok = (body: unknown, status = 200) => async (url: string, init: any) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }
  const r1 = await requestProfileDraft(new LocalSource(), '# Who I am', ['demo', 'Demo app'], { fetch: ok({ draft: { identity: { name: '<i>Sam</i>' }, skills: 'x' }, dropped: ['projects[0] (already in HQ: ask its owner to join)'] }) })
  assert.equal(r1.ok, true)
  assert.equal(r1.draft.identity.name, 'Sam')
  assert.deepEqual(r1.draft.skills, [])
  assert.equal(calls[0].url, '/__hq/ui-tweak')
  assert.deepEqual(JSON.parse(calls[0].init.body), { action: 'profile-draft', intake: '# Who I am', known_projects: ['demo', 'Demo app'] })
  const gh = new GitHubSource({ owner: 'o', repo: 'r', branch: 'main', token: 'tok_secret_123' })
  const r2 = await requestProfileDraft(gh, 'x', [], { fetch: ok({ error: 'Gemini is not set up here', code: 'no-key' }, 503) })
  assert.equal(r2.ok, false)
  assert.equal(r2.manual, true)
  assert.equal(calls[1].url, UI_TWEAK_URL)
  assert.ok(!calls[1].url.includes('tok_secret'), 'no token in the URL')
  assert.equal(calls[1].init.headers['x-github-token'], 'tok_secret_123')
  const r3 = await requestProfileDraft(gh, 'x', [], { fetch: ok({ error: 'The AI draft did not fit the profile shape. Try again.' }, 502) })
  assert.equal(r3.manual, false)
  assert.match(r3.error, /did not fit/)
  const r4 = await requestProfileDraft(gh, 'x', [], { fetch: async () => { throw new Error('offline') } })
  assert.deepEqual([r4.ok, r4.status, r4.manual], [false, 0, false])
})

test('Together: team tiles only, pairs alphabetical and drawn without NaN; no per-person totals (P13)', { skip }, async () => {
  assert.deepEqual(ui.togetherTiles({ asks_sent: 3, asks_answered: 3, median_reply_h: 5.54, blockers_raised: 1, blockers_resolved: 1, median_unblock_h: null }), [
    { value: '3 of 3', label: 'Asks answered' }, { value: '5.5 h', label: 'Median first reply' }, { value: '1 of 1', label: 'Blockers resolved' },
  ])
  assert.deepEqual(ui.togetherTiles({ asks_sent: 2, asks_answered: 2, median_reply_h: null, blockers_raised: 0, blockers_resolved: 0, median_unblock_h: null }), [{ value: '2 of 2', label: 'Asks answered' }], 'an unknown median is no tile')
  const [{ togetherOf, teamCards }] = await loadTsx(['pages/People.tsx'])
  const t = togetherOf(model, NOW)
  assert.equal(t.people, 2)
  assert.deepEqual(t.columns, ['alice', 'bob', 'claude'])
  for (const p of t.pairs) assert.ok(p.a.toLowerCase() <= p.b.toLowerCase(), 'alphabetical pair')
  const lay = ui.pairLayout(t.pairs)
  for (const n of lay.nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y))
  for (const e of lay.edges) assert.ok(e.width >= 2 && e.width <= 7)
  assert.match(ui.pairsSummary(t.pairs), /^alice and bob: /)
  const three = ui.pairLayout([{ a: 'b', b: 'c', replies: 1, todos_ab: 0, todos_ba: 0, unblocks: 0, projects: [] }, { a: 'a', b: 'c', replies: 9, todos_ab: 9, todos_ba: 0, unblocks: 0, projects: [] }])
  assert.deepEqual(three.nodes.map((n: any) => n.login), ['a', 'b', 'c'])
  assert.equal(three.edges[1].width, 7)
  // cards: me first, carol is a ghost, no counts other than a person's own open blockers
  const cards = teamCards(model, alice, NOW)
  assert.deepEqual(cards.map((c: any) => [c.login, !!c.me, !!c.ghost]), [['alice', true, false], ['bob', false, false], ['carol', false, true]])
  const keys = new Set(cards.flatMap((c: any) => Object.keys(c)))
  for (const k of keys) assert.ok(!/count|total|minutes|checkins|todos|replies|posts|score/i.test(k), 'no per-person totals on cards: ' + k)
  // bob: CI (help to-do done), emulator (🔓 row), token (help to-do done by alice) are closed; the signing key is open
  assert.equal(cards.find((c: any) => c.login === 'bob').blockers, 1)
})

test('D2 · the sample team is dev-only: imported behind import.meta.env.DEV, never by the model or the AI', () => {
  const src = (rel: string) => fs.readFileSync(path.join(APP, 'src', rel), 'utf8')
  const users: string[] = []
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
  for (const f of walk(path.join(APP, 'src')).filter((x) => /\.(tsx?|mjs)$/.test(x))) if (/sample-team/.test(fs.readFileSync(f, 'utf8')) && !f.endsWith('sample-team.ts')) users.push(path.relative(APP, f).split(path.sep).join('/'))
  assert.deepEqual(users, ['src/pages/People.tsx'], 'only the People page loads the sample')
  const people = src('pages/People.tsx')
  const at = people.indexOf("import('../dev/sample-team')")
  assert.ok(at > 0, 'dynamic import, not a static one')
  assert.ok(!/^import .*sample-team/m.test(people), 'no static import')
  assert.ok(people.slice(0, at).lastIndexOf('import.meta.env.DEV') > people.slice(0, at).lastIndexOf('const togglePreview'), 'behind the DEV check')
  for (const f of ['lib/hq.ts', 'lib/people.ts', 'lib/people-core.ts']) assert.ok(!/sample/i.test(src(f).replace(/sample(s|d)?\b(?! team)/gi, '')), f)
})

test('person widgets: move up/down among the shown ones', () => {
  const order = ['checkins', 'foryou', 'time', 'energy', 'projects', 'log']
  assert.deepEqual(ui.moveWidget(order, [], 'time', -1), ['checkins', 'time', 'foryou', 'energy', 'projects', 'log'])
  assert.deepEqual(ui.moveWidget(order, ['energy'], 'time', 1), ['checkins', 'foryou', 'projects', 'energy', 'time', 'log'])
  assert.deepEqual(ui.moveWidget(order, [], 'checkins', -1), order)
})

test('freshness word: today · N days ago, amber only after nudge_days (never red)', () => {
  assert.deepEqual(ui.freshWord('2026-10-18T04:00:00Z', 'Africa/Cairo', NOW, 3), { text: 'checked in today', amber: false })
  assert.deepEqual(ui.freshWord('2026-10-16T04:00:00Z', 'Africa/Cairo', NOW, 3), { text: 'last check-in 2 days ago', amber: false })
  assert.deepEqual(ui.freshWord('2026-10-10T04:00:00Z', 'Africa/Cairo', NOW, 3), { text: 'last check-in 8 days ago', amber: true })
  assert.equal(ui.freshWord('2026-10-10T04:00:00Z', 'Africa/Cairo', NOW, 0)!.amber, false)
  assert.equal(ui.freshWord(null, 'Africa/Cairo', NOW, 3), null)
})

test('SSR smoke: every People surface renders on the fixture without throwing (own, other, ghost, Claude, not found)', { skip }, async () => {
  const { createElement: h } = await import('react')
  const { renderToString } = await import('react-dom/server')
  const [ctx, People, Person, LS, OB, TC, TE, FY, JG] = await loadTsx([
    'lib/hq-context.tsx', 'pages/People.tsx', 'pages/Person.tsx', 'components/people/LogSettings.tsx', 'components/people/Onboarding.tsx',
    'components/people/TeamCard.tsx', 'components/people/TeamEditor.tsx', 'components/people/ForYouList.tsx', 'components/people/JoinGuide.tsx',
  ])
  const { src } = await memSource(Object.fromEntries(F!.FILES.map((f: any) => [f.path, f.text])))
  const wrap = (me: any, node: any) => {
    const value = { source: src, model, me, reload: async () => {}, refresh: async () => {}, busy: false, loadedAt: 1, bell: null }
    return renderToString(h(ctx.HQContext.Provider, { value }, node)).replace(/<!-- -->/g, '')
  }
  const route = (path: string, extra: any = {}) => ({ page: 'People', nav: 'people', path, ...extra })
  const team = wrap(alice, h(People.default, { route: route('/people') }))
  assert.match(team, /2 people so far/)
  assert.match(team, /Waiting on whom/)
  assert.match(team, /Preview layout/, 'the dev-only switch shows in dev (Vite SSR runs as dev; the build has none, D2)')
  assert.ok(!/is-sample/.test(team), 'no sample cards until the switch is on')
  const tog = wrap(alice, h(People.default, { route: route('/people/_team', { tab: 'together' }) }))
  assert.match(tog, /Who&#x27;s on what|Who's on what/)
  assert.match(tog, /class="pairs"/)
  const own = wrap(alice, h(Person.default, { route: route('/people/alice', { page: 'Person', person: 'alice' }) }))
  assert.equal((own.match(/>Check in</g) || []).length, 1, 'D1: one Check in button on my own page')
  assert.match(own, /team can see/)
  assert.match(own, /data-w="foryou"/)
  const other = wrap(alice, h(Person.default, { route: route('/people/bob', { page: 'Person', person: 'bob' }) }))
  assert.equal((other.match(/>Check in</g) || []).length, 0, 'no Check in on someone else')
  assert.ok(!/data-w="foryou"/.test(other) && !/data-w="energy"/.test(other), 'no For you / Energy on someone else')
  assert.ok(!/Fix this row/.test(other), 'no row editing on someone else')
  assert.match(other, /class="pp-status"/)
  const ghost = wrap(alice, h(Person.default, { route: route('/people/carol', { page: 'Person', person: 'carol' }) }))
  assert.match(ghost, /no profile yet/)
  const claude = wrap(alice, h(Person.default, { route: route('/people/claude', { page: 'Person', person: 'claude' }) }))
  assert.match(claude, /Work for people/)
  assert.match(claude, /Wrote the demo README/)
  assert.match(wrap(alice, h(Person.default, { route: route('/people/zed', { page: 'Person', person: 'zed' }) })), /No one called/)
  const carolOwn = wrap(carol, h(Person.default, { route: route('/people/carol', { page: 'Person', person: 'carol' }) }))
  assert.match(carolOwn, /Set up my profile/, 'my own page without a profile = the wizard')
  assert.match(wrap(carol, h(People.default, { route: route('/people') })), /Copy prompt/)
  const ls = wrap(alice, h(LS.LogSettings, {}))
  assert.match(ls, /My logging/)
  assert.match(ls, /Energy<\/b>.*looks personal/s, 'P5 warning for the energy field')
  const ob = wrap(carol, h(OB.Onboarding, {}))
  assert.match(ob, /hq-intake-carol\.md/)
  assert.match(ob, /visible to the team/)
  const demo = model!.projects.find((d: any) => d.path === 'projects/demo/project.md')
  assert.match(wrap(alice, h(TC.default, { project: demo })), /Edit team/)
  const asCarol = wrap(carol, h(TC.default, { project: demo }))
  assert.match(asCarol, /Ask to join/)
  assert.match(asCarol, /Android build · I can help/)
  const asBob = wrap(bob, h(TC.default, { project: demo }))
  assert.match(asBob, /aria-label="Options: Team"/, 'a member gets the ⋯ menu (Leave this project)')
  assert.ok(!/Edit team|Ask to join/.test(asBob))
  assert.match(wrap(alice, h(TE.default, { project: demo })), /Team · Demo app/)
  assert.equal(wrap(bob, h(TE.default, { project: demo })), '', 'M4-3: the editor is not rendered for a non-owner')
  assert.match(wrap(alice, h(FY.default, { limit: 2 })), /role="list"|Nothing waiting on you/)
  assert.match(renderToString(h(JG.JoinGuide)), /Make a classic token/)
})

test('M3-13 · the weekly time chart sums equal timeByProject(); series never share a colour slot', { skip }, async () => {
  const [{ timeSpec, totalMinutes }] = await loadTsx(['components/people/TimeByProject.tsx'])
  const ctx = P.personCtx(model, 'alice', NOW, { viewer: 'alice' })
  const spec = timeSpec(ctx.time, model)
  assert.equal(spec.type, 'bar')
  assert.equal(spec.stacked, true)
  assert.equal(spec.labels.length, 8)
  const want = new Map<string, number>()
  for (const w of ctx.time) for (const [k, v] of Object.entries(w.byProject)) want.set(k, (want.get(k) || 0) + (v as number))
  const titles: Record<string, string> = { demo: 'Demo app', solo: 'Solo research' }
  for (const [k, v] of want) {
    const s = spec.series.find((x: any) => x.name === titles[k])
    assert.ok(s, k)
    assert.ok(Math.abs(s.data.reduce((a: number, b: number) => a + b, 0) * 60 - v) <= 6 * spec.labels.length, `${k}: ${v} min`)
  }
  assert.equal(new Set(spec.series.map((x: any) => x.color)).size, spec.series.length, 'distinct colour slots')
  assert.equal(totalMinutes(ctx.time), [...want.values()].reduce((a, b) => a + b, 0))
})
