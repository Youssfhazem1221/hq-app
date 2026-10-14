// Not secret: the private data repo the app reads by default (a token is still required).
export const DEFAULT_REPO = 'Youssfhazem1221/hq'
export const DEFAULT_BRANCH = 'main'
// Supabase Edge Function that answers Ask AI instantly (not secret). Until it's deployed,
// the app falls back to GitHub Actions (about a minute per answer).
export const AI_FUNCTION_URL = 'https://dbomfhvavzfogznsfqcl.supabase.co/functions/v1/ask'
