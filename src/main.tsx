import { createRoot } from 'react-dom/client'
import App from './App'
import { reloadFresh } from './lib/net'
import './styles/index.css'
import './styles/visuals.css'
import './styles/work.css'
import './styles/read.css'
import './styles/people.css'
import './styles/look.css'

// A deploy renamed a file this tab still asks for: reload once with a fresh index.html (lib/net.ts). The error still
// reaches its page, which says so in case the reload is held back.
addEventListener('vite:preloadError', () => void reloadFresh())

// Errors an ErrorBoundary already handled (a broken chart → its code block) are not console errors: one quiet line in dev.
createRoot(document.getElementById('root')!, {
  onCaughtError: (error) => {
    if (import.meta.env.DEV) console.warn('[hq] handled by a boundary:', (error as Error)?.message || error)
  },
}).render(<App />)
