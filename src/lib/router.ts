import { useEffect, useState } from 'react'

/** Hash routing (#/board, #/docs/path.md) so GitHub Pages needs no server rewrites. */
export function useRoute() {
  const [hash, setHash] = useState(location.hash || '#/')
  useEffect(() => {
    const f = () => setHash(location.hash || '#/')
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  return decodeURIComponent(hash.slice(1)) || '/'
}

export const go = (route: string) => {
  location.hash = route
}
