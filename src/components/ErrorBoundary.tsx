import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Icon } from '../lib/icons'

type Fallback = ReactNode | ((error: Error, reset: () => void) => ReactNode)
type Props = {
  /** What renders instead of the children after they throw (e.g. the raw code block for a chart). */
  fallback: Fallback
  children?: ReactNode
  /** Change it (e.g. the route) to give the children another try. */
  resetKey?: unknown
}
type State = { error: Error | null }

/** Error boundary: wraps every Chart/Explainer (fallback = the code block) and each page (fallback = PageSnag). */
export class Boundary extends Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State {
    return { error }
  }
  // Logged once by main.tsx onCaughtError (a dev warning, never a console error).
  componentDidCatch(_error: Error, _info: ErrorInfo) {}
  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }
  reset = () => this.setState({ error: null })
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const f = this.props.fallback
    return typeof f === 'function' ? f(error, this.reset) : f
  }
}
export default Boundary

/** Page-level fallback: one sentence, one button. */
export function PageSnag({ reset }: { reset?: () => void }) {
  return (
    <div className="empty snag" role="alert">
      <Icon name="alert" />
      <p>This page hit a snag.</p>
      <button className="btn" type="button" onClick={() => (reset ? reset() : location.reload())}>
        <Icon name="refresh" size="s" />
        Reload
      </button>
    </div>
  )
}
