// HQ write policy: which files Ask AI may read, and which changes a person may apply through it ("give the AI the
// ability to read and write everything", 2026-10-20). ONE file for every place that checks: the AI's tools in
// answer.mjs (edge `ask`, local /__hq/ask, the Actions worker), the local dev server (/__hq/read, /__hq/write, also
// for the app's own project/people writes) and the app before Apply.
// The AI never writes by itself: it proposes, the person sees a preview and clicks Apply, and the app saves with that
// person's own token (one commit each). Every check runs again on Apply, as the person applying.
// Byte copy in app/src/lib/write-policy.ts (scripts/test/parity.test.mjs compares the hashes). Zero imports, erasable
// TypeScript: Deno, Node (type stripping) and the browser load it as it is.

export const POLICY_VERSION = 1

/** Largest text the AI may write into one file. */
export const MAX_TEXT = 200_000
/** A whole-file rewrite only for files up to this size; bigger files change through exact edits. */
export const MAX_REWRITE = 20_000

const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/
const lower = (v: unknown) => String(v ?? '').trim().toLowerCase()
const same = (a: unknown, b: unknown) => lower(a) !== '' && lower(a) === lower(b)

/** A login's people/ slug (same rule as the app's slug and people-core slugOf). */
export const slugOfLogin = (login: string) =>
  String(login).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x'

/** A workspace path in canonical form ('' when it is not one): forward slashes, no "..", no drive letters, colons or
 *  NUL (Windows would read them), no leading "./" or "/". */
export function cleanPath(path: unknown): string {
  const raw = String(path ?? '').trim().replace(/^\.?\/+/, '')
  if (!raw || raw.length > 300 || /[\\:\0]/.test(raw)) return ''
  const parts = raw.split('/').filter((s) => s !== '' && s !== '.')
  if (!parts.length || parts.some((s) => s === '..')) return ''
  return parts.join('/')
}

/** Folder or file names that hold secrets or machine state (never read, never written). */
const SECRET_DIR = /^\.(env.*|hq|git|ssh|aws|azure|gnupg|docker|npmrc|netrc|pypirc|kube|config)$/i
const SECRET_FILE = /^(\.env.*|\.npmrc|\.netrc|\.pypirc|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|.*\.(pem|key|p12|pfx|keystore|jks|kdbx)|credentials(\.\w+)?|service[-_]account.*\.json)$/i
/** Files that are not text (read as "binary"). */
const BINARY = /\.(png|jpe?g|gif|webp|avif|bmp|ico|icns|tiff?|psd|sketch|fig|mp4|m4v|mov|webm|mkv|avi|mp3|m4a|wav|ogg|flac|aac|zip|gz|tgz|7z|rar|tar|pdf|docx?|xlsx?|pptx?|woff2?|ttf|otf|eot|exe|dll|so|dylib|bin|wasm|class|jar|pyc|sqlite|db)$/i
/** Text files the AI may change (by extension). */
const TEXT = /\.(md|markdown|txt|mjs|cjs|js|jsx|ts|tsx|json|jsonc|ya?ml|toml|sql|css|html?|py|sh|cmd|bat|ps1|csv|tsv|xml|ini|cfg|conf)$/i

/** A person's look settings (Adjust look): app config, never AI context and never an AI change. */
export const isUiPrefsPath = (p: string) => /^people\/[^/]+\/ui\.md$/i.test(String(p))
export const isBinaryPath = (p: string) => BINARY.test(String(p))
export const isTextPath = (p: string) => TEXT.test(String(p))

/** Why the AI may not read this path ('' = it may): secrets, git internals, installed packages, look settings and
 *  the separate app repo. Everything else is readable: notes, code, config, dot-folders like .github, ai/ history. */
export function readRefusal(path: unknown): string {
  const p = cleanPath(path)
  if (!p) return 'Give a path inside the workspace, like status.md or scripts/hq.mjs'
  const parts = p.split('/')
  if (parts.slice(0, -1).some((s) => SECRET_DIR.test(s)) || SECRET_DIR.test(parts[parts.length - 1]) || SECRET_FILE.test(parts[parts.length - 1])) {
    return `${p} holds secrets or git internals: the AI never reads or changes it`
  }
  if (parts.includes('node_modules')) return 'node_modules/ holds installed packages, not workspace files'
  if (parts[0] === 'app') return 'app/ is the separate public hq-app repo (a push there deploys the live site): out of reach'
  if (isUiPrefsPath(p)) return 'people/<slug>/ui.md holds look settings (Adjust look): the AI never reads or changes it'
  return ''
}

// ---- frontmatter, without a YAML library (only top-level scalar keys are needed) ----

const FM = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

/** A top-level scalar from a file's frontmatter ('' when missing): quotes and a trailing " # comment" removed. */
export function topKey(text: string | null | undefined, key: string): string {
  const m = String(text ?? '').match(FM)
  if (!m) return ''
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_][\w.-]*)[ \t]*:(.*)$/)
    if (!kv || kv[1] !== key) continue
    let v = kv[2].trim()
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1)
    else v = v.replace(/\s+#.*$/, '').trim()
    return v
  }
  return ''
}

/** Frontmatter lines (minus the keys in `skip`, with their indented continuation lines) + body, LF only. */
function withoutKeys(text: string, skip: Set<string>): string {
  const src = String(text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const m = src.match(FM)
  if (!m) return src
  const kept: string[] = []
  let dropping = false
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_][\w.-]*)[ \t]*:/)
    if (kv) dropping = skip.has(kv[1])
    else if (!/^[ \t]/.test(line) && !/^-( |$)/.test(line)) dropping = false
    if (!dropping) kept.push(line)
  }
  return kept.join('\n') + '\n---\n' + src.slice(m[0].length)
}

/** Did only these keys change (the body and every other frontmatter line stayed)? */
export const onlyKeysChanged = (cur: string, next: string, keys: string[]) => {
  const s = new Set(keys)
  return withoutKeys(cur, s) === withoutKeys(next, s)
}

/** Keys anyone may change on someone else's to-do or post: the status tick and its stamps. */
export const TODO_STATUS_KEYS = ['status', 'started_at', 'started_by', 'done_at', 'done_by']
export const POST_STATUS_KEYS = ['status', 'closed_at', 'closed_by']

// ---- the rules ----

/** Why `login` may not change this people/ file ('' = they may): only their profile people/<slug>.md and their
 *  folder people/<slug>/, never its digest/ (the weekly digest writes it). Same rule for the app and the AI; the AI
 *  is also kept off ui.md by readRefusal. */
export function peopleRefusal(path: string, login: string): string {
  const mine = slugOfLogin(login)
  const low = String(path).toLowerCase()
  if (low === `people/${mine}.md`) return ''
  if (low.startsWith(`people/${mine}/`) && !low.startsWith(`people/${mine}/digest/`)) return ''
  return low.startsWith(`people/${mine}/digest/`) ? 'Digests are written by the weekly digest, not the app' : `You (${login}) can only change your own files under people/`
}

const PROJECT_CARD = /^projects\/[^/]+\/project\.md$/i
const LEGACY_PROJECT = /^projects\/[^/]+\.md$/i

/** Why `login` may not make this projects/ change ('' = they may). `project` = the text of that project's
 *  project.md (or legacy projects/<slug>.md), null when it has none. A new project.md must name you as its owner
 *  (anyone may start a project); any other new file needs the project to exist and be yours; existing files: the
 *  owner only, and the owner line never changes. */
export function projectRefusal(path: string, login: string, cur: string | null, next: string | null, project: string | null): string {
  const parts = String(path).split('/')
  if (parts.length < 2) return 'Not a project path'
  const slug = parts[1].replace(/\.md$/i, '')
  const isCard = PROJECT_CARD.test(path) || LEGACY_PROJECT.test(path)
  if (parts.length === 2 && !isCard) return 'Put files inside a project folder: projects/<slug>/…'
  if (cur === null) {
    if (project !== null && !same(topKey(project, 'owner'), login)) return `Only ${topKey(project, 'owner') || 'its owner'} can add to projects/${slug}`
    if (isCard) return next !== null && same(topKey(next, 'owner'), login) ? '' : `A new project must name you (${login}) as its owner`
    return project === null ? `projects/${slug} has no project.md: create the project first` : ''
  }
  const owner = isCard ? topKey(cur, 'owner') : topKey(project, 'owner')
  if (!same(owner, login)) return `Only ${owner || 'its owner'} can change this project`
  if (isCard && next !== null && topKey(next, 'owner') !== owner) return "A project's owner can't be changed from the app"
  return ''
}

/** A to-do or a board post: `who` = its creator key (`by` · `author`). Create = in your name; delete = your own;
 *  edit = the creator (and a to-do's owner) any way, everyone else only the status keys. The creator line stays. */
function itemRefusal(what: string, who: 'by' | 'author', statusKeys: string[], login: string, cur: string | null, next: string | null): string {
  if (cur === null) return next !== null && same(topKey(next, who), login) ? '' : `A new ${what} must say ${who}: ${login}`
  const creator = topKey(cur, who)
  if (next === null) return same(creator, login) ? '' : `Only ${creator || 'its creator'} can remove this ${what}`
  if (lower(topKey(next, who)) !== lower(creator)) return `The ${who}: line of a ${what} can't change`
  if (same(creator, login) || (what === 'to-do' && same(topKey(cur, 'owner'), login))) return ''
  if (onlyKeysChanged(cur, next, statusKeys)) return ''
  return what === 'to-do'
    ? `Only ${topKey(cur, 'owner') || creator || 'its owner'} can edit this to-do (anyone can move it)`
    : `Only ${creator || 'its author'} can edit this post (anyone can close or reopen it)`
}

export type WriteCheck = {
  path: string
  /** who applies the change (their GitHub login) */
  login: string
  /** the file's current text; null = no such file */
  cur: string | null
  /** the new text; null = delete (only the Undo of a file this person created) */
  next: string | null
  /** projects/…: the text of that project's project.md (or legacy projects/<slug>.md); null = it has none */
  project?: string | null
  /** board/replies/…: does the parent post exist? */
  parent?: boolean
}

/**
 * Why this person may not apply this change ('' = they may). House rules (the owner's pick, 2026-10-20: "Everyone, house
 * rules"): text files only; no secrets, dot-folders (.github workflows can reach the repo's secrets), ai/ (chat
 * history) or look settings; people/: only your own profile and log; projects/: the owner only; to-dos and board
 * posts: create in your own name, edit your own, anyone may tick the status. Notes, investigations, rules and code
 * (scripts/, supabase/): anyone on the allow-list.
 */
export function writeRefusal(c: WriteCheck): string {
  const p = cleanPath(c.path)
  if (!p) return 'Not a workspace path'
  const read = readRefusal(p)
  if (read) return read
  const login = String(c.login || '').trim()
  if (!LOGIN.test(login)) return 'Sign in first: changes are saved in your name'
  if (c.cur === null && c.next === null) return 'Nothing to change'
  const parts = p.split('/')
  if (parts.some((s) => s.startsWith('.'))) return `${p} is in a dot-folder (.github, .claude, …): read-only for the AI, since workflows there can reach the repo's secrets`
  if (!isTextPath(p)) return `${p}: only text files (notes, code, config) can be changed`
  if (c.next !== null && c.next.length > MAX_TEXT) return `Too big: at most ${MAX_TEXT / 1000} KB per file`
  if (parts[0] === 'ai') return "ai/ is the chat history: only the AI's own question + answer commit writes it"
  if (parts[0] === 'people') return peopleRefusal(p, login)
  if (parts[0] === 'projects') return projectRefusal(p, login, c.cur, c.next, c.project ?? null)
  if (parts[0] === 'todos') return itemRefusal('to-do', 'by', TODO_STATUS_KEYS, login, c.cur, c.next)
  if (parts[0] === 'board') {
    if (parts[1] !== 'replies') return itemRefusal('post', 'author', POST_STATUS_KEYS, login, c.cur, c.next)
    if (!/^board\/replies\/[^/]+--[^/]+\.md$/.test(p)) return 'Replies live at board/replies/<post id>--<reply id>.md'
    if (c.cur === null) {
      if (c.parent !== true) return `No such post: ${parts[2].split('--')[0]}`
      return c.next !== null && same(topKey(c.next, 'author'), login) ? '' : `A new reply must say author: ${login}`
    }
    const author = topKey(c.cur, 'author')
    if (!same(author, login)) return `Only ${author || 'its author'} can change this reply`
    return c.next !== null && lower(topKey(c.next, 'author')) !== lower(author) ? "The author: line of a reply can't change" : ''
  }
  return ''
}

// ---- exact edits (the AI's propose_edit; the app re-runs them on Apply) ----

export type Edit = { find: string; replace: string }

/** Apply exact replacements in order: each `find` must appear exactly once. Matching ignores CRLF vs LF in a CRLF
 *  file (the result keeps CRLF). {text} or {error} in plain words. */
export function applyEdits(text: string, edits: Edit[]): { text: string; error?: undefined } | { error: string; text?: undefined } {
  const src = String(text ?? '')
  const crlf = src.includes('\r\n') && !/(^|[^\r])\n/.test(src)
  let t = crlf ? src.replace(/\r\n/g, '\n') : src
  if (!Array.isArray(edits) || !edits.length) return { error: 'No edits given' }
  for (let i = 0; i < edits.length; i++) {
    const find = String(edits[i]?.find ?? '').replace(/\r\n/g, '\n')
    const rep = String(edits[i]?.replace ?? '').replace(/\r\n/g, '\n')
    const n = edits.length > 1 ? `Edit ${i + 1}: ` : ''
    if (!find) return { error: `${n}"find" is empty` }
    const at = t.indexOf(find)
    if (at < 0) return { error: `${n}the "find" text is not in the file (copy it exactly from read_file)` }
    if (t.indexOf(find, at + 1) >= 0) return { error: `${n}the "find" text appears more than once: include more of the lines around it` }
    t = t.slice(0, at) + rep + t.slice(at + find.length)
  }
  return { text: crlf ? t.replace(/\n/g, '\r\n') : t }
}

/** sha1 (hex) of a text, a leading BOM ignored: the same value as the dev server's `expect` check. */
export async function textSha1(text: string): Promise<string> {
  const s = String(text ?? '')
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s.charCodeAt(0) === 0xfeff ? s.slice(1) : s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---- did the person ask for a change? (prompt-injection guard) ----

const CHANGE_EN = /\b(add|create|make|write|draft|update|edit|change|fix|rename|replace|remove|delete|drop|set|mark|tick|close|reopen|assign|reply|respond|post|log|note|save|put|append|insert|move|record|remind|schedule|bump|correct|rewrite|tidy|start|finish|complete|apply|tell|notify|flag|archive|cancel|pin|link|tag|implement|refactor)\b/i
const CHANGE_AR = /(^|[^\p{L}])(ا|أ)?(ضف|ضيف|كتب|عدل|عدّل|غير|غيّر|حذف|مسح|شيل|رد|ردّ|نشر|سجل|سجّل|عمل|حط|صلح|صلّح|حدث|حدّث|خلص|خلّص|قفل|فتح|ذكرني|فكرني|علم|علّم)($|[^\p{L}])/u
const YES = /^\s*(yes|yeah|yep|yup|ok(ay)?|sure|please|do it|go ahead|go for it|sounds good|approved?|confirm(ed)?|نعم|ايوه|أيوه|اه|آه|تمام|موافق|ماشي|يلا|اوكي)(?!\p{L})[\s\S]{0,80}$/iu

/**
 * Did the person ask, in their own words, for something to change? The AI may only propose changes then, so a
 * note, board post or web page that says "add a to-do…" can't produce a change card on its own. `afterAnswer` =
 * this message follows an earlier answer in the same chat (a short "yes, do it" then counts as asking).
 */
export function asksForChange(question: string, afterAnswer = false): boolean {
  const q = String(question ?? '')
  return CHANGE_EN.test(q) || CHANGE_AR.test(q) || (afterAnswer && YES.test(q))
}
