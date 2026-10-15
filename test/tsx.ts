// Load app .tsx modules in node tests (Node's type stripping can't read JSX). ONE Vite server in middleware mode per
// test process (no config file, no watcher, no HMR socket) transforms them with the app's React plugin. It stays open
// until the process ends, so a module's lazy `import()` (React.lazy pages, sheets, explainers) still resolves when a
// later test renders it; closing it early made those imports fail with "transport was disconnected" in the combined
// `npm test` run. Not a test file itself (no .test.ts).
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ViteDevServer } from 'vite'

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

let shared: Promise<ViteDevServer> | null = null

/** The process-wide test server (created on first use, closed when the process is about to exit). */
export function testServer(): Promise<ViteDevServer> {
  if (!shared) {
    shared = (async () => {
      const { createServer } = await import('vite')
      const react = (await import('@vitejs/plugin-react')).default
      const server = await createServer({
        configFile: false,
        root: APP,
        logLevel: 'error',
        appType: 'custom',
        plugins: [react()],
        server: { middlewareMode: true, hmr: false, ws: false, watch: null },
        optimizeDeps: { noDiscovery: true, include: [] },
      })
      process.once('beforeExit', () => void server.close())
      return server
    })()
  }
  return shared
}

/** Load modules by their path under src/ ('components/blocks.tsx'). Returns them in the same order. */
export async function loadTsx(rels: string[]): Promise<any[]> {
  const server = await testServer()
  const out: any[] = []
  for (const rel of rels) out.push(await server.ssrLoadModule('/src/' + rel))
  return out
}
