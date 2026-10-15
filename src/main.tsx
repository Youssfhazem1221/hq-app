import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/index.css'
import './styles/visuals.css'
import './styles/work.css'
import './styles/read.css'
import './styles/people.css'
import './styles/look.css'

// Errors an ErrorBoundary already handled (a broken chart → its code block) are not console errors: one quiet line in dev.
createRoot(document.getElementById('root')!, {
  onCaughtError: (error) => {
    if (import.meta.env.DEV) console.warn('[hq] handled by a boundary:', (error as Error)?.message || error)
  },
}).render(<App />)
