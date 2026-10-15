// "How to join HQ" (module D): the visual 4-step guide for a new teammate. Accept the GitHub invite → make a classic
// token with repo scope → sign in to HQ with it → run "Set up my profile". Shown on People (button + sheet) and, through
// <JoinGuideButton/>, wherever another module wants it (Settings). Plain steps, icons, few words.
import { useState } from 'react'
import { Icon } from '../../lib/icons'
import type { IconName } from '../../lib/contracts'
import { Sheet } from './Sheet'

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=HQ'

const STEPS: { icon: IconName; title: string; text: string; link?: { href: string; label: string } }[] = [
  { icon: 'bell', title: 'Accept the invite', text: 'Open the GitHub email or github.com/notifications and accept the invite to the HQ repo.' },
  {
    icon: 'lock',
    title: 'Make a classic token',
    text: 'GitHub → Settings → Developer settings → Tokens (classic) → Generate. Tick "repo". Copy it once; GitHub never shows it again.',
    link: { href: TOKEN_URL, label: 'Open the token page' },
  },
  { icon: 'plug', title: 'Sign in to HQ', text: 'In HQ open Settings → Connection, paste the token and connect. It stays in this browser only.' },
  { icon: 'user', title: 'Set up your profile', text: 'People → Set up my profile. Your Claude writes an intake, Gemini drafts the profile, you check it and save.' },
]

export function JoinGuide() {
  return (
    <ol className="jg" aria-label="How to join HQ">
      {STEPS.map((s, i) => (
        <li key={s.title} className="jg-s">
          <span className="jg-n" aria-hidden="true">
            <Icon name={s.icon} />
          </span>
          <div>
            <b>
              <span className="sr">Step {i + 1}: </span>
              {s.title}
            </b>
            <p>{s.text}</p>
            {s.link && (
              <a className="btn ghost sm" href={s.link.href} target="_blank" rel="noopener noreferrer">
                {s.link.label}
                <Icon name="ext" size="s" />
              </a>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

/** A button that opens the guide in a sheet. */
export function JoinGuideButton({ className = 'btn ghost sm', label = 'How to join HQ' }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className={className} type="button" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="info" size="s" />
        {label}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} labelledBy="jg-title">
        <div className="pp-h">
          <Icon name="users" />
          <h2 id="jg-title">How to join HQ</h2>
        </div>
        <div className="pp-body">
          <JoinGuide />
          <p className="hint">Everything in HQ is visible to the team and to HQ's AI. A token is like a password: never post it.</p>
        </div>
        <div className="pp-foot">
          <span style={{ flex: 1 }} />
          <button className="btn primary" type="button" onClick={() => setOpen(false)}>
            Got it
          </button>
        </div>
      </Sheet>
    </>
  )
}
export default JoinGuideButton
