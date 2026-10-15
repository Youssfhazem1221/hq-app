// DEV ONLY · the "Preview layout" sample team (module D, spec §6.4 / E8). Loaded with `import()` behind
// `import.meta.env.DEV`, so production builds never contain it. Made-up people shown under a permanent "Sample layout"
// watermark in dashed cards. It never enters model.roster, knownLogins, For you, pickers or the AI: it is display data
// for the People page only.
import type { SampleTeam } from '../components/people/people-ui-core'

export const SAMPLE_TEAM: SampleTeam = {
  cards: [
    {
      login: 'alice', slug: 'alice', name: 'alice', sub: ['she/her', 'research lead'], sample: true,
      fresh: { text: 'checked in today', amber: false },
      on: [{ slug: 'demo', title: 'demo', role: 'owner', color: 5 }, { slug: 'solo', title: 'solo', role: 'owner', color: 6 }],
      blockers: 0, waitsOn: [], askMeAbout: ['RAG', 'UI reviews'],
    },
    {
      login: 'bob', slug: 'bob', name: 'bob', sub: ['he/him', 'mobile dev'], sample: true,
      fresh: { text: 'last check-in 4 days ago', amber: true },
      on: [{ slug: 'demo', title: 'demo', role: 'member', part: 'mobile app', color: 5 }],
      blockers: 1, waitsOn: ['alice'], askMeAbout: ['Android'],
    },
  ],
  waits: [
    { who: 'bob', on: 'alice', what: "Help: token won't load", since: '1 day' },
    { who: 'bob', on: 'alice', what: 'Join demo as mobile app', since: '2 h' },
  ],
  together: {
    people: 2,
    tiles: [
      { value: '3 of 3', label: 'Asks answered' },
      { value: '5.5 h', label: 'Median first reply' },
      { value: '1 of 1 · 18 h', label: 'Blockers resolved' },
    ],
    columns: ['alice', 'bob', 'claude'],
    projects: ['demo', 'solo'],
    cells: {
      demo: { alice: { role: 'owner', part: 'lead', dots: 3 }, bob: { role: 'member', part: 'mobile', dots: 1 }, claude: { dots: 2 } },
      solo: { alice: { role: 'owner', dots: 1 }, bob: { dots: 0 }, claude: { dots: 0 } },
    },
    pairs: [{ a: 'alice', b: 'bob', replies: 4, todos_ab: 1, todos_ba: 2, unblocks: 1, projects: ['demo'] }],
    ideas: ['bob is learning RAG → alice lists "ask me about: RAG"', 'demo wants help: "Android build"'],
  },
}
