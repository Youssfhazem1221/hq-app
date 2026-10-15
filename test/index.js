// Folder runner: makes `npm test` (node --test test/) work. Node 24 treats a folder argument as a module, not a
// folder to search, so it loads this file, which imports every *.test.ts here. New test files are picked up
// automatically.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
for (const name of fs.readdirSync(here).filter((n) => n.endsWith('.test.ts')).sort()) {
  await import(pathToFileURL(path.join(here, name)).href)
}
