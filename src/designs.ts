// The design directions shown in the Design lab. Tokens live in designs.css.
export type DesignId = 'apple' | 'obsidian' | 'metro' | 'kraft' | 'riso' | 'khayamiya' | 'calm'

export type Direction = {
  id: DesignId
  name: string
  tag?: string
  world: string
  thesis: string
  palette: string[]
  fonts: string
  arabic: string
  energy: string
  density: string
  bestFor: string
  risk: string
  scene: 'light' | 'dark'
}

export const DESIGNS: Direction[] = [
  {
    id: 'apple',
    name: 'Apple',
    tag: 'You asked',
    world: 'macOS / iOS (Human Interface style)',
    thesis: 'Frosted sidebar, borderless white cards on soft grey, iOS-Settings style icon tiles, pill buttons, big bold titles.',
    palette: ['#f2f2f7', '#ffffff', '#1d1d1f', '#007aff', '#34c759', '#ff9500'],
    fonts: 'SF Pro on Apple devices · Inter elsewhere',
    arabic: '⚠️ Latin (Arabic uses the system font)',
    energy: 'Clean, premium',
    density: 'Comfortable',
    bestFor: 'Calm focus that still feels polished',
    risk: 'On Windows it can only approximate SF Pro (uses Inter).',
    scene: 'light',
  },
  {
    id: 'obsidian',
    name: 'Apple × Obsidian',
    tag: 'You asked (mix)',
    world: "Obsidian's vault + Apple's polish",
    thesis: 'Graphite vault, file-tree sidebar, the page title as an open tab, purple internal links, with Apple frosting and rounded panes.',
    palette: ['#1e1e1e', '#252525', '#161616', '#8b6cef', '#a88bfa', '#dcddde'],
    fonts: 'SF Pro on Apple devices · Inter elsewhere',
    arabic: '⚠️ Latin (Arabic uses the system font)',
    energy: 'Focused, nerdy-calm',
    density: 'Compact',
    bestFor: 'Living inside your notes and docs',
    risk: 'Purple accent is close to the AI-default look; dark is the stronger half.',
    scene: 'dark',
  },
  {
    id: 'metro',
    name: 'Metro Lines',
    tag: "Claude's pick",
    world: 'Cairo Metro wayfinding signs',
    thesis: 'Every project is a metro line and every page a station. Navy signage panel, colour-coded lines, bold wayfinding type.',
    palette: ['#0d1b2e', '#e1251b', '#f2b705', '#129a4a', '#1e63e9', '#eceff3'],
    fonts: 'Alexandria',
    arabic: '✅ Arabic + Latin',
    energy: 'Bold, colour-coded',
    density: 'Medium',
    bestFor: 'Scanning many projects fast (colour = meaning)',
    risk: 'Colours must keep one meaning everywhere, or they confuse.',
    scene: 'light',
  },
  {
    id: 'kraft',
    name: 'Kraft & Thread',
    world: "waraqa's hand-bound sketchbooks",
    thesis: 'HQ as a bound sketchbook: kraft-board cover, white stitched pages, coloured binding thread as the status system. Your own craft, scaled up.',
    palette: ['#c9a476', '#8b5e34', '#fefcf9', '#1f3f8f', '#b3261e', '#2c7a46'],
    fonts: 'Readex Pro',
    arabic: '✅ Arabic + Latin',
    energy: 'Warm, tactile',
    density: 'Comfortable',
    bestFor: 'Feeling like your own brand (matches waraqa)',
    risk: 'Brown ground can feel muddy on big screens; stitching turns kitschy if pushed.',
    scene: 'light',
  },
  {
    id: 'riso',
    name: 'Riso Studio',
    world: "Risograph zines, a design studio's pin-up wall",
    thesis: 'Two spot inks, overprint and paper grain. A wall of printed notes: loud, playful, impossible to miss.',
    palette: ['#fbfbf9', '#ff48b0', '#0078bf', '#ffe800', '#00a95c', '#1a1a1a'],
    fonts: 'Bricolage Grotesque',
    arabic: '⚠️ Latin only (Arabic uses a fallback font)',
    energy: 'Loudest',
    density: 'Medium',
    bestFor: 'Energy and fun; the strongest visual grouping',
    risk: 'Can overstimulate in long sessions, the opposite of calm focus.',
    scene: 'light',
  },
  {
    id: 'khayamiya',
    name: 'Khayamiya Night',
    world: "Appliqué from Cairo's Street of the Tentmakers",
    thesis: 'Evening HQ after the day job: deep indigo canvas, appliqué bands in saffron, crimson and turquoise, cut-cloth corners.',
    palette: ['#120f26', '#1b1736', '#f2a541', '#e63946', '#3ec6e0', '#5dd39e'],
    fonts: 'Changa (headings) + Rubik (text)',
    arabic: '✅ Arabic + Latin',
    energy: 'Rich, night-time',
    density: 'Comfortable',
    bestFor: 'Night use; the strongest Cairo identity',
    risk: 'Pattern + colour can get busy; light mode is the weaker half.',
    scene: 'dark',
  },
  {
    id: 'calm',
    name: 'Calm Pro',
    tag: 'Category standard',
    world: 'Linear / Notion-style product apps, played straight',
    thesis: 'Neutral greys, one blue accent, thin borders. Familiar and quiet; it gets out of the way.',
    palette: ['#f7f7f8', '#18181b', '#e4e4e7', '#2563eb', '#15803d', '#a15c07'],
    fonts: 'Geist',
    arabic: '⚠️ Latin only (Arabic uses a fallback font)',
    energy: 'Quiet',
    density: 'Compact',
    bestFor: 'Zero learning curve',
    risk: 'Looks like every other tool; little personality.',
    scene: 'light',
  },
]

export const DEFAULT_DESIGN: DesignId = 'metro'
export const isDesign = (v: unknown): v is DesignId => DESIGNS.some((d) => d.id === v)
