// Small helpers shared across the app.

export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key)
      return v ? (JSON.parse(v) as T) : fallback
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown) {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode */ }
  },
  del(key: string) {
    try { localStorage.removeItem(key) } catch { /* private mode */ }
  },
}

export const slug = (s: string) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x'

const pad = (n: number) => String(n).padStart(2, '0')

/** Sortable, collision-safe id: 20261014-153012-login-x7k */
export function makeId(login: string) {
  const d = new Date()
  const date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
  const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  return `${date}-${time}-${slug(login)}-${Math.random().toString(36).slice(2, 5)}`
}

export const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z')

export function ago(iso?: unknown) {
  const t = Date.parse(String(iso || ''))
  if (!t) return ''
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(t).toLocaleDateString()
}

export const firstName = (name: string) => String(name || '').split(/[\s(]/)[0] || 'there'

export const same = (a?: unknown, b?: unknown) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()
