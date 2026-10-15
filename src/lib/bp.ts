// One breakpoint set for the whole app (same numbers as styles/tokens.css): phone ≤760 px, narrow ≤1100 px.
import { useSyncExternalStore } from 'react'

export const PHONE = 760
export const NARROW = 1100

const query = (q: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null)

/** Live media-query match (false on the server / in tests). */
export function useMedia(q: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = query(q)
      m?.addEventListener('change', cb)
      return () => m?.removeEventListener('change', cb)
    },
    () => !!query(q)?.matches,
    () => false,
  )
}

export const useIsPhone = () => useMedia(`(max-width: ${PHONE}px)`)
export const useIsNarrow = () => useMedia(`(max-width: ${NARROW}px)`)

/** Reduced motion: the `motion` pref wins ('reduced' / 'full' on <html data-motion>), else the OS setting. */
export function reducedMotion() {
  if (typeof document === 'undefined') return true
  const m = document.documentElement.getAttribute('data-motion')
  if (m === 'reduced') return true
  if (m === 'full') return false
  return !!query('(prefers-reduced-motion: reduce)')?.matches
}
