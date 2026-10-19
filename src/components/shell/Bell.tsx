// The bell (board notifications): unread count on the top bar, the list in a popover, and system pop-ups while HQ
// sits in a background tab. Its own lazy chunk (the top bar holds a 30 px place for it); the rules live in
// notify-core.ts. Read state = per login, on this device (hq.notify.<login>), in step across tabs.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useHQMaybe } from '../../lib/hq-context'
import { displayName, projectSlug } from '../../lib/hq'
import { Icon } from '../../lib/icons'
import type { IconName } from '../../lib/contracts'
import { ago, nowIso, store } from '../../lib/util'
import {
  POPUP_TITLE, cleanRead, freshNotes, isUnread, markAllRead, markRead, noteHref, noteWords, notesFor, unreadCount,
  type Note, type NoteKind, type ReadState,
} from '../../lib/notify-core'
import { Popover } from './Popover'
import { toast } from '../toast'
import '../../styles/bell.css'

const ICON: Record<NoteKind, IconName> = { post: 'board', reply: 'thought', closed: 'done', 'replied-closed': 'done' }
const POPUPS_KEY = 'hq.notify.popups'
const readKey = (login: string) => 'hq.notify.' + login.toLowerCase()
/** With pop-ups on, a background tab looks for news this often (the doorbell is the fast path). */
const HIDDEN_CHECK_MS = 120_000
/** More new items at once than this → one summary pop-up. */
const POPUP_MAX = 3
/** Rows before "Show more". */
const ROWS = 8

type Perm = 'unsupported' | NotificationPermission
const perm = (): Perm => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)

/** This login's read state. The first run on a device is saved right away, so its "last day" start stays put. */
function loadRead(login: string): ReadState {
  const raw = store.get<unknown>(readKey(login), null)
  const s = cleanRead(raw, nowIso())
  if (JSON.stringify(raw) !== JSON.stringify(s)) store.set(readKey(login), s)
  return s
}

/** One system pop-up. false = this browser has none for a tab (Android Chrome wants a service worker). */
function show(title: string, body: string, tag: string, onClick: () => void): boolean {
  try {
    const n = new Notification(title, { body, tag })
    n.onclick = () => {
      focus()
      onClick()
      n.close()
    }
    return true
  } catch {
    return false
  }
}

export default function Bell() {
  const hq = useHQMaybe()
  const model = hq?.model || null
  const login = hq?.me.login || ''
  const refresh = hq?.refresh
  const [read, setRead] = useState<ReadState | null>(null)
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState(ROWS)
  const [ring, setRing] = useState(0)
  const [permission, setPermission] = useState<Perm>(perm)
  const [wantPopups, setWantPopups] = useState(() => store.get<boolean>(POPUPS_KEY, false) === true)
  const popups = wantPopups && permission === 'granted'
  const btn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!login) return setRead(null)
    setRead(loadRead(login))
    const f = (e: StorageEvent) => {
      if (e.key === readKey(login)) setRead(loadRead(login))
    }
    addEventListener('storage', f)
    return () => removeEventListener('storage', f)
  }, [login])
  const readRef = useRef(read)
  readRef.current = read
  const save = useCallback(
    (next: ReadState) => {
      store.set(readKey(login), next)
      setRead(next)
    },
    [login],
  )
  const markOne = useCallback((n: Note) => readRef.current && save(markRead(readRef.current, n)), [save])

  const notes = useMemo(() => (model && login ? notesFor(model, login, nowIso()) : []), [model, login])
  const nameOf = useCallback((l: string) => (model ? displayName(model, l) : l), [model])
  const projects = useMemo(() => new Map((model?.projects || []).map((p) => [projectSlug(p), String(p.data.title || projectSlug(p))])), [model])
  const count = read ? unreadCount(notes, read) : 0

  // Items that just arrived: the bell swings once; in a background tab with pop-ups on, the system says it too.
  const last = useRef<{ login: string; keys: Set<string> } | null>(null)
  const popRef = useRef(popups)
  popRef.current = popups
  useEffect(() => {
    if (!login) return
    const before = last.current?.login === login ? last.current.keys : null
    last.current = { login, keys: new Set(notes.map((n) => n.hashes[0])) }
    const r = readRef.current
    const fresh = r ? freshNotes(before, notes).filter((n) => isUnread(n, r)) : []
    if (!fresh.length) return
    setRing((k) => k + 1)
    if (!popRef.current || document.visibilityState !== 'hidden') return
    if (fresh.length > POPUP_MAX) {
      show(`HQ · ${fresh.length} new on the board`, fresh.slice(0, POPUP_MAX).map((n) => noteWords(n, nameOf).line).join('\n'), 'hq-board', () => (location.hash = '/board'))
      return
    }
    for (const n of fresh) {
      const body = noteWords(n, nameOf).line + (n.snippet ? `\n“${n.snippet}”` : '')
      show(`HQ · ${POPUP_TITLE[n.kind]}`, body, 'hq-' + n.hashes[0], () => {
        markOne(n)
        location.hash = noteHref(n).slice(1)
      })
    }
  }, [notes, login])

  // A background tab with pop-ups on still looks now and then (the 60 s check only runs while the tab is in view).
  useEffect(() => {
    if (!popups || !refresh) return
    const t = setInterval(() => document.visibilityState === 'hidden' && void refresh(), HIDDEN_CHECK_MS)
    return () => clearInterval(t)
  }, [popups, refresh])

  const togglePopups = async (on: boolean) => {
    if (!on) {
      store.set(POPUPS_KEY, false)
      setWantPopups(false)
      return
    }
    let p = perm()
    if (p === 'default') {
      try {
        p = await Notification.requestPermission()
      } catch {
        p = perm()
      }
    }
    setPermission(p)
    if (p !== 'granted') return toast(p === 'denied' ? 'Pop-ups are blocked for this site in your browser settings' : 'Pop-ups stay off', 'info')
    if (!show('HQ pop-ups are on', 'New posts, replies and closes show up like this while HQ is in another tab.', 'hq-popups-on', () => {})) {
      setPermission('unsupported')
      return toast('This browser has no pop-ups for a tab. The bell still collects everything.', 'info')
    }
    store.set(POPUPS_KEY, true)
    setWantPopups(true)
  }

  // Before the workspace is open: hold the place (no shift when the bell arrives).
  if (!hq || !read) return <span className="icon-btn" aria-hidden="true" />

  const label = count ? `Notifications, ${count} unread` : 'Notifications'
  return (
    <>
      <button
        ref={btn}
        className="icon-btn nb"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        data-tipt={count ? `${count} unread` : 'Notifications'}
        onClick={() => {
          setPermission(perm())
          setRows(ROWS)
          setOpen((o) => !o)
        }}
      >
        <span key={ring} className={'nb-i' + (ring ? ' ring' : '')}>
          <Icon name="bell" />
        </span>
        {count > 0 && (
          <span className="nb-n" aria-hidden="true">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
      <Popover anchor={btn.current} open={open} onClose={() => setOpen(false)} width={380} role="dialog" label="Notifications" className="nb-pop">
        <div className="nb-h">
          <h2>Notifications</h2>
          <button className="btn ghost sm" type="button" disabled={!count} onClick={() => save(markAllRead(read, notes, nowIso()))}>
            Mark all read
          </button>
        </div>
        {notes.length ? (
          <ul className="nb-list">
            {notes.slice(0, rows).map((n) => (
              <Row
                key={n.id}
                n={n}
                unread={isUnread(n, read)}
                nameOf={nameOf}
                project={n.project ? projects.get(n.project) || n.project : ''}
                onOpen={() => {
                  markOne(n)
                  setOpen(false)
                }}
              />
            ))}
            {notes.length > rows && (
              <li>
                <button className="btn ghost sm nb-more" type="button" onClick={() => setRows((r) => r + 12)}>
                  Show {Math.min(12, notes.length - rows)} more
                </button>
              </li>
            )}
          </ul>
        ) : (
          <div className="empty nb-empty">
            <Icon name="bell" />
            <p>
              <b>All caught up.</b> New board posts, replies on your posts and closes land here.
            </p>
          </div>
        )}
        {permission === 'granted' || permission === 'default' ? (
          <div className="nb-f">
            <span id="nb-pl">Pop-ups while HQ is in another tab</span>
            <button className="sw" type="button" role="switch" aria-checked={popups} aria-labelledby="nb-pl" onClick={() => void togglePopups(!popups)} />
          </div>
        ) : (
          <p className="nb-f">
            {permission === 'denied'
              ? 'Pop-ups are blocked for this site. Allow notifications in the browser’s site settings to use them.'
              : 'This browser has no pop-ups for a tab. The bell still collects everything.'}
          </p>
        )}
      </Popover>
    </>
  )
}

function Row({ n, unread, nameOf, project, onOpen }: { n: Note; unread: boolean; nameOf: (l: string) => string; project: string; onOpen: () => void }) {
  const w = noteWords(n, nameOf)
  const icon: IconName = n.kind !== 'post' && n.actor.toLowerCase() === 'claude' ? 'bot' : ICON[n.kind]
  return (
    <li>
      <a className={'nb-it' + (unread ? ' un' : '')} href={noteHref(n)} onClick={onOpen}>
        <span className="nb-ic" aria-hidden="true">
          <Icon name={icon} size="s" />
        </span>
        <span className="nb-tx">
          <span className="nb-l">
            <b>{w.who}</b> {w.what}: {w.title}
          </span>
          {n.snippet && <span className="nb-s">“{n.snippet}”</span>}
          <span className="nb-m" title={n.at}>
            {ago(n.at)}
            {project && ` · ${project}`}
            {unread && <span className="sr"> · unread</span>}
          </span>
        </span>
        {unread && <i className="nb-dot" aria-hidden="true" />}
      </a>
    </li>
  )
}
