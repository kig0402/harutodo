const PROJECT_URL = 'https://lscspoaxhxbgsbjespod.supabase.co'
const APP_URL = 'https://kig0402.github.io/harutodo/'
const APP_ORIGIN = new URL(APP_URL).origin
const GOOGLE_CLIENT_ID = '94815918526-tqndgocumj72bi3ksmqrd4kjni5r18b8.apps.googleusercontent.com'
const GOOGLE_CALLBACK_URL = `${PROJECT_URL}/functions/v1/google-tasks-oauth`
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/tasks'
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || PROJECT_URL
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || ''

function defaultKey(name: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(name) || '{}')
    return typeof keys.default === 'string' ? keys.default : ''
  } catch {
    return ''
  }
}

const PUBLISHABLE_KEY = defaultKey('SUPABASE_PUBLISHABLE_KEYS')
const SERVER_KEY = defaultKey('SUPABASE_SECRET_KEYS')
const corsHeaders = {
  'Access-Control-Allow-Origin': APP_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function appRedirect(result: 'connected' | 'error' | 'cancelled'): Response {
  return Response.redirect(`${APP_URL}?google=${result}`, 302)
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function adminRequest(path: string, init: RequestInit = {}): Promise<Response> {
  if (!SERVER_KEY) throw new Error('Supabase server key is unavailable')
  const headers = new Headers(init.headers)
  headers.set('apikey', SERVER_KEY)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers })
}

async function getSignedInUser(req: Request): Promise<string | null> {
  const authorization = req.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ') || !PUBLISHABLE_KEY) return null
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: authorization },
  })
  if (!response.ok) return null
  const user = await response.json().catch(() => null)
  return typeof user?.id === 'string' ? user.id : null
}

async function startAuthorization(userId: string): Promise<Response> {
  if (!GOOGLE_CLIENT_SECRET || !SERVER_KEY) return json({ error: 'Google server connection is not configured.' }, 503)

  const expired = await adminRequest(`google_task_oauth_states?expires_at=lt.${encodeURIComponent(new Date().toISOString())}`, { method: 'DELETE' })
  if (!expired.ok) return json({ error: 'Could not prepare Google authorization.' }, 503)

  const random = crypto.getRandomValues(new Uint8Array(32))
  const state = base64Url(random)
  const stateHash = await sha256(state)
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const inserted = await adminRequest('google_task_oauth_states', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ state_hash: stateHash, user_id: userId, expires_at: expiresAt }),
  })
  if (!inserted.ok) return json({ error: 'Could not prepare Google authorization.' }, 503)

  const authorizationUrl = new URL(GOOGLE_AUTH_URL)
  authorizationUrl.search = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_CALLBACK_URL,
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
  }).toString()
  return json({ authorization_url: authorizationUrl.toString() })
}

async function readRefreshToken(userId: string): Promise<string | null> {
  const response = await adminRequest(`google_task_tokens?user_id=eq.${encodeURIComponent(userId)}&select=refresh_token`)
  if (!response.ok) throw new Error('Could not read the saved Google connection')
  const rows = await response.json().catch(() => [])
  return Array.isArray(rows) && typeof rows[0]?.refresh_token === 'string' ? rows[0].refresh_token : null
}

async function storeRefreshToken(userId: string, refreshToken: string): Promise<boolean> {
  const response = await adminRequest('google_task_tokens?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ user_id: userId, refresh_token: refreshToken, updated_at: new Date().toISOString() }),
  })
  return response.ok
}

async function deleteRefreshToken(userId: string): Promise<void> {
  await adminRequest(`google_task_tokens?user_id=eq.${encodeURIComponent(userId)}`, { method: 'DELETE' })
}

async function refreshAccessToken(userId: string): Promise<Response> {
  if (!GOOGLE_CLIENT_SECRET) return json({ error: 'Google server connection is not configured.' }, 503)
  const refreshToken = await readRefreshToken(userId)
  if (!refreshToken) return json({ error: 'Google account is not connected.' }, 404)

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const tokens = await response.json().catch(() => ({}))
  if (!response.ok || typeof tokens.access_token !== 'string') {
    if (tokens.error === 'invalid_grant') await deleteRefreshToken(userId)
    return json({ error: tokens.error === 'invalid_grant' ? 'Google authorization expired.' : 'Could not refresh Google authorization.' }, tokens.error === 'invalid_grant' ? 401 : 502)
  }

  if (typeof tokens.refresh_token === 'string') {
    const stored = await storeRefreshToken(userId, tokens.refresh_token)
    if (!stored) return json({ error: 'Could not update the saved Google connection.' }, 503)
  }
  return json({ access_token: tokens.access_token, expires_in: Number(tokens.expires_in) || 3600 })
}

async function handleCallback(url: URL): Promise<Response> {
  const state = url.searchParams.get('state') || ''
  const code = url.searchParams.get('code') || ''
  const googleError = url.searchParams.get('error')
  if (!state) return appRedirect('error')

  const stateHash = await sha256(state)
  const consumed = await adminRequest(`google_task_oauth_states?state_hash=eq.${stateHash}&select=user_id,expires_at`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  })
  if (!consumed.ok) return appRedirect('error')
  const rows = await consumed.json().catch(() => [])
  const saved = Array.isArray(rows) ? rows[0] : null
  if (!saved?.user_id || Date.parse(saved.expires_at) <= Date.now()) return appRedirect('error')
  if (googleError || !code) return appRedirect('cancelled')
  if (!GOOGLE_CLIENT_SECRET) return appRedirect('error')

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_CALLBACK_URL,
      grant_type: 'authorization_code',
    }),
  })
  const tokens = await response.json().catch(() => ({}))
  if (!response.ok || typeof tokens.access_token !== 'string') return appRedirect('error')

  let refreshToken = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : ''
  if (!refreshToken) refreshToken = await readRefreshToken(saved.user_id) || ''
  if (!refreshToken || !(await storeRefreshToken(saved.user_id, refreshToken))) return appRedirect('error')
  return appRedirect('connected')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method === 'GET') return await handleCallback(new URL(req.url))
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const origin = req.headers.get('Origin')
  if (origin && origin !== APP_ORIGIN) return json({ error: 'Origin not allowed.' }, 403)
  const userId = await getSignedInUser(req)
  if (!userId) return json({ error: 'Please sign in to 하루 first.' }, 401)

  const body = await req.json().catch(() => ({}))
  if (body.action === 'start') return await startAuthorization(userId)
  if (body.action === 'refresh') return await refreshAccessToken(userId)
  return json({ error: 'Unknown action.' }, 400)
})
