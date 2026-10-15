// Phone bottom bar (≤760 px): Home · Projects · (✦ Ask) · Tasks · More. More opens the sidebar sheet (Check in first).
import { Icon } from '../../lib/icons'
import type { Route } from '../../lib/contracts'

export function BottomBar({ route, onMore }: { route: Route; onMore: () => void }) {
  const cur = (nav: string) => (route.nav === nav ? 'page' : undefined)
  return (
    <nav className="bbar" aria-label="Main (phone)">
      <a href="#/" aria-current={cur('home')}>
        <Icon name="home" />
        Home
      </a>
      <a href="#/projects" aria-current={cur('projects')}>
        <Icon name="projects" />
        Projects
      </a>
      <a className="mid" href="#/ask" aria-current={cur('ask')}>
        <span className="fab">
          <Icon name="spark" />
        </span>
        Ask
      </a>
      <a href="#/tasks" aria-current={cur('tasks')}>
        <Icon name="tasks" />
        Tasks
      </a>
      <button type="button" onClick={onMore} aria-haspopup="dialog">
        <Icon name="dots" />
        More
      </button>
    </nav>
  )
}
