// Not secret: the private data repo the app reads by default (a token is still required).
export const DEFAULT_REPO = 'Youssfhazem1221/hq'
export const DEFAULT_BRANCH = 'main'

// Supabase project. Public by design: the publishable key ships to browsers. It cannot read the
// RAG tables; it can use public Realtime topics, so the doorbell topic name lives in the private
// repo (.hq/realtime.json) and every doorbell message is only a hint the app re-checks on GitHub.
export const SUPABASE_REF = 'dbomfhvavzfogznsfqcl'
export const SUPABASE_URL = `https://${SUPABASE_REF}.supabase.co`
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_xuxtGpBN95tnQp6Rc1gD1w_iCrEplRW'

// Ask AI streams from this Supabase Edge Function ('ask', same code as the 'ask-v2' test deploy).
// Pinned to eu-west-1, where the database lives (default routing picked eu-central-2).
// If it fails before the first event, the app falls back to GitHub Actions (about a minute).
export const AI_FUNCTION_NAME = 'ask'
export const AI_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/${AI_FUNCTION_NAME}?forceFunctionRegion=eu-west-1`
